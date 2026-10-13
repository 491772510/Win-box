import android.net.Uri;

public class UriLegacyProbe {
    public static void main(String[] args) {
        String expected = "https://a.b/p?k=v";
        Uri copy = Uri.parse(expected).buildUpon();
        if (!expected.equals(copy.toString())) throw new AssertionError("legacy buildUpon");
        System.out.println("uri-legacy-ok");
    }
}
