package android.security.keystore;

import java.security.spec.AlgorithmParameterSpec;

/** AES key-generation parameters used by Android spiders; no hardware attestation is emulated. */
public final class KeyGenParameterSpec implements AlgorithmParameterSpec {
    private final String alias;
    private final int purposes;
    private final int size;
    private final boolean authentication;
    private final String[] modes, paddings;
    private KeyGenParameterSpec(Builder b) {
        alias = b.alias; purposes = b.purposes; size = b.size; authentication = b.authentication;
        modes = b.modes.clone(); paddings = b.paddings.clone();
    }
    public String getKeystoreAlias() { return alias; }
    public int getPurposes() { return purposes; }
    public int getKeySize() { return size; }
    public boolean isUserAuthenticationRequired() { return authentication; }
    public String[] getBlockModes() { return modes.clone(); }
    public String[] getEncryptionPaddings() { return paddings.clone(); }
    public static final class Builder {
        private final String alias;
        private final int purposes;
        private int size = 256;
        private boolean authentication;
        private String[] modes = new String[0], paddings = new String[0];
        public Builder(String alias, int purposes) {
            if (alias == null || alias.isEmpty()) throw new IllegalArgumentException("Empty key alias");
            this.alias = alias; this.purposes = purposes;
        }
        public Builder setKeySize(int size) { this.size = size; return this; }
        public Builder setBlockModes(String... modes) { this.modes = modes.clone(); return this; }
        public Builder setEncryptionPaddings(String... paddings) { this.paddings = paddings.clone(); return this; }
        public Builder setUserAuthenticationRequired(boolean required) { authentication = required; return this; }
        public KeyGenParameterSpec build() { return new KeyGenParameterSpec(this); }
    }
}
