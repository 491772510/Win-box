package android.widget;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ViewGroup;

/**
 * FrameLayout stub。
 *
 * ★ 2026-10-12 新增源码：此前 FrameLayout 只存在于基线 stubs.jar 里（无源码），
 *   其嵌套类 `FrameLayout$LayoutParams` 继承的是 `ViewGroup$LayoutParams`，
 *   而真 Android 继承 **`ViewGroup$MarginLayoutParams`**。
 *   按错误的继承线，`invokevirtual MarginLayoutParams.setMargins(...)` 打到
 *   FrameLayout$LayoutParams 上时，在 -Xverify:none 下会类型混淆并让 JVM 硬崩
 *   （与 PanConfig.w 崩溃同一类问题，详见 android/view/ViewGroup.java 的注释）。
 *
 * 本类补齐标准构造器与 LayoutParams 继承线。
 */
public class FrameLayout extends ViewGroup {

    public FrameLayout(Context context) {
        super(context);
    }

    public FrameLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public FrameLayout(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    /** 与 Android SDK 契约一致：父类为 ViewGroup.MarginLayoutParams（带 gravity）。 */
    public static class LayoutParams extends ViewGroup.MarginLayoutParams {

        public static final int UNSPECIFIED_GRAVITY = -1;

        public int gravity = UNSPECIFIED_GRAVITY;

        public LayoutParams(int width, int height) {
            super(width, height);
        }

        public LayoutParams(int width, int height, int gravity) {
            super(width, height);
            this.gravity = gravity;
        }

        public LayoutParams(Context c, AttributeSet attrs) {
            super(c, attrs);
        }

        public LayoutParams(ViewGroup.LayoutParams source) {
            super(source);
        }

        public LayoutParams(ViewGroup.MarginLayoutParams source) {
            super(source);
        }
    }
}
