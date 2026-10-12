package android.graphics;

/**
 * Path stub —— 绘制路径（无图形栈，全部 no-op 记录不参与渲染）。
 *
 * 供 wex 壳解出的界面类构建路径使用；只需能构造、能调用。
 */
public class Path {

    public enum FillType { WINDING, EVEN_ODD, INVERSE_WINDING, INVERSE_EVEN_ODD }

    public enum Direction { CW, CCW }

    public Path() { }

    public Path(Path src) { }

    public void reset() { }

    public void rewind() { }

    public void set(Path src) { }

    public void moveTo(float x, float y) { }

    public void lineTo(float x, float y) { }

    public void quadTo(float x1, float y1, float x2, float y2) { }

    public void cubicTo(float x1, float y1, float x2, float y2, float x3, float y3) { }

    public void rMoveTo(float dx, float dy) { }

    public void rLineTo(float dx, float dy) { }

    public void rQuadTo(float dx1, float dy1, float dx2, float dy2) { }

    public void rCubicTo(float x1, float y1, float x2, float y2, float x3, float y3) { }

    public void close() { }

    public void addRect(float left, float top, float right, float bottom, Direction dir) { }

    public void addRect(RectF rect, Direction dir) { }

    public void addRoundRect(RectF rect, float rx, float ry, Direction dir) { }

    public void addRoundRect(float left, float top, float right, float bottom,
                             float rx, float ry, Direction dir) { }

    public void addCircle(float x, float y, float radius, Direction dir) { }

    public void addOval(RectF oval, Direction dir) { }

    public void addArc(float left, float top, float right, float bottom,
                       float startAngle, float sweepAngle) { }

    public void arcTo(RectF oval, float startAngle, float sweepAngle, boolean forceMoveTo) { }

    public void arcTo(RectF oval, float startAngle, float sweepAngle) { }

    public void offset(float dx, float dy) { }

    public void transform(Matrix matrix) { }

    public void setFillType(FillType ft) { }

    public FillType getFillType() {
        return FillType.WINDING;
    }

    public boolean isEmpty() {
        return true;
    }

    public boolean isRect(RectF rect) {
        return false;
    }

    public void computeBounds(RectF bounds, boolean exact) {
        if (bounds != null) bounds.set(0, 0, 0, 0);
    }

    public boolean op(Path path1, Path path2, Object op) {
        return false;
    }
}
