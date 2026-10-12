package android.graphics.drawable;

/**
 * StateListDrawable stub —— 状态列表 drawable（按 state 选子 drawable）。
 *
 * wex 壳解出的界面类用它做按钮/输入框的不同状态背景；
 * 桌面不渲染，只需能构造、能 addState、能 setState 而不抛异常。
 */
public class StateListDrawable extends Drawable {

    public StateListDrawable() { }

    public void addState(int[] stateSet, Drawable drawable) { }

    public void addLevel(int low, int high, Drawable drawable) { }

    public boolean isStateful() {
        return true;
    }

    public boolean selectDrawable(int index) {
        return false;
    }

    public int getStateCount() {
        return 0;
    }

    public Drawable getStateDrawable(int index) {
        return null;
    }

    public int[] getStateSet(int index) {
        return null;
    }

    public Drawable getCurrent() {
        return null;
    }

    public void setState(int[] stateSet) { }

    public void setEnterFadeDuration(int ms) { }

    public void setExitFadeDuration(int ms) { }
}
