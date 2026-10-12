import android.security.keystore.DesktopKeyStoreProvider;
import android.security.keystore.KeyGenParameterSpec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class KeyStoreProbe {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        System.setProperty("tvbox.spiderCacheDir", args[0]);
        DesktopKeyStoreProvider.install();
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (args[1].equals("create")) {
            check(!store.containsAlias("probe"), "fresh alias");
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("probe", 3).setBlockModes("GCM")
                    .setEncryptionPaddings("NoPadding").setKeySize(256).setUserAuthenticationRequired(false).build());
            SecretKey key = generator.generateKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            Files.write(Path.of(args[0], "cipher"), cipher.doFinal(new byte[]{1, 2, 3}));
            Files.write(Path.of(args[0], "iv"), cipher.getIV());
            check(store.containsAlias("probe") && store.isKeyEntry("probe"), "saved alias");
            try {
                generator.init(new KeyGenParameterSpec.Builder("protected", 3).setUserAuthenticationRequired(true).build());
                throw new AssertionError("must not fake hardware authentication");
            } catch (java.security.InvalidAlgorithmParameterException expected) { }
            try {
                generator.generateKey();
                throw new AssertionError("rejected init must not leave a usable key generator");
            } catch (IllegalStateException expected) { }
            generator.init(new KeyGenParameterSpec.Builder("replacement", 3).setKeySize(128).build());
            SecretKey old = generator.generateKey();
            generator.init(new KeyGenParameterSpec.Builder("replacement", 3).setKeySize(256).build());
            SecretKey replacement = generator.generateKey();
            check(replacement.getEncoded().length == 32 && !Arrays.equals(old.getEncoded(), replacement.getEncoded()), "generate replaces an existing alias");
            store.deleteEntry("replacement");
            java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(3);
            try {
                java.util.List<java.util.concurrent.Future<?>> jobs = new java.util.ArrayList<>();
                for (int i = 0; i < 3; i++) jobs.add(pool.submit(() -> {
                    try {
                        KeyGenerator concurrent = KeyGenerator.getInstance("AES", "AndroidKeyStore");
                        concurrent.init(new KeyGenParameterSpec.Builder("concurrent", 3).build());
                        concurrent.generateKey();
                        check(store.getKey("concurrent", null) != null, "concurrent read");
                    } catch (Exception e) { throw new RuntimeException(e); }
                }));
                for (java.util.concurrent.Future<?> job : jobs) job.get();
            } finally { pool.shutdownNow(); }
            store.deleteEntry("concurrent");
        } else {
            SecretKey key = (SecretKey) store.getKey("probe", null);
            check(key != null, "key survives JVM restart");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Files.readAllBytes(Path.of(args[0], "iv"))));
            check(Arrays.equals(cipher.doFinal(Files.readAllBytes(Path.of(args[0], "cipher"))), new byte[]{1, 2, 3}), "decrypt after restart");
            Path file;
            try (java.util.stream.Stream<Path> files = Files.list(Path.of(args[0], "keystore"))) {
                file = files.filter(p -> p.toString().endsWith(".dpapi")).findFirst().orElseThrow();
            }
            byte[] protectedBytes = Files.readAllBytes(file);
            check(protectedBytes.length > key.getEncoded().length && !Arrays.equals(protectedBytes, key.getEncoded()), "secret at rest is not plaintext");
            Files.write(file, new byte[]{0,1,2});
            try { store.getKey("probe", null); throw new AssertionError("corrupt key must fail, not silently regenerate"); }
            catch (java.security.UnrecoverableKeyException expected) { }
            Files.write(file, protectedBytes);
            store.deleteEntry("probe");
            check(!store.containsAlias("probe") && store.getKey("probe", null) == null, "delete");
        }
        System.out.println("keystore-" + args[1] + "-ok");
    }
}
