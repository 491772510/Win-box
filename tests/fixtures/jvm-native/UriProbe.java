import android.net.Uri;

public class UriProbe {
    private static void check(String expected, String actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("expected=" + expected + " actual=" + actual);
        }
    }
    public static void main(String[] args) {
        check("123", Uri.parse("https://www.bilibili.com/video/123?x=1#f").getLastPathSegment());
        check("episode.mkv", Uri.parse("https://a.b/series/episode.mkv///").getLastPathSegment());
        check("a/b+c", Uri.parse("https://a.b/a%2Fb+c").getLastPathSegment());
        check("relative.mp4", Uri.parse("relative.mp4").getLastPathSegment());
        check(null, Uri.parse("https://a.b/").getLastPathSegment());
        check(null, Uri.parse("https://a.b").getLastPathSegment());
        check(null, Uri.parse("https://a.b?redirect=/not/a/path").getLastPathSegment());
        check(null, Uri.parse("https://a.b#not/a/path").getLastPathSegment());
        check("file.mkv", Uri.parse("https://a.b/file.mkv?redirect=/other/path").getLastPathSegment());
        check("hello world", Uri.parse("https://a.b/p?k=hello+world").getQueryParameter("k"));
        check("https", Uri.parse("https://a.b:8080/p").getScheme());
        check("a.b", Uri.parse("https://a.b:8080/p").getHost());
        if (Uri.parse("https://a.b:8080/p").getPort() != 8080) throw new AssertionError("port");
        check("https://a.b/p?k=v", Uri.parse("https://a.b/p").buildUpon().appendQueryParameter("k", "v").build().toString());
        System.out.println("uri-path-ok");
    }
}
