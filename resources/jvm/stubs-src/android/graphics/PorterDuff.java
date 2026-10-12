package android.graphics;

/**
 * PorterDuff stub —— 混合模式枚举容器。
 *
 * Canvas.drawColor(int, Mode) 等 API 的参数类型；桌面不渲染，
 * 只需枚举常量存在（字节码里的 getstatic 要解析得到）。
 */
public class PorterDuff {

    public enum Mode {
        CLEAR, SRC, DST, SRC_OVER, DST_OVER, SRC_IN, DST_IN, SRC_OUT, DST_OUT,
        SRC_ATOP, DST_ATOP, XOR, DARKEN, LIGHTEN, MULTIPLY, SCREEN, ADD, OVERLAY
    }
}
