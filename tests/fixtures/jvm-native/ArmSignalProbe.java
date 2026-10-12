import com.winbox.nativebridge.BridgeARM32Emulator;
import com.github.unidbg.arm.backend.Unicorn2Factory;
import com.github.unidbg.pointer.UnidbgPointer;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Collections;

public class ArmSignalProbe {
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static long call(BridgeARM32Emulator emulator, long code, int arg, UnidbgPointer in, UnidbgPointer out, int size) {
        return emulator.eFunc(code, arg, in == null ? 0 : (int) in.peer, out == null ? 0 : (int) out.peer, size).intValue();
    }
    public static void main(String[] args) throws Exception {
        try (BridgeARM32Emulator e = new BridgeARM32Emulator("fixture.signals", new File(args[0]),
                Collections.singletonList(new Unicorn2Factory(true)))) {
            e.getSyscallHandler().setEnableThreadDispatcher(true);
            e.getBackend().mem_map(0x10000000L, 4096, 7);
            ByteBuffer code = ByteBuffer.allocate(96).order(ByteOrder.LITTLE_ENDIAN);
            for (int nr : new int[]{174, 175, 5, 3, 6, 162}) code.putInt(0xe92d4080).putInt(0xe3a07000 | nr).putInt(0xef000000).putInt(0xe8bd8080);
            e.getBackend().mem_write(0x10000000L, code.array());
            e.getBackend().mem_map(0x10001000L, 4096, 3);
            UnidbgPointer in = UnidbgPointer.pointer(e, 0x10001000L), out = UnidbgPointer.pointer(e, 0x10001100L);
            long actionMask = 0x8123456787654321L & ~((1L << 8) | (1L << 18));
            in.setInt(0, 0x12345678); in.setInt(4, 4); in.setInt(8, 0x23456789); in.setLong(12, actionMask | (1L << 8) | (1L << 18));
            check(new BridgeARM32Emulator.KernelAction(in).size() == 20, "kernel structure size");
            out.setMemory(0, 20, (byte) 0xff);
            check(call(e, 0x10000000L, 11, in, out, 8) == 0, "install action");
            check(out.getLong(12) == 0 && out.getInt(0) == 0, "default previous action");
            for (int i = 0; i < 2; i++) {
                check(call(e, 0x10000000L, 11, null, out, 8) == 0, "query action");
                check(out.getInt(0) == 0x12345678 && out.getInt(4) == 4 && out.getInt(8) == 0x23456789
                        && out.getLong(12) == actionMask, "queries preserve full action including high mask, excluding unmaskable signals");
            }
            in.setInt(0, 0x34567890);
            check(call(e, 0x10000000L, 11, in, in, 8) == 0 && in.getInt(0) == 0x12345678, "aliased replace snapshot");
            check(call(e, 0x10000000L, 11, null, out, 8) == 0 && out.getInt(0) == 0x34567890, "replacement registered");
            check(call(e, 0x10000000L, 9, in, out, 8) == -22, "cannot handle SIGKILL");
            check(call(e, 0x10000000L, 19, in, out, 8) == -22, "cannot handle SIGSTOP");
            check(call(e, 0x10000000L, 9, null, out, 8) == 0, "SIGKILL query allowed");
            check(call(e, 0x10000000L, 65, null, out, 8) == -22, "invalid signal");
            check(call(e, 0x10000000L, 11, in, out, 4) == -22, "invalid mask size");
            check(call(e, 0x10000000L, 11, null, out, 8) == 0 && out.getInt(0) == 0x34567890, "invalid request did not mutate state");
            long mask = (1L << 63) | (1L << 40) | 1;
            in.setLong(0, mask | (1L << 8) | (1L << 18));
            check(call(e, 0x10000010L, 2, in, out, 8) == 0 && out.getLong(0) == 0, "initial setmask");
            check(call(e, 0x10000010L, 99, null, out, 8) == 0 && out.getLong(0) == mask, "query and unmaskable signals");
            in.setLong(0, 2);
            check(call(e, 0x10000010L, 0, in, out, 8) == 0 && out.getLong(0) == mask, "block mask");
            in.setLong(0, 1L << 40);
            check(call(e, 0x10000010L, 1, in, in, 8) == 0 && in.getLong(0) == (mask | 2), "aliased unblock");
            check(call(e, 0x10000010L, 0, null, out, 8) == 0 && out.getLong(0) == ((mask | 2) & ~(1L << 40)), "full width unblock result");
            check(call(e, 0x10000010L, 3, in, out, 8) == -22, "invalid mask operation");
            check(call(e, 0x10000010L, 0, in, out, 4) == -22, "invalid procmask size");
            in.setString(0, "/proc/self/auxv");
            int fd = e.eFunc(0x10000020L, (int) in.peer, 0, 0).intValue();
            check(fd >= 0, "aux vector open");
            check(e.eFunc(0x10000030L, fd, (int) out.peer, 32).intValue() == 16, "aux vector read");
            check(out.getInt(0) == 6 && out.getInt(4) == e.getPageAlign() && out.getLong(8) == 0, "aux page size matches allocator and terminates");
            check(e.eFunc(0x10000030L, fd, (int) out.peer, 32).intValue() == 0, "aux EOF");
            check(e.eFunc(0x10000040L, fd).intValue() == 0, "aux vector close");
            in.setInt(0, 0); in.setInt(4, 250_000); out.setLong(0, -1);
            long started = System.nanoTime();
            check(e.eFunc(0x10000050L, (int) in.peer, (int) out.peer).intValue() == 0, "sub-ms nanosleep");
            check(System.nanoTime() - started >= 250_000 && out.getLong(0) == -1, "actual sleep and successful rem untouched");
            in.setInt(4, 0);
            check(e.eFunc(0x10000050L, (int) in.peer, 0).intValue() == 0, "zero nanosleep");
            in.setInt(4, 1_000_000_000);
            check(e.eFunc(0x10000050L, (int) in.peer, 0).intValue() == -22, "invalid nanosleep nanoseconds");
            in.setInt(0, -1); in.setInt(4, 0);
            check(e.eFunc(0x10000050L, (int) in.peer, 0).intValue() == -22, "invalid nanosleep seconds");
            check(e.eFunc(0x10000050L, 0, 0).intValue() == -14, "null nanosleep request");
            System.out.println("arm-signals-ok");
        }
    }
}
