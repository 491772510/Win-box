package com.thegrizzlylabs.sardineandroid;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/**
 * WebDAV 客户端门面 —— 补齐 Android APK 的第三方依赖 sardine-android。
 *
 * ★★ 2026-10-12 新增（用户报「导入历史配置不行」的根因修复）★★
 *
 * 背景：wexshinidie（wex）加固壳的「配置中心 → 备份与还原 → WebDAV还原」
 * 这条链路，服务端实现是 `com.github.catvod.spider.merge.o0.c.K()`：
 *
 *     o0.c.K(server, user, pass)
 *       └─ new com.thegrizzlylabs.sardineandroid.impl.OkHttpSardine()   ← 卡在这
 *            ├─ setCredentials(user, pass)
 *            ├─ get(normalize(server) + "/wexfnw/Wexfnw.zip")
 *            └─ …解压覆盖 NewWexFnw_preferences.xml
 *
 * `sardine-android` 是 **Android APK 自己的库依赖**（com.github.thegrizzlylabs:
 * sardine-android，OkHttp 4 系），既不随蜘蛛 jar 走，也不在桌面 libs/ 里 ——
 * 直接 `ClassNotFoundException`，异常冒到 HTTP handler，网页就显示"导入失败"。
 * 桌面端取证：见 SardineProbe（Class.forName / new OkHttpSardine() 双双 MISSING）。
 *
 * ★ 这里**不是空桩**：WebDAV 备份/还原是用户真实要用的功能，必须真实现。
 *   本接口的方法签名由「wex jar 常量池全量扫描」反查得到，一处不多一处不少：
 *
 *     setCredentials(Ljava/lang/String;Ljava/lang/String;)V   ← invokeinterface ×2
 *     exists(Ljava/lang/String;)Z
 *     createDirectory(Ljava/lang/String;)V
 *     put(Ljava/lang/String;Ljava/io/File;Ljava/lang/String;)V
 *     get(Ljava/lang/String;)Ljava/io/InputStream;
 *     list(Ljava/lang/String;)Ljava/util/List;
 *
 *   ★ 必须是 **interface**：wex 字节码里对这些方法的调用是 `invokeinterface`，
 *     若做成 class，-noverify 下会按错误的 vtable 槽位派发（同类教训见
 *     android.view.ViewGroup$LayoutParams 那次 JVM 硬崩）。
 *     反之 `DavResource` 的 5 个 getter 是 `invokevirtual`，必须是 **class**。
 */
public interface Sardine {

    /**
     * 设置 Basic 认证凭据。
     *
     * 桌面端实现采用**预认证**（每个请求直接带 Authorization，不等 401 挑战）。
     * 原因不只是省一次往返：本机实测 WsgiDAV/Cheroot 在 401 错误路径上会给 HEAD
     * 响应带 body（违反 RFC 7231 §4.3.2），okhttp 按规范不读它 → 连接复用错位 →
     * 报 "Unexpected status line: <html>"。预认证不产生 401，从根上避开。
     * （真实 sardine 的 setCredentials(u, p, true) 就是这个模式。）
     */
    void setCredentials(String username, String password);

    /**
     * 资源是否存在。
     *
     * 桌面端实现用 **PROPFIND Depth:0**（真实 sardine 用 HEAD）：
     * 实测自建 WebDAV（WsgiDAV/Cheroot）会给 HEAD 的**错误响应**也带上 HTML body，
     * okhttp 按规范不读 → 连接复用错位 → 紧接着的下一个操作报
     * "Unexpected status line: &lt;!DOCTYPE HTML…&gt;"。PROPFIND 没有这个问题。
     * 若服务端明确拒绝 PROPFIND（405/501），会自动退回 HEAD。
     */
    boolean exists(String url) throws IOException;

    /** 创建集合（目录，MKCOL）。已存在时服务端通常回 405，由调用方决定是否忽略。 */
    void createDirectory(String url) throws IOException;

    /** 列出集合成员（PROPFIND，默认 Depth: 1）。返回结果**包含目标集合自身**。 */
    List<DavResource> list(String url) throws IOException;

    /** 列出集合成员，指定 Depth（<0 表示 infinity）。 */
    List<DavResource> list(String url, int depth) throws IOException;

    /** GET 资源内容。返回的流由调用方负责关闭；未关闭前不得关闭底层响应。 */
    InputStream get(String url) throws IOException;

    /** PUT 本地文件。contentType 可为 null（此时不带 Content-Type）。 */
    void put(String url, File file, String contentType) throws IOException;

    /** 删除资源。 */
    void delete(String url) throws IOException;

    /** 移动/重命名（MOVE，默认 OVERWRITE: T）。 */
    void move(String sourceUrl, String destinationUrl) throws IOException;
}
