package android.widget;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.view.ViewGroup;

/**
 * Desktop compatibility stub for Android's vertical scroll container.
 *
 * Config spiders sometimes construct a ScrollView while assembling their
 * settings/home page, even though the desktop JVM never renders that page.
 * Keep the class and the commonly referenced no-op methods available so this
 * UI-only code cannot abort homeContent with ClassNotFoundException.
 */
public class ScrollView extends ViewGroup {

    private boolean fillViewport;
    private boolean smoothScrollingEnabled = true;

    public ScrollView(Context context) { super(context); }
    public ScrollView(Context context, AttributeSet attrs) { super(context, attrs); }
    public ScrollView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    public void setFillViewport(boolean fillViewport) {
        this.fillViewport = fillViewport;
    }

    public boolean isFillViewport() {
        return fillViewport;
    }

    public void setSmoothScrollingEnabled(boolean enabled) {
        this.smoothScrollingEnabled = enabled;
    }

    public boolean isSmoothScrollingEnabled() {
        return smoothScrollingEnabled;
    }

    public boolean fullScroll(int direction) { return false; }
    public boolean pageScroll(int direction) { return false; }
    public boolean arrowScroll(int direction) { return false; }
    public void smoothScrollTo(int x, int y) { }
    public void smoothScrollBy(int dx, int dy) { }
    public void scrollTo(int x, int y) { }
    public void scrollBy(int x, int y) { }

    @Override
    public void addView(View child, int index, ViewGroup.LayoutParams params) {
        // The desktop stub does not retain a UI tree.
    }
}
