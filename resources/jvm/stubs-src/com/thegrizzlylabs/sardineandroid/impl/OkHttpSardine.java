package com.thegrizzlylabs.sardineandroid.impl;

import com.thegrizzlylabs.sardineandroid.DavResource;
import com.thegrizzlylabs.sardineandroid.Sardine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.List;

import okhttp3.Authenticator;
import okhttp3.Credentials;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.Route;

/**
 * WebDAV 客户端实现 —— sardine-android 的 {@code OkHttpSardine} 的桌面端等价物。
 *
 * ★★ 2026-10-12 新增：wex 的「配置中心 → 备份与还原 → WebDAV还原」只有这一条路，
 *   而 `new OkHttpSardine()` 是 `com.github.catvod.spider.merge.o0.c.K()` 的第一句 ——
 *   类不存在就直接 ClassNotFoundException，整个导入功能不可用。
 *
 * ★★ 本类是真实现，不是空桩。理由（本项目 JVM 桩的原则）：
 *   **产物会被拿去用的 API 必须真实现**；只有纯 UI 效果才允许 no-op。
 *   WebDAV 上传/下载会真的产生网络请求与文件落盘，必须照做。
 *
 * 实现依据（逐条对齐上游 thegrizzlylabs/sardine-android 的 OkHttpSardine 源码）：
 *   exists()          → PROPFIND Depth:0（**刻意不用 HEAD**，见方法注释；404 → false）
 *   createDirectory() → MKCOL
 *   put(url,File,ct)  → PUT，body = RequestBody.create(MediaType(ct), file)
 *   get()             → GET，返回 body 流（**不关闭响应**，由调用方关流）
 *   list()            → PROPFIND + Depth:1，body 为 allprop，解析 207 Multi-Status
 *   setCredentials()  → **预认证** Basic（每个请求直接带 Authorization；另留 401 挑战兜底）
 *
 * ★ 为什么不用现成的 sardine-android jar：它是 **OkHttp 4 系 + Android 依赖**
 *   （源码里 `import android.text.TextUtils`），而本项目 libs/ 是 okhttp 3.14.9 ——
 *   引进来就得同时升级 okhttp/kotlin-stdlib，波及全部 33 个源。这里只补 wex
 *   真正调用的那 6 个方法（签名由 wex jar 常量池全量扫描反查得到），零依赖变更。
 */
public class OkHttpSardine implements Sardine {

    private static final MediaType XML = MediaType.parse("text/xml; charset=utf-8");

    /** PROPFIND 请求体：allprop，与上游 list() 的默认行为一致。 */
    private static final String PROPFIND_ALLPROP =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
                    + "<D:propfind xmlns:D=\"DAV:\"><D:allprop/></D:propfind>";

    /**
     * URL 中"可以原样保留、无需转义"的 ASCII 字符。
     * 注意**不含 '%'** —— '%' 单独处理：后跟两位十六进制时原样保留（已是 %XX），
     * 否则必须转义成 %25，否则 okhttp 会认为 URL 非法。
     */
    private static final String SAFE_ASCII = "/:?#[]@!$&'()*+,;=~._-";

    private OkHttpClient client;

    public OkHttpSardine() {
        this.client = new OkHttpClient.Builder().build();
    }

    public OkHttpSardine(OkHttpClient client) {
        this.client = client == null ? new OkHttpClient.Builder().build() : client;
    }

    // ------------------------------------------------------------------ 认证

    @Override
    public void setCredentials(String username, String password) {
        String user = username == null ? "" : username;
        String pass = password == null ? "" : password;
        this.client = this.client.newBuilder()
                // ★ 预认证（真实 sardine 的 setCredentials(u, p, true) 模式）：每个请求直接带上
                //   Authorization，不等 401 挑战。这不是"省一次往返"的微优化，而是**正确性修复**：
                //   本机实测（WsgiDAV/Cheroot）发现，服务端在 401 错误路径上会给 **HEAD 响应带 body**
                //   （违反 RFC 7231 §4.3.2：HEAD 响应不得有消息体）。okhttp 按规范不去读它 →
                //   该连接被复用后，残留的 body 会被当成下一条响应的状态行 →
                //   报 “Unexpected status line: <html>”，整个 WebDAV 功能直接不可用。
                //   自建 WebDAV（WsgiDAV/Cheroot 是最常见的一套）都会踩到，预认证即彻底绕开。
                .addInterceptor(new PreemptiveAuthInterceptor(user, pass))
                // 兼容非预认证服务端：万一仍收到 401 挑战，再补一次（已带凭据则直接放弃，
                // 不会无限重试）。与上游 BasicAuthenticator 行为一致。
                .authenticator(new BasicAuthenticator(user, pass))
                .build();
    }

