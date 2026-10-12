package android.security.keystore;

import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileLock;
import java.security.*;
import java.security.cert.Certificate;
import java.security.spec.AlgorithmParameterSpec;
import java.util.*;
import javax.crypto.KeyGeneratorSpi;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Windows software compatibility provider. AES secrets at rest are protected by user-scoped DPAPI.
 * This is not an Android hardware keystore and does not emulate authentication or attestation. */
public final class DesktopKeyStoreProvider extends Provider {
    public DesktopKeyStoreProvider() {
        super("AndroidKeyStore", "1.0", "Win-Box user-scoped DPAPI AES keystore compatibility");
        put("KeyStore.AndroidKeyStore", Store.class.getName());
        put("KeyGenerator.AES", AesGenerator.class.getName());
    }

    public static void install() {
        if (Security.getProvider("AndroidKeyStore") == null) Security.addProvider(new DesktopKeyStoreProvider());
    }

    private static File root() throws IOException {
        String base = System.getProperty("tvbox.spiderCacheDir", "").trim();
        if (base.isEmpty()) throw new IOException("Keystore requires an explicit spider data directory");
        File dir = new File(base, "keystore");
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("Cannot create keystore");
        return dir;
    }

    private static File file(String alias) throws IOException {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(alias.getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder();
            for (byte b : hash) name.append(String.format(Locale.ROOT, "%02x", b & 255));
            return new File(root(), name + ".dpapi");
        } catch (NoSuchAlgorithmException e) { throw new IOException(e); }
    }

    private static byte[] protect(byte[] data, boolean encrypt) throws IOException {
        if (!System.getProperty("os.name", "").startsWith("Windows")) {
            throw new IOException("Desktop AndroidKeyStore currently requires Windows DPAPI");
        }
        String systemRoot = System.getenv("SystemRoot");
        if (systemRoot == null) throw new IOException("Windows system directory unavailable");
        File exe = new File(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
        String script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; "
                + "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); "
                + "$r=[Security.Cryptography.ProtectedData]::" + (encrypt ? "Protect" : "Unprotect")
                + "($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); "
                + "[Console]::Out.Write([Convert]::ToBase64String($r))";
        String encoded = Base64.getEncoder().encodeToString(script.getBytes(StandardCharsets.UTF_16LE));
        Process process = new ProcessBuilder(exe.getPath(), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded).start();
        try {
            try (OutputStream out = process.getOutputStream()) { out.write(Base64.getEncoder().encode(data)); }
            if (!process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)) {
                process.destroyForcibly(); throw new IOException("DPAPI operation timed out");
            }
            if (process.exitValue() != 0) throw new IOException("DPAPI operation failed (key/user mismatch or OS error)");
            try (InputStream in = process.getInputStream()) {
                return Base64.getDecoder().decode(new String(in.readAllBytes(), StandardCharsets.US_ASCII).trim());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); process.destroyForcibly(); throw new IOException(e);
        } finally { process.destroy(); }
    }

    private static SecretKey read(String alias) throws IOException {
        File path = file(alias);
        if (!path.isFile() && !new File(path + ".bak").isFile()) return null;
        byte[] key = protect(new AtomicFile(path).readFully(), false);
        if (key.length != 16 && key.length != 24 && key.length != 32) throw new IOException("Invalid AES key length");
        return new SecretKeySpec(key, "AES");
    }

    private interface KeyOperation<T> { T run() throws IOException; }

    // FileLock alone throws OverlappingFileLockException for concurrent threads in one JVM.
    // Use both locks; reads/deletes must not race AtomicFile's backup recovery or a commit.
    private static synchronized <T> T withAliasLock(String alias, KeyOperation<T> operation) throws IOException {
        File path = file(alias);
        try (RandomAccessFile lock = new RandomAccessFile(path + ".lock", "rw"); FileLock ignored = lock.getChannel().lock()) {
            return operation.run();
        }
    }

