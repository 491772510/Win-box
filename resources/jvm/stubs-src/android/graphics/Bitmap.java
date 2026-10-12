package android.graphics;

import java.io.OutputStream;

/**
 * Bitmap stub —— 位图对象（纯内存占位）。
 *
 * ★ 2026-10-12（wexshinidie 支持）：此前本类只在基线 stubs.jar 里，且
 *   `createBitmap` 直接抛 UnsupportedOperationException("desktop stub")。
 *   实测后果：wex 壳（wexshinidie）解密出的真实 Spider（如 PanConfig 配置中心）
 *   在 categoryContent 里构建界面缩略图时调用 createBitmap → 异常冒泡到
 *   桥接层 → 该源整体「无数据」。桌面无 Android 图形栈，位图本身没有意义，
 *   但**抛异常会中断整条业务链**，所以这里改为「宽容降级」：返回一个记住
 *   宽高的占位对象，后续 compress/draw 全部空操作。
 *
 *   与 BitmapFactory（decode* 返回 null）的设计一致：图形能力缺失不应让
 *   文本链路失败 —— 蜘蛛拿到占位对象即可继续走完接口调用。
 *
 * 字段/方法签名与 Android SDK 对齐（缺签名会抛 NoSuchMethodError，比
 * ClassNotFoundException 更隐蔽，见 build-stubs.sh 头部说明）。
 */
public class Bitmap {

    public enum Config {
        ALPHA_8, RGB_565, ARGB_4444, ARGB_8888
    }

    public enum CompressFormat {
        JPEG, PNG, WEBP, WEBP_LOSSLESS, WEBP_LOSSY
    }

    private final int width;
    private final int height;
    private boolean recycled;

    public Bitmap() {
        this(0, 0);
    }

    private Bitmap(int width, int height) {
        this.width = width;
        this.height = height;
    }

    // ------------------------------------------------------------------
    // 工厂：全部返回占位对象（不再抛异常）
    // ------------------------------------------------------------------

    public static Bitmap createBitmap(int width, int height, Config config) {
        return new Bitmap(width, height);
    }

    public static Bitmap createBitmap(int width, int height, Config config, boolean hasAlpha) {
        return new Bitmap(width, height);
    }

    public static Bitmap createBitmap(Bitmap src) {
        return src == null ? new Bitmap(0, 0) : new Bitmap(src.width, src.height);
    }

    public static Bitmap createBitmap(Bitmap src, int x, int y, int width, int height) {
        return new Bitmap(width, height);
    }

    public static Bitmap createBitmap(Bitmap source, int x, int y, int width, int height,
                                      Matrix m, boolean filter) {
        return new Bitmap(width, height);
    }

    public static Bitmap createBitmap(int[] colors, int width, int height, Config config) {
        return new Bitmap(width, height);
    }

    public static Bitmap createBitmap(int[] colors, int offset, int stride, int width,
                                      int height, Config config) {
        return new Bitmap(width, height);
    }

    /** 按比例缩放：返回同尺寸占位（真正缩放由渲染层负责）。 */
    public static Bitmap createScaledBitmap(Bitmap src, int dstWidth, int dstHeight, boolean filter) {
        return new Bitmap(dstWidth, dstHeight);
    }

    // ------------------------------------------------------------------
    // 实例属性 / 操作：全部降级
    // ------------------------------------------------------------------

    public int getWidth() {
        return width;
    }

    public int getHeight() {
        return height;
    }

    public int getRowBytes() {
        return width * 4;
    }

    public int getByteCount() {
        return width * height * 4;
    }

    public int getDensity() {
        return 160;
    }

    public void setDensity(int density) { }

    public Config getConfig() {
        return Config.ARGB_8888;
    }

    public boolean isRecycled() {
        return recycled;
    }

    public void recycle() {
        recycled = true;
    }

    public boolean isMutable() {
        return false;
    }

    /** 压缩：桌面不产出图片字节，恒返回 false（调用方按「压缩失败」处理）。 */
    public boolean compress(CompressFormat format, int quality, OutputStream stream) {
        return false;
    }

    public void getPixels(int[] pixels, int offset, int stride, int x, int y, int width, int height) { }

    public void setPixels(int[] pixels, int offset, int stride, int x, int y, int width, int height) { }

    public int getPixel(int x, int y) {
        return 0;
    }

    public void setPixel(int x, int y, int color) { }

    public void eraseColor(int color) { }

    public Bitmap copy(Config config, boolean isMutable) {
        return new Bitmap(width, height);
    }

    public boolean sameAs(Bitmap other) {
        return other == this;
    }

    public String toString() {
        return "Bitmap(" + width + "x" + height + ")";
    }
}