    /**
     * 预认证拦截器：给每个请求补 Basic Authorization。
     * 用户名与密码都为空时不加（匿名 WebDAV 服务端不该收到空凭据头）。
     */
    private static final class PreemptiveAuthInterceptor implements Interceptor {
        private final String username;
        private final String password;

        PreemptiveAuthInterceptor(String username, String password) {
            this.username = username;
            this.password = password;
        }

        @Override
        public Response intercept(Chain chain) throws IOException {
            Request request = chain.request();
            if (request.header("Authorization") == null
                    && (!this.username.isEmpty() || !this.password.isEmpty())) {
                request = request.newBuilder()
                        .header("Authorization", Credentials.basic(this.username, this.password))
                        .build();
            }
            return chain.proceed(request);
        }
    }

    /** 收到 401 时补上 Basic Authorization 重试一次（与上游 BasicAuthenticator 一致）。 */
    private static final class BasicAuthenticator implements Authenticator {
        private final String username;
        private final String password;

        BasicAuthenticator(String username, String password) {
            this.username = username == null ? "" : username;
            this.password = password == null ? "" : password;
        }

        @Override
        public Request authenticate(Route route, Response response) {
            if (response.request().header("Authorization") != null) {
                return null; // 已经带过凭据还 401 → 放弃，避免无限重试
            }
            return response.request().newBuilder()
                    .header("Authorization", Credentials.basic(this.username, this.password))
                    .build();
        }
    }

    // ------------------------------------------------------------------ 查询

    @Override
    public boolean exists(String url) throws IOException {
        // ★★ 这里**故意不用 HEAD**（真实 sardine 用的是 HEAD，本实现改为 PROPFIND Depth:0）。★★
        //   本机实测（WsgiDAV/Cheroot，自建 WebDAV 最常见的一套）：服务端在**错误响应**上
        //   也给 HEAD 带 body（401 带 139 字节 HTML、404 带一整个 HTML 错误页）。
        //   HTTP 规范（RFC 7231 §4.3.2）规定 HEAD 响应不得有消息体，于是 okhttp 不去读它 →
        //   连接被复用后残留 body 被当成下一条响应的状态行 →
        //     java.net.ProtocolException: Unexpected status line: <!DOCTYPE HTML ...>
        //   现象是「exists 之后紧接着的那个操作（MKCOL/PUT）莫名失败」，极难排查。
        //   PROPFIND 是 WebDAV 原生的存在性判定，响应体由我们正常读完/丢弃，天然没有残留问题。
        Request request = new Request.Builder()
                .url(normalize(url))
                .header("Depth", "0")
                .method("PROPFIND", RequestBody.create(XML, PROPFIND_ALLPROP))
                .build();
        Response response = this.client.newCall(request).execute();
        try {
            int code = response.code();
            if (code == 404) {
                return false;
            }
            if (code == 405 || code == 501) {
                // 极少数服务端不允许对文件 PROPFIND → 退回 HEAD 再判一次
                return headExists(url);
            }
            validate(response);
            return true;
        } finally {
            closeQuietly(response);
        }
    }

    /** 兜底路径：HEAD（仅当服务端明确拒绝 PROPFIND 时才用）。 */
    private boolean headExists(String url) throws IOException {
        Request request = new Request.Builder().url(normalize(url)).head().build();
        Response response = this.client.newCall(request).execute();
        try {
            if (response.code() == 404) {
                return false;
            }
            validate(response);
            return true;
        } finally {
            closeQuietly(response);
        }
    }

    @Override
    public List<DavResource> list(String url) throws IOException {
        return list(url, 1);
    }

    @Override
    public List<DavResource> list(String url, int depth) throws IOException {
        Request request = new Request.Builder()
                .url(normalize(url))
                .header("Depth", depth < 0 ? "infinity" : Integer.toString(depth))
                .method("PROPFIND", RequestBody.create(XML, PROPFIND_ALLPROP))
                .build();
        Response response = this.client.newCall(request).execute();
        try {
            validate(response);
            ResponseBody body = response.body();
            if (body == null) {
                throw new SardineException("No entity found in response", response.code(), response.message());
            }
            // 必须在本方法内把响应读完（finally 会关响应）→ 先整体解析成资源列表
            return DavResource.parseMultiStatus(body.byteStream());
        } finally {
            closeQuietly(response);
        }
    }

    // ------------------------------------------------------------------ 读写

    @Override
    public InputStream get(String url) throws IOException {
        Request request = new Request.Builder().url(normalize(url)).get().build();
        Response response = this.client.newCall(request).execute();
        ResponseBody body;
        try {
            validate(response);
            body = response.body();
            if (body == null) {
                throw new SardineException("No entity found in response", response.code(), response.message());
            }
        } catch (IOException e) {
            closeQuietly(response);
            throw e;
        }
        // ★ 刻意**不关闭** response：调用方要一直读这个流
        //   （o0.c.K() 在 finally 里 close InputStream）。流读完/关闭后 okhttp 自会归还连接。
        return body.byteStream();
    }

