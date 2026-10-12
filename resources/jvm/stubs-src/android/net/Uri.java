package android.net;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Uri stub —— URI 解析（纯数据类，按 Android 语义实现）。
 *
 * ★ 2026-10-12（wexshinidie 支持）：此前本类只在基线 stubs.jar 里（源码不在
 *   stubs-src，属「历史类」）。实测 wex 源 BiliYs 抛
 *   `NoSuchMethodError: 'String android.net.Uri.getLastPathSegment()'`
 *   —— 桌面版缺失方法属兼容性缺口，会让整条 data() 链失败。
 *   这里把源码补进 stubs-src（构建脚本会覆盖基线类），并补齐 Android 常用 API：
 *   getLastPathSegment / getPathSegments / getFragment / getAuthority /
 *   getEncodedPath / isHierarchical 等；**原有公开签名一个不少**（buildUpon2 等
 *   非标准方法保留，避免破坏既有调用方）。
 *
 * 纯数据类，按 Android 语义实现 —— 蜘蛛常用它拆播放地址与查询参数，
 * 空壳或返回 null 会让下游取到错误结果。
 */
public class Uri {

    private final String s;

    /** 解析后的缓存片段 */
    private String scheme;
    private String authority;
    private String path;
    private String query;
    private String fragment;
    private boolean hierarchical;
    private boolean parsed;

    private Uri(String s) {
        this.s = s == null ? "" : s;
    }

    // ------------------------------------------------------------------
    // 静态工厂
    // ------------------------------------------------------------------

    public static Uri parse(String uriString) {
        return new Uri(uriString);
    }

    public static Uri fromParts(String scheme, String ssp, String fragment) {
        StringBuilder sb = new StringBuilder();
        if (scheme != null) sb.append(scheme).append(':');
        if (ssp != null) sb.append(ssp);
        if (fragment != null) sb.append('#').append(fragment);
        return new Uri(sb.toString());
    }

    public static Uri withAppendedPath(Uri baseUri, String pathSegment) {
        if (baseUri == null) return new Uri(pathSegment);
        String b = baseUri.s;
        if (b.endsWith("/")) return new Uri(b + pathSegment);
        return new Uri(b + "/" + pathSegment);
    }

    // ------------------------------------------------------------------
    // 解析
    // ------------------------------------------------------------------

    private void ensureParsed() {
        if (parsed) return;
        parsed = true;
        String rest = s;

        int hash = rest.indexOf('#');
        if (hash >= 0) {
            fragment = rest.substring(hash + 1);
            rest = rest.substring(0, hash);
        }

        int colon = rest.indexOf(':');
        int slash = rest.indexOf('/');
        if (colon >= 0 && (slash < 0 || colon < slash)) {
            scheme = rest.substring(0, colon);
            rest = rest.substring(colon + 1);
            hierarchical = rest.startsWith("/");
        } else {
            hierarchical = false;
        }

        // scheme-specific part（含 authority / path / query）
        rest = stripQuery(rest);

        if (hierarchical || (scheme == null && rest.startsWith("//"))) {
            if (rest.startsWith("//")) {
                rest = rest.substring(2);
                int end = rest.length();
                for (int i = 0; i < rest.length(); i++) {
                    char c = rest.charAt(i);
                    if (c == '/' || c == '?' || c == '#') {
                        end = i;
                        break;
                    }
                }
                authority = rest.substring(0, end);
                rest = rest.substring(end);
            }
        }
        path = rest;
    }

    /** 切出 query（结果写回 this.query），返回去掉 query 的部分 */
    private String stripQuery(String rest) {
        int q = rest.indexOf('?');
        if (q >= 0) {
            query = rest.substring(q + 1);
            return rest.substring(0, q);
        }
        return rest;
    }

    // ------------------------------------------------------------------
    // 取值
    // ------------------------------------------------------------------

    public String getScheme() {
        ensureParsed();
        return scheme;
    }

    public String getAuthority() {
        ensureParsed();
        return authority;
    }

    public String getUserInfo() {
        String a = getAuthority();
        if (a == null) return null;
        int at = a.indexOf('@');
        return at >= 0 ? a.substring(0, at) : null;
    }

    public String getHost() {
        String a = getAuthority();
        if (a == null) return null;
        int at = a.indexOf('@');
        String hostPort = at >= 0 ? a.substring(at + 1) : a;
        int colon = hostPort.indexOf(':');
        return colon >= 0 ? hostPort.substring(0, colon) : hostPort;
    }

