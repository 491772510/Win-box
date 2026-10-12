package android.widget;

import android.content.Context;

/** Desktop notification compatibility: retain text and log it, never fabricate an Android window. */
public class Toast {
    public static final int LENGTH_SHORT = 0, LENGTH_LONG = 1;
    private CharSequence text = "";
    private int duration = LENGTH_SHORT;

    public Toast() { }
    public Toast(Context context) { }
    public static Toast makeText(Context context, CharSequence text, int duration) {
        Toast toast = new Toast(context);
        toast.setText(text); toast.setDuration(duration);
        return toast;
    }
    // Preserve the old desktop overload for already converted JARs too.
    public static Toast makeText(Context context, String text, int duration) { return makeText(context, (CharSequence) text, duration); }
    public static Toast makeText(Context context, int resId, int duration) { return makeText(context, context.getText(resId), duration); }
    public void setText(CharSequence text) { this.text = text == null ? "" : text; }
    public void setDuration(int duration) { this.duration = duration; }
    public int getDuration() { return duration; }
    public void show() { System.err.println("[android.Toast] " + text); }
    public void cancel() { /* No desktop Android window to dismiss. */ }
}