    public static final class AesGenerator extends KeyGeneratorSpi {
        private KeyGenParameterSpec spec;
        private SecureRandom random = new SecureRandom();
        @Override protected void engineInit(SecureRandom random) { spec = null; throw new InvalidParameterException("Alias required"); }
        @Override protected void engineInit(int size, SecureRandom random) { spec = null; throw new InvalidParameterException("Alias required"); }
        @Override protected void engineInit(AlgorithmParameterSpec params, SecureRandom random) throws InvalidAlgorithmParameterException {
            spec = null;
            if (!(params instanceof KeyGenParameterSpec)) throw new InvalidAlgorithmParameterException("KeyGenParameterSpec required");
            KeyGenParameterSpec candidate = (KeyGenParameterSpec) params;
            if (candidate.isUserAuthenticationRequired()) throw new InvalidAlgorithmParameterException("Hardware authentication is not available on desktop");
            if (candidate.getKeySize() != 128 && candidate.getKeySize() != 192 && candidate.getKeySize() != 256) throw new InvalidAlgorithmParameterException("Invalid AES size");
            spec = candidate;
            if (random != null) this.random = random;
        }
        @Override protected SecretKey engineGenerateKey() {
            if (spec == null) throw new IllegalStateException("Key generator not initialized");
            try {
                return withAliasLock(spec.getKeystoreAlias(), () -> {
                    File path = file(spec.getKeystoreAlias());
                    byte[] bytes = new byte[spec.getKeySize() / 8]; random.nextBytes(bytes);
                    byte[] encrypted = protect(bytes, true);
                    AtomicFile atomic = new AtomicFile(path);
                    FileOutputStream out = atomic.startWrite();
                    try {
                        out.write(encrypted); atomic.finishWrite(out);
                        // Android finishWrite logs IO errors rather than throwing: never return an
                        // unpersisted replacement merely because an older committed file exists.
                        if (!Arrays.equals(encrypted, atomic.readFully())) throw new IOException("AES key commit failed");
                    }
                    catch (IOException e) { atomic.failWrite(out); throw e; }
                    return new SecretKeySpec(bytes, "AES");
                });
            } catch (IOException e) { throw new ProviderException("Desktop AES key storage failed", e); }
        }
    }

    public static final class Store extends KeyStoreSpi {
        @Override public Key engineGetKey(String alias, char[] password) throws UnrecoverableKeyException {
            try { return withAliasLock(alias, () -> read(alias)); }
            catch (IOException e) { UnrecoverableKeyException error = new UnrecoverableKeyException(e.getMessage()); error.initCause(e); throw error; }
        }
        @Override public boolean engineContainsAlias(String alias) {
            try { return withAliasLock(alias, () -> {
                File path = file(alias);
                if (!path.isFile() && !new File(path + ".bak").isFile()) return false;
                try (InputStream ignored = new AtomicFile(path).openRead()) { return true; }
            }); } catch (IOException e) { throw new ProviderException(e); }
        }
        @Override public void engineDeleteEntry(String alias) throws KeyStoreException {
            try { withAliasLock(alias, () -> {
                File path = file(alias);
                new AtomicFile(path).delete();
                if (path.exists() || new File(path + ".bak").exists() || new File(path + ".new").exists()) {
                    throw new IOException("AES key deletion failed");
                }
                return null;
            }); }
            catch (IOException e) { throw new KeyStoreException(e); }
        }
        @Override public Date engineGetCreationDate(String alias) { try { File f = file(alias); return f.isFile() ? new Date(f.lastModified()) : null; } catch (IOException e) { throw new ProviderException(e); } }
        @Override public boolean engineIsKeyEntry(String alias) { return engineContainsAlias(alias); }
        @Override public boolean engineIsCertificateEntry(String alias) { return false; }
        @Override public Certificate[] engineGetCertificateChain(String alias) { return null; }
        @Override public Certificate engineGetCertificate(String alias) { return null; }
        @Override public String engineGetCertificateAlias(Certificate cert) { return null; }
        @Override public Enumeration<String> engineAliases() { throw new UnsupportedOperationException("Alias enumeration is not supported"); }
        @Override public int engineSize() { try { String[] files = root().list((dir, name) -> name.endsWith(".dpapi")); return files == null ? 0 : files.length; } catch (IOException e) { throw new ProviderException(e); } }
        @Override public void engineSetKeyEntry(String alias, Key key, char[] password, Certificate[] chain) throws KeyStoreException { throw new KeyStoreException("Use KeyGenerator with a KeyGenParameterSpec"); }
        @Override public void engineSetKeyEntry(String alias, byte[] key, Certificate[] chain) throws KeyStoreException { throw new KeyStoreException("Imported keys are not supported"); }
        @Override public void engineSetCertificateEntry(String alias, Certificate cert) throws KeyStoreException { throw new KeyStoreException("Certificates are not supported"); }
        @Override public void engineStore(OutputStream out, char[] password) throws IOException { throw new IOException("Keystore is persisted automatically"); }
        @Override public void engineLoad(InputStream in, char[] password) throws IOException { if (in != null) throw new IOException("External keystores are not supported"); root(); }
        @Override public void engineLoad(KeyStore.LoadStoreParameter params) throws IOException { if (params != null) throw new IOException("Load parameters are not supported"); root(); }
    }
}
