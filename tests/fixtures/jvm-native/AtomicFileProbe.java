import android.util.AtomicFile;
import com.winbox.nativebridge.PosixFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class AtomicFileProbe {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        File root = new File(args[0]);
        AtomicFile file = new AtomicFile(new File(root, "nested/data"));
        FileOutputStream out = file.startWrite();
        out.write("good".getBytes(StandardCharsets.UTF_8));
        file.finishWrite(out);
        check(new String(file.readFully(), StandardCharsets.UTF_8).equals("good"), "commit");
        out = file.startWrite(); out.write(1); file.failWrite(out);
        check(new String(file.readFully(), StandardCharsets.UTF_8).equals("good"), "rollback");
        Files.write(new File(root, "nested/data.new").toPath(), new byte[]{1});
        check(file.readFully().length == 4 && !new File(root, "nested/data.new").exists(), "interrupted write");
        Files.write(new File(root, "nested/data.bak").toPath(), new byte[]{2, 3});
        check(file.readFully().length == 2, "legacy backup");
        file.delete(); check(!file.getBaseFile().exists(), "delete");
        AtomicFile fresh = new AtomicFile(new File(root, "fresh"), "tag");
        out = fresh.startWrite(); out.write(4); out.close();
        try { fresh.openRead(); throw new AssertionError("uncommitted first write"); }
        catch (java.io.FileNotFoundException expected) { }
        fresh.delete();
        PosixFile.setRootfs(null);
        PosixFile direct = new PosixFile(new File(root, "direct").getPath());
        check(direct.mkdirs() && direct.exists() && direct.isDirectory(), "no rootfs recursion");
        PosixFile.setRootfs(new File(root, "guest"));
        PosixFile guest = new PosixFile("/data/files");
        check(guest.mkdirs() && guest.isDirectory(), "guest mapping");
        check(new File(root, "guest/data/files").isDirectory(), "mapped host directory");
        System.out.println("atomic-file-and-posix-ok");
    }
}
