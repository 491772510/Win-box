package android.graphics;

/**
 * Canvas stub —— 画布（桌面无图形栈，全部 no-op）。
 *
 * ★ 2026-10-12（wexshinidie 支持）：此前只有 drawColor，实测 wex 壳解出的
 *   界面类（PanConfig 等）绘制圆角矩形时抛
 *   `NoSuchMethodError: Canvas.drawRoundRect(RectF,float,float,Paint)`
 *   —— NoSuchMethodError 比 ClassNotFoundException 更隐蔽，会直接中断整条
 *   业务链。这里按 Android SDK 签名补全绘制/裁剪/变换方法，全部空实现。
 *
 * 与 Bitmap/Paint 的「宽容降级」一致：桌面不渲染，但**不能抛异常**。
 */
public class Canvas {

    public enum VertexMode { TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN }

    public enum EdgeType { BW, AA }

    public Canvas() { }

    public Canvas(Bitmap bitmap) { }

    public int getWidth() {
        return 0;
    }

    public int getHeight() {
        return 0;
    }

    public int getDensity() {
        return 160;
    }

    public void setDensity(int density) { }

    public Bitmap getBitmap() {
        return null;
    }

    public void setBitmap(Bitmap bitmap) { }

    // ---- 颜色 ----------------------------------------------------------

    public void drawColor(int color) { }

    public void drawColor(int color, PorterDuff.Mode mode) { }

    public void drawRGB(int r, int g, int b) { }

    public void drawARGB(int a, int r, int g, int b) { }

    // ---- 矩形 / 圆形 / 椭圆 --------------------------------------------

    public void drawRect(float left, float top, float right, float bottom, Paint paint) { }

    public void drawRect(RectF rect, Paint paint) { }

    public void drawRect(Rect rect, Paint paint) { }

    public void drawRoundRect(RectF rect, float rx, float ry, Paint paint) { }

    public void drawRoundRect(float left, float top, float right, float bottom,
                              float rx, float ry, Paint paint) { }

    public void drawCircle(float cx, float cy, float radius, Paint paint) { }

    public void drawOval(RectF oval, Paint paint) { }

    public void drawOval(float left, float top, float right, float bottom, Paint paint) { }

    public void drawArc(RectF oval, float startAngle, float sweepAngle, boolean useCenter, Paint paint) { }

    public void drawArc(float left, float top, float right, float bottom,
                        float startAngle, float sweepAngle, boolean useCenter, Paint paint) { }

    public void drawLine(float startX, float startY, float stopX, float stopY, Paint paint) { }

    public void drawLines(float[] pts, Paint paint) { }

    public void drawLines(float[] pts, int offset, int count, Paint paint) { }

    public void drawPoint(float x, float y, Paint paint) { }

    public void drawPoints(float[] pts, Paint paint) { }

    public void drawPath(Path path, Paint paint) { }

    // ---- 文本 ----------------------------------------------------------

    public void drawText(String text, float x, float y, Paint paint) { }

    public void drawText(String text, int start, int end, float x, float y, Paint paint) { }

    public void drawText(CharSequence text, int start, int end, float x, float y, Paint paint) { }

    public void drawText(char[] text, int index, int count, float x, float y, Paint paint) { }

    public void drawTextOnPath(String text, Path path, float hOffset, float vOffset, Paint paint) { }

    // ---- 位图 ----------------------------------------------------------

    public void drawBitmap(Bitmap bitmap, float left, float top, Paint paint) { }

    public void drawBitmap(Bitmap bitmap, Matrix matrix, Paint paint) { }

    public void drawBitmap(Bitmap bitmap, Rect src, Rect dst, Paint paint) { }

    public void drawBitmap(Bitmap bitmap, Rect src, RectF dst, Paint paint) { }

    public void drawBitmap(int[] colors, int offset, int stride, float x, float y,
                           int width, int height, boolean hasAlpha, Paint paint) { }

    public void drawBitmapMesh(Bitmap bitmap, int meshWidth, int meshHeight,
                               float[] verts, int vertOffset, int[] colors, int colorOffset, Paint paint) { }

    // ---- 裁剪 ----------------------------------------------------------

    public boolean clipRect(float left, float top, float right, float bottom) {
        return true;
    }

    public boolean clipRect(RectF rect) {
        return true;
    }

    public boolean clipRect(Rect rect) {
        return true;
    }

    public boolean clipPath(Path path) {
        return true;
    }

    public boolean clipRegion(Object region) {
        return true;
    }

    // ---- 变换 / 状态栈 --------------------------------------------------

    public void translate(float dx, float dy) { }

    public void scale(float sx, float sy) { }

    public void scale(float sx, float sy, float px, float py) { }

    public void rotate(float degrees) { }

    public void rotate(float degrees, float px, float py) { }

    public void skew(float sx, float sy) { }

    public void concat(Matrix matrix) { }

    public void setMatrix(Matrix matrix) { }

    public Matrix getMatrix() {
        return new Matrix();
    }

    public int save() {
        return 0;
    }

    public int saveLayer(RectF bounds, Paint paint, int saveFlags) {
        return 0;
    }

    public int saveLayer(float left, float top, float right, float bottom, Paint paint, int saveFlags) {
        return 0;
    }

    public int saveLayerAlpha(RectF bounds, int alpha, int saveFlags) {
        return 0;
    }

    public void restore() { }

    public int getSaveCount() {
        return 1;
    }

    public void restoreToCount(int saveCount) { }

    public boolean isOpaque() {
        return false;
    }

    public boolean quickReject(RectF rect, EdgeType type) {
        return false;
    }

    public int getClipWidth() {
        return 0;
    }

    public int getClipHeight() {
        return 0;
    }

    public void setDrawFilter(Object filter) { }

    public void drawVertices(VertexMode mode, int vertexCount, float[] verts, int vertOffset,
                             float[] texs, int texOffset, int[] colors, int colorOffset,
                             short[] indices, int indexOffset, int indexCount, Paint paint) { }
}
