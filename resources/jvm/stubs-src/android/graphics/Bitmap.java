package android.graphics;

import java.awt.image.BufferedImage;
import java.io.OutputStream;

import javax.imageio.ImageIO;

/**
 * Bitmap stub —— 位图对象（**真实像素实现**，桌面端用 java.desktop 编解码）。
 *
 * ★ 设计演进（重要，别改回去）：
 *   ① 最初（基线 stubs.jar）：`createBitmap` 直接抛 UnsupportedOperationException("desktop stub")
 *      → wex 壳（wexshinidie）解密出的真实 Spider 在构建界面图时异常冒泡，
 *        整个源「无数据」。见 PanConfig 的 categoryContent 图标路径。
 *   ② 第一版修复：改成「宽容降级」—— 返回只记宽高的占位对象，
 *      setPixels/compress 全部空操作。业务链路不再中断 ✔
 *      但引入了**静默错误**：调用方以为图生成完了，实际拿到 0 字节。
 *      实证：配置中心网页的二维码接口（merge.f.b.u → x0.e.F）返回
 *      `HTTP 200 image/png` + **size=0**，页面 `<img>` 空白 → 「扫码不显示二维码」。
 *   ③ 本版：**真做**。像素数组真实读写，compress() 用 ImageIO 编码出真 PNG/JPEG。
 *      java.desktop 在随包 JRE 的 MODULES 里（已核对 release 文件），可用。
 *
 *   结论：桌面缺图形栈 ≠ 可以假装成功。凡是「产物会被拿去用」的 API
 *   （compress / getPixels / createScaledBitmap）必须真实现；
 *   只有「纯 UI 效果」的才允许 no-op（如 Canvas.drawXxx）。
 *
 * 容错原则（保持不变）：**任何情况下都不抛异常**，失败返回 null/false，
 *   让调用方按「图不可用」自行降级 —— 异常会中断整条业务链。
 *   注意 catch Throwable：NoClassDefFoundError（java.desktop 缺失的 jlink 运行时）
 *   是 Error 不是 Exception。
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

    /** 像素数上限：超过则不分配数组（只保留尺寸），避免 -Xmx384m 下 OOM。 */
    private static final long MAX_PIXELS = 4_000_000L;

    private static final int WHITE = 0xFFFFFFFF;
    private static final int BLACK = 0xFF000000;

    private final int width;
    private final int height;
    private final Config config;
    /** ARGB_8888 像素；超限时为 null（此时按全白处理）。 */
    private int[] pixels;
    private volatile boolean recycled;
    private int density = 160;
    private int generationId = 1;

    public Bitmap() {
        this(0, 0, Config.ARGB_8888);
    }

    private Bitmap(int width, int height, Config config) {
        this.width = width < 0 ? 0 : width;
        this.height = height < 0 ? 0 : height;
        this.config = config == null ? Config.ARGB_8888 : config;
        long n = (long) this.width * (long) this.height;
        if (n > 0 && n <= MAX_PIXELS) {
            this.pixels = new int[(int) n];
            java.util.Arrays.fill(this.pixels, WHITE); // Android 新建位图默认全透明；桌面按白底更实用
        }
    }

    // ------------------------------------------------------------------
    // 工厂：永不抛异常；分配失败 → 返回仍可用（尺寸正确）的对象
    // ------------------------------------------------------------------

    public static Bitmap createBitmap(int width, int height, Config config) {
        return new Bitmap(width, height, config);
    }

    public static Bitmap createBitmap(int width, int height, Config config, boolean hasAlpha) {
        return new Bitmap(width, height, config);
    }

    public static Bitmap createBitmap(Bitmap src) {
        if (src == null) return new Bitmap(0, 0, Config.ARGB_8888);
        Bitmap out = new Bitmap(src.width, src.height, src.config);
        out.copyPixelsFrom(src, 0, 0, 0, 0, src.width, src.height);
        return out;
    }

    public static Bitmap createBitmap(Bitmap src, int x, int y, int width, int height) {
        if (src == null) return new Bitmap(width, height, Config.ARGB_8888);
        Bitmap out = new Bitmap(width, height, src.config);
        out.copyPixelsFrom(src, x, y, 0, 0, width, height);
        return out;
    }

    public static Bitmap createBitmap(Bitmap source, int x, int y, int width, int height,
                                      Matrix m, boolean filter) {
        return createBitmap(source, x, y, width, height); // 变换矩阵忽略（桌面无渲染意义）
    }

    public static Bitmap createBitmap(int[] colors, int width, int height, Config config) {
        return createBitmap(colors, 0, width, width, height, config);
    }

    public static Bitmap createBitmap(int[] colors, int offset, int stride, int width,
                                      int height, Config config) {
        Bitmap out = new Bitmap(width, height, config);
        if (colors != null && out.pixels != null) {
            out.blit(colors, offset, stride, 0, 0, width, height);
        }
        return out;
    }

    /** 缩放：真实最近邻缩放（保内容，避免返回空白图）。 */
    public static Bitmap createScaledBitmap(Bitmap src, int dstWidth, int dstHeight, boolean filter) {
        if (src == null) return new Bitmap(dstWidth, dstHeight, Config.ARGB_8888);
        Bitmap out = new Bitmap(dstWidth, dstHeight, src.config);
        if (src.pixels == null || out.pixels == null) return out;
        if (dstWidth <= 0 || dstHeight <= 0 || src.width <= 0 || src.height <= 0) return out;
        if (dstWidth == src.width && dstHeight == src.height) {
            System.arraycopy(src.pixels, 0, out.pixels, 0, src.pixels.length);
            return out;
        }
        for (int y = 0; y < dstHeight; y++) {
            int sy = (int) ((long) y * src.height / dstHeight);
            if (sy >= src.height) sy = src.height - 1;
            int rowOut = y * dstWidth;
            int rowSrc = sy * src.width;
            for (int x = 0; x < dstWidth; x++) {
                int sx = (int) ((long) x * src.width / dstWidth);
                if (sx >= src.width) sx = src.width - 1;
                out.pixels[rowOut + x] = src.pixels[rowSrc + sx];
            }
        }
        return out;
    }

    // ------------------------------------------------------------------
    // 属性
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
        return density;
    }

    public void setDensity(int density) {
        this.density = density;
    }

    public Config getConfig() {
        return config;
    }

    public boolean hasAlpha() {
        return config == Config.ARGB_8888 || config == Config.ARGB_4444 || config == Config.ALPHA_8;
    }

    public int getGenerationId() {
        return generationId;
    }

    public boolean isRecycled() {
        return recycled;
    }

    public void recycle() {
        recycled = true;
    }

    public boolean isMutable() {
        return !recycled;
    }

    public boolean sameAs(Bitmap other) {
        if (other == this) return true;
        if (other == null || other.width != width || other.height != height) return false;
        if (pixels == null || other.pixels == null) return pixels == other.pixels;
        return java.util.Arrays.equals(pixels, other.pixels);
    }

    // ------------------------------------------------------------------
    // 像素读写：真实现（越界一律静默忽略，绝不抛异常）
    // ------------------------------------------------------------------

    public void getPixels(int[] out, int offset, int stride, int x, int y, int w, int h) {
        if (out == null || pixels == null || recycled) return;
        for (int row = 0; row < h; row++) {
            int sy = y + row;
            if (sy < 0 || sy >= height) continue;
            int dst = offset + row * stride;
            int src = sy * width;
            for (int col = 0; col < w; col++) {
                int sx = x + col;
                int di = dst + col;
                if (sx < 0 || sx >= width || di < 0 || di >= out.length) continue;
                out[di] = pixels[src + sx];
            }
        }
    }

    public void setPixels(int[] in, int offset, int stride, int x, int y, int w, int h) {
        if (in == null || recycled) return;
        if (pixels == null) { // 超限位图：不保存像素，但仍算「写入成功」，调用方不必感知
            generationId++;
            return;
        }
        blit(in, offset, stride, x, y, w, h);
        generationId++;
    }

    private void blit(int[] in, int offset, int stride, int x, int y, int w, int h) {
        for (int row = 0; row < h; row++) {
            int dy = y + row;
            if (dy < 0 || dy >= height) continue;
            int src = offset + row * stride;
            int dst = dy * width;
            for (int col = 0; col < w; col++) {
                int dx = x + col;
                int si = src + col;
                if (dx < 0 || dx >= width || si < 0 || si >= in.length) continue;
                pixels[dst + dx] = in[si];
            }
        }
    }

    private void copyPixelsFrom(Bitmap src, int x, int y, int dx0, int dy0, int w, int h) {
        if (src.pixels == null || pixels == null) return;
        for (int row = 0; row < h; row++) {
            int sy = y + row;
            int dy = dy0 + row;
            if (sy < 0 || sy >= src.height || dy < 0 || dy >= height) continue;
            for (int col = 0; col < w; col++) {
                int sx = x + col;
                int dx = dx0 + col;
                if (sx < 0 || sx >= src.width || dx < 0 || dx >= width) continue;
                pixels[dy * width + dx] = src.pixels[sy * src.width + sx];
            }
        }
    }

    public int getPixel(int x, int y) {
        if (pixels == null || x < 0 || y < 0 || x >= width || y >= height) return 0;
        return pixels[y * width + x];
    }

    public void setPixel(int x, int y, int color) {
        if (pixels == null || x < 0 || y < 0 || x >= width || y >= height) return;
        pixels[y * width + x] = color;
        generationId++;
    }

    public void eraseColor(int color) {
        if (pixels == null) return;
        java.util.Arrays.fill(pixels, color);
        generationId++;
    }

    public Bitmap copy(Config config, boolean isMutable) {
        Bitmap out = new Bitmap(width, height, config);
        out.copyPixelsFrom(this, 0, 0, 0, 0, width, height);
        return out;
    }

    // ------------------------------------------------------------------
    // ★ 核心：真编码。调用方（如二维码接口 merge.f.b.u）拿到的就是真图片字节。
    // ------------------------------------------------------------------

    public boolean compress(CompressFormat format, int quality, OutputStream stream) {
        if (stream == null || recycled || width <= 0 || height <= 0) return false;
        try {
            boolean jpeg = format == CompressFormat.JPEG;
            // JPEG 不支持 alpha：铺白底，否则 ImageIO 写 jpg 会报色彩空间错
            BufferedImage img = new BufferedImage(
                    width, height, jpeg ? BufferedImage.TYPE_INT_RGB : BufferedImage.TYPE_INT_ARGB);
            int[] row = new int[width];
            for (int y = 0; y < height; y++) {
                if (pixels == null) {
                    java.util.Arrays.fill(row, jpeg ? WHITE : 0x00000000);
                } else if (jpeg) {
                    int base = y * width;
                    for (int x = 0; x < width; x++) {
                        row[x] = pixels[base + x] | 0xFF000000; // 丢弃 alpha
                    }
                } else {
                    System.arraycopy(pixels, y * width, row, 0, width);
                }
                img.setRGB(0, y, width, 1, row, 0, width);
            }
            String name = jpeg ? "jpg" : "png";
            if (!jpeg && format != CompressFormat.PNG) {
                name = "png"; // WEBP 等：ImageIO 默认无写插件，退化为 PNG（好过 0 字节）
            }
            return ImageIO.write(img, name, stream);
        } catch (Throwable t) {
            return false; // 含 NoClassDefFoundError（无 java.desktop 的运行时）
        }
    }

    public String toString() {
        return "Bitmap(" + width + "x" + height + ", " + config
                + (pixels == null ? ", no-pixels" : "") + ")";
    }
}