    @Override
    public void put(String url, File file, String contentType) throws IOException {
        MediaType mediaType = contentType == null ? null : MediaType.parse(contentType);
        RequestBody body = RequestBody.create(mediaType, file);
        Request request = new Request.Builder().url(normalize(url)).put(body).build();
        execute(request);
    }

    @Override
    public void createDirectory(String url) throws IOException {
        Request request = new Request.Builder().url(normalize(url)).method("MKCOL", null).build();
        execute(request);
    }

    @Override
    public void delete(String url) throws IOException {
        Request request = new Request.Builder().url(normalize(url)).delete().build();
        execute(request);
    }

    @Override
    public void move(String sourceUrl, String destinationUrl) throws IOException {
        Request request = new Request.Builder()
                .url(normalize(sourceUrl))
                .method("MOVE", null)
                .header("DESTINATION", normalize(destinationUrl))
                .header("OVERWRITE", "T")
                .build();
        execute(request);
    }

    // ------------------------------------------------------------------ 内部工具

    /** 发请求并校验 2xx（用于不需要响应体的操作）。 */
    private void execute(Request request) throws IOException {
        Response response = this.client.newCall(request).execute();
        try {
            validate(response);
        } finally {
            closeQuietly(response);
        }
    }

    private static void validate(Response response) throws SardineException {
        if (!response.isSuccessful()) {
            throw new SardineException("Error contacting " + response.request().url(),
                    response.code(), response.message());
        }
    }

    private static void closeQuietly(Response response) {
        try {
            response.close();
        } catch (Throwable ignored) {
            // 关响应失败不影响结果
        }
    }

    /**
     * URL 归一化。
     *
     * ★ 为什么需要：okhttp 的 {@link HttpUrl} 要求 URL 已经合规转义，
     *   `Request.Builder.url(String)` 遇到**未转义的非 ASCII 或空格**会直接抛
     *   `IllegalArgumentException: unexpected url`。用户的 WebDAV 目录名/文件名
     *   常有中文（"我的备份"），上游 sardine 在同一位置也会挂 —— 桌面端这里做一次
     *   宽容转义（逐码点百分号编码）再重试，避免"地址没错却报无效地址"。
     */
    private static String normalize(String url) {
        if (url == null) {
            throw new IllegalArgumentException("WebDAV 地址为空");
        }
        String trimmed = url.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("WebDAV 地址为空");
        }
        if (HttpUrl.parse(trimmed) != null) {
            return trimmed;
        }
        String escaped = escapeLenient(trimmed);
        if (HttpUrl.parse(escaped) != null) {
            return escaped;
        }
        // 两种都过不了 → 给出明确原因（而不是 okhttp 那句看不出问题的 "unexpected url"）
        String reason;
        try {
            new URI(trimmed);
            reason = "URL 不完整或含非法字符";
        } catch (URISyntaxException e) {
            reason = e.getReason() == null ? "URL 语法错误" : e.getReason();
        }
        throw new IllegalArgumentException("无效的 WebDAV 地址: " + url + "（" + reason + "）");
    }

    /** 逐码点做百分号转义：保留 URL 保留字与已有的 %XX，其余（空格/中文等）转义。 */
    private static String escapeLenient(String url) {
        StringBuilder out = new StringBuilder(url.length() + 16);
        for (int i = 0; i < url.length(); ) {
            int codePoint = url.codePointAt(i);
            int width = Character.charCount(codePoint);
            if (codePoint < 0x80) {
                char c = (char) codePoint;
                if (c == '%' && isHexPair(url, i + 1)) {
                    out.append('%'); // 已是 %XX，原样保留，避免二次转义
                } else if (SAFE_ASCII.indexOf(c) >= 0) {
                    out.append(c);
                } else {
                    appendPercent(out, (byte) c);
                }
            } else {
                byte[] bytes = url.substring(i, i + width).getBytes(StandardCharsets.UTF_8);
                for (byte b : bytes) {
                    appendPercent(out, b);
                }
            }
            i += width;
        }
        return out.toString();
    }

    private static boolean isHexPair(String s, int at) {
        return at + 1 < s.length()
                && Character.digit(s.charAt(at), 16) >= 0
                && Character.digit(s.charAt(at + 1), 16) >= 0;
    }

    private static void appendPercent(StringBuilder out, byte value) {
        out.append('%');
        out.append(Character.toUpperCase(Character.forDigit((value >> 4) & 0xF, 16)));
        out.append(Character.toUpperCase(Character.forDigit(value & 0xF, 16)));
    }
}