    public int getPort() {
        String a = getAuthority();
        if (a == null) return -1;
        int at = a.indexOf('@');
        String hostPort = at >= 0 ? a.substring(at + 1) : a;
        int colon = hostPort.indexOf(':');
        if (colon < 0) return -1;
        try {
            return Integer.parseInt(hostPort.substring(colon + 1));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public String getPath() {
        ensureParsed();
        return path;
    }

    public String getEncodedPath() {
        return getPath();
    }

    public boolean isHierarchical() {
        ensureParsed();
        return hierarchical;
    }

    public boolean isRelative() {
        ensureParsed();
        return scheme == null && authority == null;
    }

    public boolean isAbsolute() {
        return !isRelative();
    }

    /** ★ 缺此方法会让 BiliYs 等源的 data() 抛 NoSuchMethodError（本次修复点） */
    public String getLastPathSegment() {
        List<String> segs = getPathSegments();
        if (segs.isEmpty()) return null;
        return segs.get(segs.size() - 1);
    }

    public List<String> getPathSegments() {
        String p = getPath();
        if (p == null || p.isEmpty() || "/".equals(p)) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (String seg : p.split("/")) {
            if (!seg.isEmpty()) out.add(seg);
        }
        return out;
    }

    public String getQuery() {
        ensureParsed();
        return query;
    }

    public String getEncodedQuery() {
        return getQuery();
    }

    public String getFragment() {
        ensureParsed();
        return fragment;
    }

    public String getEncodedFragment() {
        return getFragment();
    }

    /** 查询参数（保留顺序，重复键取第一个 —— 与 Android 一致） */
    private Map<String, String> queryPairs() {
        Map<String, String> out = new LinkedHashMap<>();
        String q = getQuery();
        if (q == null || q.isEmpty()) return out;
        for (String pair : q.split("&")) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            String k = eq >= 0 ? pair.substring(0, eq) : pair;
            String v = eq >= 0 ? pair.substring(eq + 1) : "";
            String dk = decode(k);
            if (!out.containsKey(dk)) out.put(dk, decode(v));
        }
        return out;
    }

    public String getQueryParameter(String key) {
        return queryPairs().get(key);
    }

    public Set<String> getQueryParameterNames() {
        return new LinkedHashSet<>(queryPairs().keySet());
    }

    @SuppressWarnings("unchecked")
    public List<String> getQueryParameters(String key) {
        List<String> out = new ArrayList<>();
        String q = getQuery();
        if (q != null && !q.isEmpty() && key != null) {
            for (String pair : q.split("&")) {
                int eq = pair.indexOf('=');
                String k = eq >= 0 ? pair.substring(0, eq) : pair;
                if (key.equals(decode(k))) {
                    out.add(decode(eq >= 0 ? pair.substring(eq + 1) : ""));
                }
            }
        }
        return out;
    }

    public boolean getBooleanQueryParameter(String key, boolean defaultValue) {
        String v = getQueryParameter(key);
        if (v == null) return defaultValue;
        v = v.toLowerCase();
        return !("false".equals(v) || "0".equals(v) || "no".equals(v));
    }

    // ------------------------------------------------------------------
    // 构建
    // ------------------------------------------------------------------

    public Uri buildUpon() {
        return new Builder(s).build();
    }

    /** 非标准方法：基线里既有调用方，保留以免破坏（见类注释）。 */
    public Uri.Builder buildUpon2() {
        return new Builder(s);
    }

    public static final class Builder {

        private String base;
        private String scheme;
        private String authority;
        private String path;
        private String query;
        private String fragment;

        Builder(String base) {
            this.base = base;
        }

        public Builder scheme(String scheme) {
            this.scheme = scheme;
            return this;
        }

        public Builder authority(String authority) {
            this.authority = authority;
            return this;
        }

        public Builder path(String path) {
            this.path = path;
            return this;
        }

        public Builder encodedPath(String path) {
            this.path = path;
            return this;
        }

        public Builder appendPath(String newSegment) {
            if (this.path == null) this.path = newSegment;
            else this.path = this.path.endsWith("/") ? this.path + newSegment : this.path + "/" + newSegment;
            return this;
        }

        public Builder query(String query) {
            this.query = query;
            return this;
        }

        public Builder encodedQuery(String query) {
            this.query = query;
            return this;
        }

        public Builder fragment(String fragment) {
            this.fragment = fragment;
            return this;
        }

        public Builder appendQueryParameter(String key, String value) {
            String kv = encode(key) + "=" + encode(value);
            this.query = (this.query == null || this.query.isEmpty()) ? kv : this.query + "&" + kv;
            return this;
        }

        public Builder clearQuery() {
            this.query = null;
            return this;
        }

        public Uri build() {
            StringBuilder sb = new StringBuilder();
            // 已有 base 时以其为骨架做替换（与 Android 语义一致：显式设置的部分覆盖 base）
            Uri b = new Uri(base);
            String useScheme = scheme != null ? scheme : b.getScheme();
            String useAuthority = authority != null ? authority : b.getAuthority();
            String usePath = path != null ? path : b.getPath();
            String useQuery = query != null ? query : b.getQuery();
            String useFragment = fragment != null ? fragment : b.getFragment();

            if (useScheme != null) sb.append(useScheme).append(':');
            if (useAuthority != null) sb.append("//").append(useAuthority);
            if (usePath != null) {
                if (useAuthority != null && !usePath.startsWith("/")) sb.append('/');
                sb.append(usePath);
            }
            if (useQuery != null && !useQuery.isEmpty()) sb.append('?').append(useQuery);
            if (useFragment != null) sb.append('#').append(useFragment);
            return new Uri(sb.toString());
        }

        public String toString() {
            return build().toString();
        }
    }

    // ------------------------------------------------------------------
    // 编解码
    // ------------------------------------------------------------------

    public static String encode(String s) {
        if (s == null) return null;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (isAllowed(c)) sb.append(c);
            else {
                byte[] bytes = String.valueOf(c).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                for (byte b : bytes) sb.append('%').append(String.format("%02X", b & 0xFF));
            }
        }
        return sb.toString();
    }

    private static boolean isAllowed(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '-' || c == '_' || c == '.' || c == '!' || c == '~'
                || c == '*' || c == '\'' || c == '(' || c == ')';
    }

    public static String decode(String s) {
        if (s == null) return null;
        if (s.indexOf('%') < 0) return s.indexOf('+') < 0 ? s : s.replace('+', ' ');
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%' && i + 2 < s.length()) {
                try {
                    out.write(Integer.parseInt(s.substring(i + 1, i + 3), 16));
                    i += 2;
                } catch (NumberFormatException e) {
                    out.write(c);
                }
            } else if (c == '+') {
                out.write(' ');
            } else {
                byte[] bytes = String.valueOf(c).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                out.write(bytes, 0, bytes.length);
            }
        }
        return new String(out.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------

    public String toString() {
        return s;
    }

    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Uri)) return false;
        return s.equals(((Uri) o).s);
    }

    public int hashCode() {
        return s.hashCode();
    }
}
