package android.view;

import java.util.concurrent.CopyOnWriteArrayList;

/** Desktop has no Android layout tree; explicit dispatch retains listener semantics. */
public final class ViewTreeObserver {
    public interface OnGlobalLayoutListener { void onGlobalLayout(); }
    private final CopyOnWriteArrayList<OnGlobalLayoutListener> globalLayoutListeners = new CopyOnWriteArrayList<>();

    public boolean isAlive() { return true; }
    public void addOnGlobalLayoutListener(OnGlobalLayoutListener listener) {
        if (listener == null) throw new NullPointerException("listener");
        globalLayoutListeners.add(listener);
    }
    public void removeOnGlobalLayoutListener(OnGlobalLayoutListener listener) { globalLayoutListeners.remove(listener); }
    @Deprecated public void removeGlobalOnLayoutListener(OnGlobalLayoutListener listener) { removeOnGlobalLayoutListener(listener); }
    public void dispatchOnGlobalLayout() {
        for (OnGlobalLayoutListener listener : globalLayoutListeners) listener.onGlobalLayout();
    }
}
