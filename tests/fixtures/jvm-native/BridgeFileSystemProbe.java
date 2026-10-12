import com.winbox.nativebridge.BridgeARM32Emulator;
import com.github.unidbg.arm.backend.Unicorn2Factory;
import com.github.unidbg.file.linux.AndroidFileIO;
import com.github.unidbg.file.FileResult;
import com.github.unidbg.file.FileSystem;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class BridgeFileSystemProbe {
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        File sandbox = new File(args[0], "sandbox"), outside = new File(args[0], "outside.txt");
        check(sandbox.mkdirs(), "fixture sandbox");
        Files.writeString(outside.toPath(), "outside must stay untouched");
        System.setProperty("tvbox.spiderCacheDir", sandbox.getAbsolutePath());
        try (BridgeARM32Emulator e = new BridgeARM32Emulator("fixture.files", new File(args[0], "rootfs"), Collections.singletonList(new Unicorn2Factory(true)))) {
            if (File.separatorChar == '\\') {
                FileSystem<AndroidFileIO> fs = e.getFileSystem();
                String directory = new File(sandbox, "cache/pvc").getAbsolutePath();
                check(fs.mkdir("/" + directory, 0700) && new File(directory).isDirectory(), "Go Windows mkdir mapped to actual sandbox");
                FileResult<AndroidFileIO> stat = fs.open("/" + directory.replace('\\', '/'), 0);
                check(stat.isSuccess(), "Go normalized stat path finds same directory"); stat.io.close();
                String file = new File(directory, "test.bin").getAbsolutePath();
                FileResult<AndroidFileIO> opened = fs.open(file, 0x42); // O_CREAT|O_RDWR
                check(opened.isSuccess(), "host-path open");
                check(opened.io.write("real persisted bytes".getBytes(StandardCharsets.UTF_8)) == 20, "actual write"); opened.io.close();
                check(Files.readString(new File(file).toPath()).equals("real persisted bytes"), "native and Java share storage");
                check(fs.open(file, 0xc2).errno == 17, "exclusive create");
                String renamed = new File(directory, "renamed.bin").getAbsolutePath();
                check(fs.rename(file, renamed) == 0 && !new File(file).exists(), "real rename");
                fs.unlink(renamed); check(!new File(renamed).exists(), "real unlink");
                fs.rmdir(directory); check(!new File(directory).exists(), "empty directory removal");
                check(fs.open(outside.getAbsolutePath(), 0).errno == 13, "host access outside sandbox denied");
                check(!fs.mkdir(new File(args[0], "forbidden").getAbsolutePath(), 0700), "outside mkdir denied");
                check(fs.open(new File(sandbox, "../outside.txt").getAbsolutePath(), 0).errno == 13, "traversal denied");
                check(fs.open(sandbox.getAbsolutePath() + "-suffix/file", 0x42).errno == 13, "boundary is directory not string prefix");
                check(fs.open("//localhost/C$/Windows", 0).errno == 13, "UNC denied");
                check(fs.rename(outside.getAbsolutePath(), new File(sandbox, "copied").getAbsolutePath()) == -13, "outside rename denied");
                check(fs.rename("/guest.txt", new File(sandbox, "copied").getAbsolutePath()) == -18, "cross filesystem rename rejected");
                try { fs.unlink(outside.getAbsolutePath()); throw new AssertionError("outside unlink"); } catch (SecurityException expected) { }
                try { fs.rmdir(sandbox.getAbsolutePath()); throw new AssertionError("sandbox removal"); } catch (SecurityException expected) { }
                check(Files.readString(outside.toPath()).equals("outside must stay untouched"), "outside sentinel preserved");
                check(fs.mkdir("/ordinary/guest", 0700), "POSIX rootfs unaffected");
                check(new File(e.getFileSystem().getRootDir(), "ordinary/guest").isDirectory(), "guest path stays under rootfs");
                // Junctions require no admin privileges on Windows and are an
                // important cache escape case. Create one only in this fixture.
                File link = new File(sandbox, "junction"), external = new File(args[0], "external");
                check(external.mkdir(), "junction target");
                Process mklink = new ProcessBuilder("cmd.exe", "/c", "mklink", "/J", link.getAbsolutePath(), external.getAbsolutePath()).redirectErrorStream(true).start();
                mklink.getInputStream().readAllBytes();
                check(mklink.waitFor() == 0, "fixture junction created");
                try { check(fs.open(new File(link, "escape.bin").getAbsolutePath(), 0x42).errno == 13, "junction escape denied"); }
                finally { Files.delete(link.toPath()); }
                check(!new File(external, "escape.bin").exists(), "no escaped file created");
            }
        }
        System.out.println("bridge-files-ok");
    }
}
