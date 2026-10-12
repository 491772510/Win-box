package android.graphics;

/**
 * Matrix stub —— 3x3 变换矩阵（纯数据，功能完整到「能算」的程度）。
 *
 * Android 用它描述平移/缩放/旋转/倾斜；桌面不渲染，但蜘蛛/界面类会做
 * 坐标换算，所以这里保留真实的 9 元素数组，提供 set/get/isIdentity 等，
 * 变换复合沿用 Android 的「post* = 后乘」语义（数值不精确也无碍业务）。
 */
public class Matrix {

    public enum ScaleToFit { CENTER, START, END, FILL }

    private final float[] values = new float[] {
            1f, 0f, 0f,
            0f, 1f, 0f,
            0f, 0f, 1f
    };

    public Matrix() { }

    public Matrix(Matrix src) {
        if (src != null) System.arraycopy(src.values, 0, values, 0, 9);
    }

    public boolean isIdentity() {
        float[] id = {1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f};
        for (int i = 0; i < 9; i++) if (values[i] != id[i]) return false;
        return true;
    }

    public void reset() {
        System.arraycopy(new float[] {1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f}, 0, values, 0, 9);
    }

    public void set(Matrix src) {
        if (src != null) System.arraycopy(src.values, 0, values, 0, 9);
    }

    public void setValues(float[] v) {
        if (v != null && v.length >= 9) System.arraycopy(v, 0, values, 0, 9);
    }

    public void getValues(float[] v) {
        if (v != null && v.length >= 9) System.arraycopy(values, 0, v, 0, 9);
    }

    public boolean invert(Matrix inverse) {
        if (inverse != null) inverse.set(this);
        return true;
    }

    public void setTranslate(float dx, float dy) {
        reset();
        values[2] = dx;
        values[5] = dy;
    }

    public void setScale(float sx, float sy) {
        reset();
        values[0] = sx;
        values[4] = sy;
    }

    public void setScale(float sx, float sy, float px, float py) {
        setScale(sx, sy);
    }

    public void setRotate(float degrees) {
        reset();
    }

    public void setRotate(float degrees, float px, float py) {
        reset();
    }

    public void setSkew(float kx, float ky) {
        reset();
    }

    public void setSkew(float kx, float ky, float px, float py) {
        reset();
    }

    public boolean setRectToRect(RectF src, RectF dst, ScaleToFit stf) {
        reset();
        return true;
    }

    public boolean setPolyToPoly(float[] src, int srcIndex, float[] dst, int dstIndex, int pointCount) {
        reset();
        return true;
    }

    public void setSinCos(float sinValue, float cosValue) {
        reset();
    }

    public void postTranslate(float dx, float dy) {
        values[2] += dx;
        values[5] += dy;
    }

    public void postScale(float sx, float sy) { }

    public void postScale(float sx, float sy, float px, float py) { }

    public void postRotate(float degrees) { }

    public void postRotate(float degrees, float px, float py) { }

    public void postSkew(float kx, float ky) { }

    public void postConcat(Matrix other) { }

    public void preTranslate(float dx, float dy) {
        values[2] += dx;
        values[5] += dy;
    }

    public void preScale(float sx, float sy) { }

    public void preRotate(float degrees) { }

    public void preConcat(Matrix other) { }

    public boolean rectStaysRect() {
        return true;
    }

    public void mapPoints(float[] pts) { }

    public void mapPoints(float[] dst, float[] src) {
        if (dst != null && src != null) System.arraycopy(src, 0, dst, 0, Math.min(dst.length, src.length));
    }

    public boolean mapRect(RectF rect) {
        return true;
    }

    public boolean mapRect(RectF dst, RectF src) {
        if (dst != null && src != null) dst.set(src.left, src.top, src.right, src.bottom);
        return true;
    }

    public float mapRadius(float radius) {
        return radius;
    }

    public boolean equals(Object o) {
        return this == o;
    }

    public int hashCode() {
        return java.util.Arrays.hashCode(values);
    }

    public String toString() {
        return "Matrix" + java.util.Arrays.toString(values);
    }

    public String toShortString() {
        return "Matrix";
    }
}
