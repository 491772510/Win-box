import com.winbox.nativebridge.BridgeARM32Emulator;
import com.github.unidbg.arm.backend.Unicorn2Factory;
import com.github.unidbg.pointer.UnidbgPointer;
import com.github.unidbg.file.linux.AndroidFileIO;
import com.github.unidbg.AbstractEmulator;
import com.github.unidbg.thread.ThreadTask;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Collections;

public class ArmEventfdProbe {
    static final int BASE = 0x10000000;
    static final int[] CALLS = {356, 3, 4, 55, 6, 41, 357, 250, 251, 252, 346, 441};
    static int call(BridgeARM32Emulator e, int nr, Number... args) {
        int index = 0;
        while (CALLS[index] != nr) index++;
        return e.eFunc(BASE + index * 24, args).intValue();
    }
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static void later(BridgeARM32Emulator e, Runnable work) {
        // This task runs only after the main emulated syscall yields. Executing
        // the real file counter operation here tests dispatcher wake-up, not a
        // Java sleep or a fabricated return value.
        e.getThreadDispatcher().addThread(new ThreadTask(12345, e.getReturnAddress()) {
            @Override public String toThreadString() { return "eventfd-fixture-wakeup"; }
            @Override protected Number runThread(AbstractEmulator<?> ignored) { work.run(); return 0; }
        });
    }
    public static void main(String[] args) throws Exception {
        try (BridgeARM32Emulator e = new BridgeARM32Emulator("fixture.eventfd", new File(args[0]),
                Collections.singletonList(new Unicorn2Factory(true)))) {
            e.getSyscallHandler().setEnableThreadDispatcher(true);
            e.getBackend().mem_map(BASE, 4096, 7);
            ByteBuffer code = ByteBuffer.allocate(CALLS.length * 24).order(ByteOrder.LITTLE_ENDIAN);
            for (int nr : CALLS) code.putInt(0xe92d40b0).putInt(0xe59d4010).putInt(0xe59d5014)
                    .putInt(0xe3007000 | nr).putInt(0xef000000).putInt(0xe8bd80b0);
            e.getBackend().mem_write(BASE, code.array());
            e.getBackend().mem_map(BASE + 4096, 4096, 3);
            UnidbgPointer buffer = UnidbgPointer.pointer(e, BASE + 4096);
            int address = (int) buffer.peer;
            int fd = call(e, 356, 0, 0x80800);
            check(fd >= 0, "CLOEXEC and NONBLOCK accepted");
            check(call(e, 55, fd, 1, 0) == 1, "descriptor CLOEXEC recorded");
            check(call(e, 55, fd, 3, 0) == 0x802, "status flags exclude CLOEXEC");
            check(!((AndroidFileIO) e.getSyscallHandler().getFileIO(fd)).canRead(), "empty counter is not ready");
            buffer.setLong(0, 123);
            check(call(e, 3, fd, address, 8) == -11 && buffer.getLong(0) == 123, "empty read EAGAIN preserves buffer");
            check(call(e, 3, fd, address, 7) == -22, "short read rejected");
            check(call(e, 4, fd, address, 7) == -22, "short write rejected");
            check(call(e, 4, fd, 0, 8) == -14, "null write rejected");
            check(call(e, 3, fd, 0, 8) == -14, "null read rejected");
            buffer.setLong(0, 2); check(call(e, 4, fd, address, 8) == 8, "first increment");
            buffer.setLong(0, 3); check(call(e, 4, fd, address, 12) == -22, "eventfd write must be exactly eight bytes");
            check(call(e, 4, fd, address, 8) == 8, "second increment");
            check(((AndroidFileIO) e.getSyscallHandler().getFileIO(fd)).canRead(), "counter readiness");
            check(call(e, 3, fd, address, 12) == 8 && buffer.getLong(0) == 5, "aggregated read consumes counter");
            check(call(e, 3, fd, address, 8) == -11, "counter drained");
            buffer.setLong(0, -1L); check(call(e, 4, fd, address, 8) == -22, "UINT64_MAX is invalid");
            buffer.setLong(0, -2L); check(call(e, 4, fd, address, 8) == 8, "full unsigned counter");
            buffer.setLong(0, 1); check(call(e, 4, fd, address, 8) == -11, "overflow EAGAIN");
            check(call(e, 3, fd, address, 8) == 8 && buffer.getLong(0) == -2L, "overflow did not mutate counter");
            check(call(e, 55, fd, 2, 0) == 0 && call(e, 55, fd, 1, 0) == 0, "CLOEXEC can be cleared");
            check(call(e, 55, fd, 2, 1) == 0, "CLOEXEC can be set");
            int duplicate = call(e, 41, fd);
            check(duplicate >= 0 && call(e, 55, duplicate, 1, 0) == 0, "dup clears descriptor flags");
            buffer.setLong(0, 7); check(call(e, 4, duplicate, address, 8) == 8, "dup shares counter");
            check(call(e, 3, fd, address, 8) == 8 && buffer.getLong(0) == 7, "original reads duplicated increment");
            check(call(e, 55, duplicate, 4, 0) == 0 && call(e, 55, fd, 3, 0) == 2, "dup shares status flags");
            check(call(e, 55, fd, 4, 0x800) == 0 && call(e, 55, duplicate, 3, 0) == 0x802, "status flags reset");
            check(call(e, 6, fd) == 0, "close original");
            buffer.setLong(0, 9); check(call(e, 4, duplicate, address, 8) == 8, "dup survives original close");
            check(call(e, 3, duplicate, address, 8) == 8 && buffer.getLong(0) == 9, "remaining descriptor reads");
            check(call(e, 6, duplicate) == 0, "close duplicate");
            fd = call(e, 356, 2, 0x801);
            check(call(e, 3, fd, address, 8) == 8 && buffer.getLong(0) == 1, "semaphore reads one");
            check(call(e, 3, fd, address, 8) == 8 && buffer.getLong(0) == 1, "semaphore preserves remainder");
            check(call(e, 3, fd, address, 8) == -11, "semaphore exhausted");
            check(call(e, 6, fd) == 0, "close semaphore");
            fd = call(e, 356, -1, 0x800);
            check(call(e, 3, fd, address, 8) == 8 && buffer.getLong(0) == 0xffffffffL, "unsigned initial uint32");
            check(call(e, 6, fd) == 0, "close unsigned counter");
            check(call(e, 356, 0, 2) == -22, "unknown flags rejected");
            check(call(e, 250, 0) == -22 && call(e, 357, 1) == -22, "invalid epoll create");
            int epoll = call(e, 357, 0x80000);
            check(epoll >= 0 && call(e, 55, epoll, 1, 0) == 1, "epoll CLOEXEC");
            check(call(e, 55, epoll, 2, 0) == 0 && call(e, 55, epoll, 1, 0) == 0, "epoll CLOEXEC clear");
            int first = call(e, 356, 0, 0x800), second = call(e, 356, 1, 0x800);
            int event = address + 128, output = address + 256, ts = address + 512;
            UnidbgPointer ev = buffer.share(128, 16), results = buffer.share(256, 64);
            ev.setInt(0, 1); ev.setLong(8, 0xfedcba9876543210L);
            check(call(e, 251, epoll, 1, first, event) == 0, "register empty eventfd");
            check(call(e, 251, epoll, 1, first, event) == -17, "duplicate ADD");
            check(call(e, 251, epoll, 3, second, event) == -2, "MOD missing fd");
            check(call(e, 251, first, 1, second, event) == -22, "not an epoll fd");
            check(call(e, 251, epoll, 1, epoll, event) == -22, "self registration");
            check(call(e, 251, epoll, 1, second, 0) == -14, "null event");
            check(call(e, 252, epoll, output, 1, 0) == 0, "empty nonblocking wait");
            check(call(e, 252, epoll, output, 0, 0) == -22, "zero maxevents");
            check(call(e, 252, epoll, 0, 1, 0) == -14, "null event output");
            buffer.setLong(0, 4); check(call(e, 4, first, address, 8) == 8, "make ready");
            check(call(e, 252, epoll, output, 1, 0) == 1 && results.getInt(0) == 1 && results.getInt(4) == 0
                    && results.getLong(8) == 0xfedcba9876543210L, "ARM event ABI preserves all 64 data bits");
            check(call(e, 346, epoll, output, 1, 0, 0, 8) == 1, "level readiness persists");
            check(call(e, 3, first, address, 8) == 8 && call(e, 252, epoll, output, 1, 0) == 0, "draining removes readiness");
            long started = System.nanoTime();
            check(call(e, 252, epoll, output, 1, 2) == 0 && System.nanoTime() - started >= 2_000_000, "actual millisecond timeout");
            UnidbgPointer timeout = buffer.share(512, 16); timeout.setLong(0, 0); timeout.setLong(8, 250000);
            started = System.nanoTime();
            check(call(e, 441, epoll, output, 1, ts, 0, 8) == 0 && System.nanoTime() - started >= 250000, "pwait2 nanosecond timeout");
            timeout.setLong(8, 1000000000L);
            check(call(e, 441, epoll, output, 1, ts, 0, 8) == -22, "invalid pwait2 timespec");
            check(call(e, 346, epoll, output, 1, 0, ts, 4) == -22, "invalid sigset size");
            check(call(e, 346, epoll, output, 1, 0, ts, 8) == -95, "temporary masks explicitly unsupported");
            ev.setInt(0, 1 | 0x80000000); ev.setLong(8, 10);
            check(call(e, 251, epoll, 3, first, event) == 0, "edge MOD");
            buffer.setLong(0, 1); check(call(e, 4, first, address, 8) == 8, "edge write");
            check(call(e, 252, epoll, output, 1, 0) == 1 && results.getLong(8) == 10, "edge delivered");
            check(call(e, 252, epoll, output, 1, 0) == 0, "edge not repeated");
            check(call(e, 3, first, address, 8) == 8, "edge drain");
            buffer.setLong(0, 1); check(call(e, 4, first, address, 8) == 8 && call(e, 252, epoll, output, 1, 0) == 1, "next edge");
            buffer.setLong(0, 1); check(call(e, 4, first, address, 8) == 8 && call(e, 252, epoll, output, 1, 0) == 1, "another write notifies edge even before drain");
            ev.setInt(0, 1 | 0x40000000); ev.setLong(8, 11);
            check(call(e, 251, epoll, 3, first, event) == 0 && call(e, 252, epoll, output, 1, 0) == 1, "oneshot delivered");
            check(call(e, 252, epoll, output, 1, 0) == 0, "oneshot disabled");
            check(call(e, 251, epoll, 3, first, event) == 0 && call(e, 252, epoll, output, 1, 0) == 1, "oneshot rearmed");
            ev.setInt(0, 1); ev.setLong(8, 22);
            check(call(e, 251, epoll, 3, first, event) == 0, "level MOD");
            ev.setLong(8, 33); check(call(e, 251, epoll, 1, second, event) == 0, "second fd ADD");
            check(call(e, 252, epoll, output, 1, 0) == 1 && results.getLong(8) == 22, "first level delivery");
            check(call(e, 252, epoll, output, 1, 0) == 1 && results.getLong(8) == 33, "maxevents fair rotation");
            check(call(e, 251, epoll, 2, first, 0) == 0 && call(e, 251, epoll, 2, first, 0) == -2, "DEL ignores event pointer");
            check(call(e, 6, second) == 0 && call(e, 252, epoll, output, 2, 0) == 0, "closed targets removed");
            check(call(e, 6, first) == 0 && call(e, 6, epoll) == 0, "epoll cleanup");
            final int blocking = call(e, 356, 0, 0);
            AndroidFileIO blockingFile = (AndroidFileIO) e.getSyscallHandler().getFileIO(blocking);
            later(e, () -> check(blockingFile.write(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(42).array()) == 8, "scheduled increment"));
            check(call(e, 3, blocking, address, 8) == 8 && buffer.getLong(0) == 42, "blocking read resumes on actual increment");
            buffer.setLong(0, -2L); check(call(e, 4, blocking, address, 8) == 8, "fill blocking counter");
            final UnidbgPointer scheduledBuffer = buffer.share(768, 8);
            later(e, () -> check(blockingFile.read(e.getBackend(), scheduledBuffer, 8) == 8, "scheduled drain"));
            buffer.setLong(0, 3);
            check(call(e, 4, blocking, address, 8) == 8 && scheduledBuffer.getLong(0) == -2L, "blocking overflow write resumes after drain");
            check(call(e, 3, blocking, address, 8) == 8 && buffer.getLong(0) == 3, "deferred write preserved value");
            int waitingPoll = call(e, 357, 0);
            ev.setInt(0, 1); ev.setLong(8, 44);
            check(call(e, 251, waitingPoll, 1, blocking, event) == 0, "blocking epoll register");
            later(e, () -> check(blockingFile.write(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(1).array()) == 8, "scheduled epoll event"));
            check(call(e, 252, waitingPoll, output, 1, -1) == 1 && results.getLong(8) == 44, "infinite epoll wait wakes on actual event");
            int surviving = call(e, 41, blocking);
            check(call(e, 6, blocking) == 0 && call(e, 252, waitingPoll, output, 1, 0) == 1, "registration survives while dup remains");
            int reused = call(e, 356, 1, 0x800);
            check(reused == blocking, "closed descriptor number reused");
            ev.setLong(8, 55); check(call(e, 251, waitingPoll, 1, reused, event) == 0, "reused fd is distinct open file description");
            check(call(e, 252, waitingPoll, output, 2, 0) == 2, "old and new registration coexist");
            check(call(e, 6, surviving) == 0 && call(e, 252, waitingPoll, output, 2, 0) == 1 && results.getLong(8) == 55, "last dup close removes only original registration");
            check(call(e, 6, reused) == 0 && call(e, 6, waitingPoll) == 0, "blocking cleanup");
            int writable = call(e, 356, 0, 0x800), writePoll = call(e, 357, 0);
            ev.setInt(0, 4 | 0x80000000); ev.setLong(8, 66);
            check(call(e, 251, writePoll, 1, writable, event) == 0, "register writable edge");
            check(call(e, 252, writePoll, output, 1, 0) == 1 && results.getInt(0) == 4, "empty counter writable");
            check(call(e, 252, writePoll, output, 1, 0) == 0, "write edge consumed");
            buffer.setLong(0, -2L); check(call(e, 4, writable, address, 8) == 8, "fill writable counter");
            check(call(e, 252, writePoll, output, 1, 0) == 0, "full counter not writable");
            check(call(e, 3, writable, address, 8) == 8 && call(e, 252, writePoll, output, 1, 0) == 1, "drain generates writable edge");
            ev.setInt(0, 0x10000000);
            check(call(e, 251, writePoll, 3, writable, event) == -95, "unknown event flags rejected");
            int directory = e.getSyscallHandler().addFileIO(e.getFileSystem().createDirectoryFileIO(new File(args[0]), 0, "/fixture"));
            ev.setInt(0, 1);
            check(call(e, 251, writePoll, 1, directory, event) == -95, "no fake readiness for unsupported descriptors");
            check(call(e, 6, directory) == 0 && call(e, 6, writable) == 0 && call(e, 6, writePoll) == 0, "writable cleanup");
            System.out.println("arm-eventfd-ok");
        }
    }
}
