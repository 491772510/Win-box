package android.graphics;

/**
 * Paint stub —— 画笔（无 Android 图形栈，全部 no-op）。
 *
 * 供 wex 壳解出的界面类（PanConfig 等）构建时使用：它们会创建 Paint 并设置
 * 颜色/线宽/字体等属性，桌面只需**能构造、能调用、不抛异常**。
 * 内部枚举与 Android SDK 同名同值，供字节码里的 getstatic 取常量。
 */
public class Paint {

    public enum Align { LEFT, CENTER, RIGHT }

    public enum Cap { BUTT, ROUND, SQUARE }

    public enum Join { MITER, ROUND, BEVEL }

    public enum Style { FILL, STROKE, FILL_AND_STROKE }

    public enum PaintFlags {
        ANTI_ALIAS_FLAG, FILTER_BITMAP_FLAG, DITHER_FLAG, EMBEDDED_BITMAP_TEXT_FLAG
    }

    /** 字体度量（文本布局用；桌面给零值，调用方通常只做偏移计算）。 */
    public static class FontMetrics {
        public float top;
        public float ascent;
        public float descent;
        public float bottom;
        public float leading;
    }

    public int flags;
    public int color;

    public Paint() { }

    public Paint(int flags) {
        this.flags = flags;
    }

    public Paint(Paint paint) {
        if (paint != null) {
            this.flags = paint.flags;
            this.color = paint.color;
        }
    }

    public void set(Paint src) {
        if (src != null) {
            this.flags = src.flags;
            this.color = src.color;
        }
    }

    public void reset() { }

    public int getFlags() {
        return flags;
    }

    public void setFlags(int flags) {
        this.flags = flags;
    }

    public int getColor() {
        return color;
    }

    public void setColor(int color) {
        this.color = color;
    }

    public int getAlpha() {
        return (color >>> 24) & 0xFF;
    }

    public void setAlpha(int a) { }

    public void setAntiAlias(boolean aa) { }

    public boolean isAntiAlias() {
        return false;
    }

    public void setDither(boolean dither) { }

    public void setFilterBitmap(boolean filter) { }

    public void setFakeBoldText(boolean fakeBoldText) { }

    public void setLinearText(boolean linearText) { }

    public void setSubpixelText(boolean subpixelText) { }

    public void setUnderlineText(boolean underlineText) { }

    public void setStrikeThruText(boolean strikeThruText) { }

    public float getTextSize() {
        return 0f;
    }

    public void setTextSize(float textSize) { }

    public float getTextScaleX() {
        return 1f;
    }

    public void setTextScaleX(float scaleX) { }

    public float getTextSkewX() {
        return 0f;
    }

    public void setTextSkewX(float skewX) { }

    public float getStrokeWidth() {
        return 0f;
    }

    public void setStrokeWidth(float width) { }

    public float getStrokeMiter() {
        return 0f;
    }

    public void setStrokeMiter(float miter) { }

    public void setStyle(Style style) { }

    public Style getStyle() {
        return Style.FILL;
    }

    public void setStrokeCap(Cap cap) { }

    public Cap getStrokeCap() {
        return Cap.BUTT;
    }

    public void setStrokeJoin(Join join) { }

    public Join getStrokeJoin() {
        return Join.MITER;
    }

    public void setTextAlign(Align align) { }

    public Align getTextAlign() {
        return Align.LEFT;
    }

    /** ★ 与 Android 签名一致：返回**被替换掉的旧 Shader**（返回类型是 Shader 而非 void，勿改）。 */
    public Shader setShader(Shader shader) {
        return null;
    }

    public Shader getShader() {
        return null;
    }

    /** ★ 同上：返回旧 Typeface。 */
    public Typeface setTypeface(Typeface typeface) {
        return null;
    }

    public Typeface getTypeface() {
        return null;
    }

    public FontMetrics getFontMetrics() {
        return new FontMetrics();
    }

    public float measureText(String text) {
        return text == null ? 0f : text.length() * 8f;
    }

    public float measureText(String text, int start, int end) {
        return Math.max(0, end - start) * 8f;
    }

    public float measureText(CharSequence text, int start, int end) {
        return Math.max(0, end - start) * 8f;
    }

    public int breakText(String text, boolean measureForwards, float maxWidth, float[] measuredWidth) {
        float w = measureText(text);
        if (measuredWidth != null && measuredWidth.length > 0) measuredWidth[0] = Math.min(w, maxWidth);
        return text == null ? 0 : text.length();
    }

    public void getTextBounds(String text, int start, int end, Rect bounds) {
        if (bounds != null) bounds.set(0, 0, (int) measureText(text), 0);
    }

    public Path getTextPath(String text, int start, int end, float x, float y, Path path) {
        return path;
    }

    public void setXfermode(Object xfermode) { }

    public void setMaskFilter(Object maskfilter) { }

    public void setColorFilter(Object colorFilter) { }

    public void setPathEffect(Object effect) { }
}
