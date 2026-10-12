import com.winbox.nativebridge.NativeBridgeMain;
import com.winbox.nativebridge.NativePatcher;
import com.winbox.nativebridge.NativeBridge;
import com.github.unidbg.linux.android.dvm.DvmObject;
import com.github.unidbg.linux.android.dvm.array.ArrayObject;
import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.objectweb.asm.*;

public class NativePatchProbe {
    private static class Value extends DvmObject<Object> {
        Value(Object value) { super(null, value); }
    }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        File jar = new File(args[0]);
        java.lang.reflect.Method unwrap = NativeBridge.class.getDeclaredMethod("unwrap", DvmObject.class, String.class, ClassLoader.class);
        unwrap.setAccessible(true);
        ClassLoader host = NativePatchProbe.class.getClassLoader();
        String[] urls = (String[]) unwrap.invoke(null, new ArrayObject(new Value("https://example.org/config"), null), "[Ljava/lang/String;", host);
        check(urls.length == 2 && urls[0].endsWith("/config") && urls[1] == null, "native String[] return preserves declared type and nulls");
        String[][] nested = (String[][]) unwrap.invoke(null, new ArrayObject(new ArrayObject(new Value("nested")), null), "[[Ljava/lang/String;", host);
        check("nested".equals(nested[0][0]) && nested[1] == null, "nested native arrays");
        byte[] bytes = {1,2,3};
        check(unwrap.invoke(null, new Value(bytes), "[B", host) == bytes, "primitive array remains unchanged");
        check(unwrap.invoke(null, null, "[Ljava/lang/String;", host) == null, "null native array");
        check(NativeBridgeMain.hasNativeMethods(jar), "detect dynamic guard");
        try (URLClassLoader resolver = new URLClassLoader(new URL[]{jar.toURI().toURL()}, NativePatchProbe.class.getClassLoader())) {
            Class<?> guardType = Class.forName("fixture.DynamicGuard", false, resolver);
            Object custom = unwrap.invoke(null, new ArrayObject(), "[Lfixture/DynamicGuard;", resolver);
            check(custom.getClass().getComponentType() == guardType, "native array uses defining loader");
            for (String mode : new String[]{"dynamic", "payload", "embedded"}) {
                File out = new File(args[1], mode); out.mkdirs();
                int count;
                if (mode.equals("embedded")) {
                    java.util.Map<String, Boolean> methods = new java.util.LinkedHashMap<>();
                    methods.put("getLoader(Ljava/lang/Object;)Ljava/lang/Object;", false);
                    methods.put("@payload:sidecarAbi()I", false);
                    count = NativePatcher.patch(jar, out, java.util.Collections.singletonMap("fixture/DynamicGuard", methods), resolver);
                    check(count == 2, "guard and sidecar declarations patched");
                } else {
                    count = mode.equals("dynamic") ? NativePatcher.patchDynamic(jar, out, resolver) : NativePatcher.patchPayload(jar, out, resolver);
                    check(count == 1, "patched class count");
                }
                List<String> calls = new ArrayList<>();
                java.util.Map<String, String> nativeRoutes = new java.util.HashMap<>();
                new ClassReader(Files.readAllBytes(new File(out, "fixture/DynamicGuard.class").toPath())).accept(new ClassVisitor(Opcodes.ASM9) {
                    @Override public MethodVisitor visitMethod(int access, String name, String desc, String signature, String[] exceptions) {
                        check((access & Opcodes.ACC_NATIVE) == 0, "native modifier cleared");
                        String methodName = name;
                        return new MethodVisitor(Opcodes.ASM9) {
                            @Override public void visitMethodInsn(int opcode, String owner, String name, String descriptor, boolean itf) {
                                if (owner.equals("com/winbox/nativebridge/NativeBridge")) calls.add(name + descriptor);
                                if (owner.equals("com/winbox/nativebridge/NativeBridge") && name.startsWith("invoke")) nativeRoutes.put(methodName, name);
                                check(!owner.equals("java/lang/System") || !name.equals("load"), "never load ARM on host JVM");
                            }
                        };
                    }
                }, 0);
                if (!mode.equals("embedded")) check(calls.contains("clinitRun(Ljava/lang/Class;)V"), "class-literal initialization");
                check(calls.contains((mode.equals("embedded") ? "bridgeLoadEmbedded" : mode.equals("dynamic") ? "bridgeLoadDynamic" : "bridgeLoad") + "(Ljava/lang/String;)V"), "correct library VM");
                check((mode.equals("payload") ? "invokePayload" : "invoke").equals(nativeRoutes.get("getLoader")), "guard method route");
                check((mode.equals("dynamic") ? "invoke" : "invokePayload").equals(nativeRoutes.get("sidecarAbi")), "sidecar method route");
                System.clearProperty("winbox.dynamic.clinit");
                try (URLClassLoader loader = new URLClassLoader(new URL[]{out.toURI().toURL(), jar.toURI().toURL()}, NativePatchProbe.class.getClassLoader())) {
                    Class<?> guard = Class.forName("fixture.DynamicGuard", true, loader);
                    check("correct-loader".equals(guard.getMethod("marker").invoke(null)), "clinit uses defining loader");
                }
            }
        }
        System.out.println("native-patch-ok");
    }
}
