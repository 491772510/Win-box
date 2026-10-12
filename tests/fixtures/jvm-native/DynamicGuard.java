package fixture;
public class DynamicGuard {
    static { System.setProperty("winbox.dynamic.clinit", "correct-loader"); }
    public static native Object getLoader(Object context);
    public static native int sidecarAbi();
    public static void load(String path) { System.load(path); }
    public static String marker() { return System.getProperty("winbox.dynamic.clinit"); }
}
