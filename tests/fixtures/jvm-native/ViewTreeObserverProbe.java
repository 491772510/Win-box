import android.content.Context;
import android.view.View;
import android.view.ViewTreeObserver;
import android.widget.Toast;

public class ViewTreeObserverProbe {
    private ViewTreeObserver.OnGlobalLayoutListener field;
    private static void check(boolean condition, String name) { if (!condition) throw new AssertionError(name); }
    public static void main(String[] args) throws Exception {
        check(ViewTreeObserverProbe.class.getDeclaredField("field").getType() == ViewTreeObserver.OnGlobalLayoutListener.class, "reflective field resolution");
        View view = new View(new Context());
        ViewTreeObserver observer = view.getViewTreeObserver();
        check(observer == view.getViewTreeObserver() && observer.isAlive(), "stable desktop observer");
        int[] calls = {0};
        ViewTreeObserver.OnGlobalLayoutListener listener = () -> calls[0]++;
        observer.addOnGlobalLayoutListener(listener);
        check(calls[0] == 0, "no fabricated layout event");
        observer.dispatchOnGlobalLayout(); check(calls[0] == 1, "explicit dispatch");
        observer.removeOnGlobalLayoutListener(listener);
        observer.dispatchOnGlobalLayout(); check(calls[0] == 1, "remove");
        observer.addOnGlobalLayoutListener(listener); observer.removeGlobalOnLayoutListener(listener);
        observer.dispatchOnGlobalLayout(); check(calls[0] == 1, "legacy remove");
        ViewTreeObserver.OnGlobalLayoutListener[] self = new ViewTreeObserver.OnGlobalLayoutListener[1];
        self[0] = () -> { calls[0]++; observer.removeOnGlobalLayoutListener(self[0]); };
        observer.addOnGlobalLayoutListener(self[0]); observer.addOnGlobalLayoutListener(listener);
        observer.dispatchOnGlobalLayout(); check(calls[0] == 3, "mutation during dispatch");
        observer.dispatchOnGlobalLayout(); check(calls[0] == 4, "removed listener stays removed");
        Toast toast = (Toast) Toast.class.getMethod("makeText", Context.class, CharSequence.class, int.class)
                .invoke(null, new Context(), new StringBuilder("desktop notice"), Toast.LENGTH_LONG);
        check(toast.getDuration() == Toast.LENGTH_LONG, "Toast CharSequence overload");
        toast.show(); toast.cancel();
        check(Toast.makeText(new Context(), "legacy string", 0) != null, "Toast legacy String overload");
        System.out.println("view-tree-observer-ok");
    }
}
