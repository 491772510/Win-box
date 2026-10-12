package android.graphics;

/**
 * Shader stub —— 着色器基类（无图形栈，全部 no-op）。
 *
 * Android 中 Shader 是抽象类，LinearGradient/RadialGradient/SweepGradient
 * 等继承它。这里保持同样层次，让 `Paint.setShader(Shader)` 的签名成立。
 */
public class Shader {

    public enum TileMode { CLAMP, REPEAT, MIRROR }

    public Shader() { }

    public boolean getLocalMatrix(Matrix localM) {
        return false;
    }

    public void setLocalMatrix(Matrix localM) { }
}
