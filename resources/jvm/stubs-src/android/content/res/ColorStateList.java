package android.content.res;

import android.graphics.Color;

/**
 * ColorStateList stub —— 随状态变化的颜色表。
 *
 * wex 壳解出的界面类（PanConfig 等）用它给文字/背景上随状态变化的色值；
 * 桌面按「取默认色」降级，字段与构造签名保持与 SDK 一致。
 */
public class ColorStateList {

    private final int[] colors;
    private final int defaultColor;

    public ColorStateList(int[][] states, int[] colors) {
        this.colors = colors;
        this.defaultColor = (colors == null || colors.length == 0) ? Color.BLACK : colors[0];
    }

    public static ColorStateList valueOf(int color) {
        return new ColorStateList(new int[][] { new int[0] }, new int[] { color });
    }

    public static ColorStateList valueOf(int[][] states, int[] colors) {
        return new ColorStateList(states, colors);
    }

    public int getColorForState(int[] stateSet, int defaultColor) {
        return this.defaultColor != 0 ? this.defaultColor : defaultColor;
    }

    public int getDefaultColor() {
        return defaultColor;
    }

    public boolean isStateful() {
        return colors != null && colors.length > 1;
    }

    public boolean isOpaque() {
        return Color.alpha(defaultColor) == 255;
    }

    public String toString() {
        return "ColorStateList{defaultColor=" + Integer.toHexString(defaultColor) + "}";
    }

    /** Android 里 color 数组的第一项即默认态颜色（简化实现）。 */
    public int[] getColors() {
        return colors;
    }
}
