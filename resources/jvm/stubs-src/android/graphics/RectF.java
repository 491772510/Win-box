package android.graphics;

/**
 * RectF stub —— 浮点矩形（纯数据结构，功能完整）。
 *
 * ★ 与 Rect（int 版）同属「纯数据类」：蜘蛛常拿它做坐标/尺寸计算，
 *   空壳会让计算结果恒为 0，所以这里用真实 float 字段实现。
 */
public class RectF {

    public float left;
    public float top;
    public float right;
    public float bottom;

    public RectF() {
        this(0f, 0f, 0f, 0f);
    }

    public RectF(float left, float top, float right, float bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    public RectF(RectF r) {
        if (r == null) {
            left = top = right = bottom = 0f;
        } else {
            left = r.left;
            top = r.top;
            right = r.right;
            bottom = r.bottom;
        }
    }

    public RectF(Rect r) {
        if (r == null) {
            left = top = right = bottom = 0f;
        } else {
            left = r.left;
            top = r.top;
            right = r.right;
            bottom = r.bottom;
        }
    }

    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof RectF)) return false;
        RectF r = (RectF) o;
        return left == r.left && top == r.top && right == r.right && bottom == r.bottom;
    }

    public int hashCode() {
        int result = Float.floatToIntBits(left);
        result = 31 * result + Float.floatToIntBits(top);
        result = 31 * result + Float.floatToIntBits(right);
        result = 31 * result + Float.floatToIntBits(bottom);
        return result;
    }

    public String toString() {
        return "RectF(" + left + ", " + top + ", " + right + ", " + bottom + ")";
    }

    public final float width() {
        return right - left;
    }

    public final float height() {
        return bottom - top;
    }

    public final float centerX() {
        return (left + right) * 0.5f;
    }

    public final float centerY() {
        return (top + bottom) * 0.5f;
    }

    public final boolean isEmpty() {
        return left >= right || top >= bottom;
    }

    public void setEmpty() {
        left = right = top = bottom = 0f;
    }

    public void set(float left, float top, float right, float bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    public void set(RectF src) {
        if (src != null) set(src.left, src.top, src.right, src.bottom);
    }

    public void set(Rect src) {
        if (src != null) set(src.left, src.top, src.right, src.bottom);
    }

    public boolean setIntersect(RectF a, RectF b) {
        if (a != null && b != null && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            set(Math.max(a.left, b.left), Math.max(a.top, b.top), Math.min(a.right, b.right), Math.min(a.bottom, b.bottom));
            return true;
        }
        return false;
    }

    public boolean intersects(float left, float top, float right, float bottom) {
        return this.left < right && left < this.right && this.top < bottom && top < this.bottom;
    }

    public static boolean intersects(RectF a, RectF b) {
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }

    public boolean contains(float x, float y) {
        return left < right && top < bottom && x >= left && x < right && y >= top && y < bottom;
    }

    public boolean contains(float left, float top, float right, float bottom) {
        return this.left < this.right && this.top < this.bottom
                && this.left <= left && this.top <= top
                && this.right >= right && this.bottom >= bottom;
    }

    public boolean contains(RectF r) {
        return r != null && contains(r.left, r.top, r.right, r.bottom);
    }

    public void offset(float dx, float dy) {
        left += dx;
        top += dy;
        right += dx;
        bottom += dy;
    }

    public void offsetTo(float newLeft, float newTop) {
        right += newLeft - left;
        bottom += newTop - top;
        left = newLeft;
        top = newTop;
    }

    public void inset(float dx, float dy) {
        left += dx;
        top += dy;
        right -= dx;
        bottom -= dy;
    }

    public void union(float x, float y) {
        if (x < left) left = x;
        else if (x > right) right = x;
        if (y < top) top = y;
        else if (y > bottom) bottom = y;
    }

    public void union(RectF r) {
        if (r != null) union(r.left, r.top, r.right, r.bottom);
    }

    public void union(float left, float top, float right, float bottom) {
        if (left < right && top < bottom) {
            if (this.left < this.right && this.top < this.bottom) {
                if (this.left > left) this.left = left;
                if (this.top > top) this.top = top;
                if (this.right < right) this.right = right;
                if (this.bottom < bottom) this.bottom = bottom;
            } else {
                this.left = left;
                this.top = top;
                this.right = right;
                this.bottom = bottom;
            }
        }
    }

    public void sort() {
        if (left > right) {
            float tmp = left;
            left = right;
            right = tmp;
        }
        if (top > bottom) {
            float tmp = top;
            top = bottom;
            bottom = tmp;
        }
    }

    public void round(Rect dst) {
        if (dst != null) dst.set(Math.round(left), Math.round(top), Math.round(right), Math.round(bottom));
    }

    public void roundOut(Rect dst) {
        if (dst != null) dst.set((int) Math.floor(left), (int) Math.floor(top), (int) Math.ceil(right), (int) Math.ceil(bottom));
    }

    public void scale(float scale) {
        if (scale != 1.0f) {
            left *= scale;
            top *= scale;
            right *= scale;
            bottom *= scale;
        }
    }
}
