package android.graphics;

/**
 * LinearGradient stub —— 线性渐变着色器（构造即丢弃）。
 *
 * wex 壳解出的界面类（如 PanConfig）用它给背景/按钮上色；
 * 桌面不渲染，只需能按 SDK 签名构造。
 */
public class LinearGradient extends Shader {

    public LinearGradient(float x0, float y0, float x1, float y1, int color0, int color1,
                          TileMode tile) {
    }

    public LinearGradient(float x0, float y0, float x1, float y1, int[] colors, float[] positions,
                          TileMode tile) {
    }

    public LinearGradient(float x0, float y0, float x1, float y1, int color0, int color1,
                          TileMode tile, long colorSpaceHandle) {
    }
}
