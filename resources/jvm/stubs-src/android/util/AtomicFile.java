package android.util;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Android AtomicFile: commit via a sibling file; failed writes preserve the last good data. */
public class AtomicFile {
    private final File base;
    private final File pending;
    private final File backup;

    public AtomicFile(File base) {
        this.base = base;
        this.pending = new File(base.getPath() + ".new");
        this.backup = new File(base.getPath() + ".bak");
    }

    public AtomicFile(File base, String commitTag) { this(base); }
    public File getBaseFile() { return base; }

    public void delete() {
        base.delete(); pending.delete(); backup.delete();
    }

    private void restoreBackup() throws IOException {
        if (backup.exists()) Files.move(backup.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    public FileOutputStream startWrite() throws IOException {
        restoreBackup();
        File parent = pending.getAbsoluteFile().getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IOException("Cannot create AtomicFile directory: " + parent);
        }
        return new FileOutputStream(pending);
    }

    public void finishWrite(FileOutputStream stream) {
        if (stream == null) return;
        try {
            stream.getFD().sync();
            stream.close();
            try {
                Files.move(pending.toPath(), base.toPath(), StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
                Files.move(pending.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException error) {
            try { stream.close(); } catch (IOException ignored) { }
            System.err.println("[AtomicFile] Commit failed: " + error);
        }
    }

    public void failWrite(FileOutputStream stream) {
        if (stream == null) return;
        try { stream.close(); } catch (IOException ignored) { }
        pending.delete();
    }

    public FileInputStream openRead() throws IOException {
        restoreBackup();
        // An unfinished first write must not become a committed file.
        if (base.exists()) pending.delete();
        return new FileInputStream(base);
    }

    public byte[] readFully() throws IOException {
        try (FileInputStream stream = openRead(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int n;
            while ((n = stream.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }
}
