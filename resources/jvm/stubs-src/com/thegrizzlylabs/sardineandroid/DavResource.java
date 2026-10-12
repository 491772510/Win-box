package com.thegrizzlylabs.sardineandroid;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * WebDAV 资源模型 —— sardine-android 的 {@code DavResource} 的桌面端实现。
 *
 * ★ 为什么必须是 **class**（不能是 interface）：wex 字节码对下列 getter 用的是
 *   `invokevirtual`（而 Sardine 的方法用的是 `invokeinterface`）：
 *
 *     com/thegrizzlylabs/sardineandroid/DavResource.getName()Ljava/lang/String;
 *     com/thegrizzlylabs/sardineandroid/DavResource.getPath()Ljava/lang/String;
 *     com/thegrizzlylabs/sardineandroid/DavResource.getContentLength()Ljava/lang/Long;
 *     com/thegrizzlylabs/sardineandroid/DavResource.isDirectory()Z
 *     com/thegrizzlylabs/sardineandroid/DavResource.getModified()Ljava/util/Date;
 *
 * ★★ 两个"必须完全一致"的语义（错一个，WebDAV 蜘蛛列出来的目录就是空的/乱码）：
 *   1. `getContentLength()` **永不返回 null**（无值时返回 {@link #DEFAULT_CONTENT_LENGTH}）。
 *      merge.t.b.h() 直接调 `.longValue()`，返回 null 就是 NPE。
 *   2. `isDirectory()` 的判据是 **contentType == "httpd/unix-directory"**，
 *      而 contentType 由 `<resourcetype><collection/>` 推导而来 —— 不是看 href 是否以 "/" 结尾。
 *
 * 语义逐条对齐上游 thegrizzlylabs/sardine-android 的 DavResource（已核对源码）：
 *   getName()  = href 的 path 去掉结尾 "/" 后取最后一段（**URL 解码后**，中文名才正常）
 *   getPath()  = href 的 path（解码后，含前导 "/"）
 *   getContentType()：resourcetype 含 collection → "httpd/unix-directory"；
 *                     否则取 getcontenttype；都没有 → "application/octet-stream"
 *   getContentLength()/getEtag()/getCreationDate()：遍历 propstat 取第一个有值的；
 *                     getContentLength 解析失败继续找下一个，最终回落 -1
 *   getModified()：取第一个有 prop 的 propstat 的 getlastmodified（**即使为 null 也立即返回**）
 *
 * 与上游的唯一差异：上游依赖 SimpleXml/JAXB 做 XML↔模型绑定；这里改用 JDK 自带的
 * `javax.xml.parsers`（java.xml 模块，随包 JRE 里有）直接解析 207 Multi-Status，
 * 免掉 simple-xml 这一整条依赖链。
 */
public class DavResource {

    /** 无 getcontenttype 时的默认类型（与上游一致）。 */
    public static final String DEFAULT_CONTENT_TYPE = "application/octet-stream";

    /** 无 getcontentlength 时的默认长度（与上游一致，**不是 null**）。 */
    public static final long DEFAULT_CONTENT_LENGTH = -1L;

    /** 目录的 content-type（与上游一致；isDirectory() 就是靠它判定）。 */
    public static final String HTTPD_UNIX_DIRECTORY_CONTENT_TYPE = "httpd/unix-directory";

    /** propstat 无 status 时的默认状态码（与上游一致）。 */
    public static final int DEFAULT_STATUS_CODE = 200;

    private static final String SEPARATOR = "/";

    /**
     * 上游支持的全部日期格式（原样照抄，顺序即优先级）。
     * WebDAV 服务器实现五花八门：RFC1123、ISO8601（带/不带毫秒）、asctime 都出现过。
     */
    private static final String[] SUPPORTED_DATE_FORMATS = new String[]{
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "EEE, dd MMM yyyy HH:mm:ss zzz",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "EEE MMM dd HH:mm:ss zzz yyyy",
            "EEEEEE, dd-MMM-yy HH:mm:ss zzz",
            "EEE MMMM d HH:mm:ss yyyy"};

    private final String href;
    private final String path;
    private final String name;
    private final int status;
    private final Date creation;
    private final Date modified;
    private final String contentType;
    private final String etag;
    private final String displayName;
    private final String contentLanguage;
    private final Long contentLength;

    private DavResource(String href, int status, List<Element> props) {
        this.href = href == null ? "" : href;
        this.status = status;
        this.path = pathOf(this.href);
        this.name = nameOf(this.path);
        this.creation = parseDate(firstText(props, "creationdate"));
        this.modified = parseDate(firstText(props, "getlastmodified"));
        this.contentType = contentTypeOf(props);
        this.etag = firstText(props, "getetag");
        this.displayName = firstText(props, "displayname");
        this.contentLanguage = firstText(props, "getcontentlanguage");
        this.contentLength = Long.valueOf(contentLengthOf(props));
    }

    // ------------------------------------------------------------------ getters

    /** 服务器原样返回的 href（可能未解码）。 */
    public String getHref() {
        return this.href;
    }

    /** href 的路径部分（URL 解码后，含前导 "/"）。 */
    public String getPath() {
        return this.path;
    }

    /** 资源名（path 的最后一段，已解码）。 */
    public String getName() {
        return this.name;
    }

    /** 是否目录（contentType == "httpd/unix-directory"）。 */
    public boolean isDirectory() {
        return HTTPD_UNIX_DIRECTORY_CONTENT_TYPE.equals(this.contentType);
    }

    /** 内容长度；**无值时返回 {@link #DEFAULT_CONTENT_LENGTH}（-1），永不返回 null**。 */
    public Long getContentLength() {
        return this.contentLength;
    }

    /** 最后修改时间；服务端没给则为 null。 */
    public Date getModified() {
        return this.modified;
    }

    /** 创建时间；服务端没给则为 null。 */
    public Date getCreationDate() {
        return this.creation;
    }

    public String getContentType() {
        return this.contentType;
    }

    public String getEtag() {
        return this.etag;
    }

    public String getDisplayName() {
        return this.displayName;
    }

    public String getContentLanguage() {
        return this.contentLanguage;
    }

    public int getStatus() {
        return this.status;
    }

    @Override
    public String toString() {
        return this.getPath();
    }

    // -------------------------------------------------------------- 207 多状态解析

    /**
     * 解析 PROPFIND 的 207 Multi-Status 响应 → 资源列表。
     *
     * 注意：**不过滤目标集合自身**（上游也不过滤）。Depth:1 的响应里第一个
     * response 就是被请求的那个目录，`com.github.catvod.spider.WebDAV` 自己会跳过它。
     */
    public static List<DavResource> parseMultiStatus(InputStream in) throws IOException {
        Document doc;
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            // 命名空间感知：服务器一般用 <D:multistatus xmlns:D="DAV:">
            factory.setNamespaceAware(true);
            factory.setExpandEntityReferences(false);
            // XXE 防护：WebDAV 地址由用户填写，响应内容不可全信。
            // 部分解析器实现不认这些 feature/attribute → 逐个 try，失败即忽略（不影响解析）。
            setFeatureQuietly(factory, "http://apache.org/xml/features/disallow-doctype-decl", true);
            setFeatureQuietly(factory, "http://xml.org/sax/features/external-general-entities", false);
            setFeatureQuietly(factory, "http://xml.org/sax/features/external-parameter-entities", false);
            setFeatureQuietly(factory, "http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            // 外部实体一律解析成空，杜绝网络/本地文件读取
            builder.setEntityResolver((publicId, systemId) ->
                    new org.xml.sax.InputSource(new java.io.StringReader("")));
            doc = builder.parse(in);
        } catch (Throwable t) {
            throw new IOException("WebDAV 响应不是合法 XML: " + t, t);
        }
        if (doc == null || doc.getDocumentElement() == null) {
            throw new IOException("WebDAV 响应为空");
        }

        List<Element> responses = children(doc.getDocumentElement(), "response");
        List<DavResource> resources = new ArrayList<DavResource>(responses.size());
        for (Element response : responses) {
            List<Element> hrefs = children(response, "href");
            if (hrefs.isEmpty()) {
                continue; // 没有 href 无法定位资源，跳过（上游同样忽略）
            }
            // 上游对每个 propstat 只取它的**第一个** <prop>；这里保持同样口径，
            // 于是"按 propstat 顺序取第一个有值的属性"这套算法与上游逐行等价。
            List<Element> props = new ArrayList<Element>();
            for (Element propstat : children(response, "propstat")) {
                Element prop = firstChild(propstat, "prop");
                if (prop != null) {
                    props.add(prop);
                }
            }
            resources.add(new DavResource(text(hrefs.get(0)), statusOf(response), props));
        }
        return resources;
    }

    // ------------------------------------------------------------------ 属性推导

    /**
     * contentType：先看 resourcetype 是否含 collection（→ 目录类型），
     * 否则取 getcontenttype，都没有则 DEFAULT_CONTENT_TYPE。
     * 与上游一致：某个 prop 两个都没有时**继续看下一个 propstat**。
     */
    private static String contentTypeOf(List<Element> props) {
        for (Element prop : props) {
            Element resourcetype = firstChild(prop, "resourcetype");
            if (resourcetype != null && firstChild(resourcetype, "collection") != null) {
                return HTTPD_UNIX_DIRECTORY_CONTENT_TYPE;
            }
            String type = textOrNull(firstChild(prop, "getcontenttype"));
            if (type != null) {
                return type;
            }
        }
        return DEFAULT_CONTENT_TYPE;
    }

    /** contentLength：第一个非空 getcontentlength；解析失败则继续，最终回落到 -1。 */
    private static long contentLengthOf(List<Element> props) {
        for (Element prop : props) {
            String raw = textOrNull(firstChild(prop, "getcontentlength"));
            if (raw != null) {
                try {
                    return Long.parseLong(raw.trim());
                } catch (NumberFormatException ignored) {
                    // 与上游一致：解析失败继续往下找
                }
            }
        }
        return DEFAULT_CONTENT_LENGTH;
    }

    /**
     * 取**第一个有 prop 的 propstat** 里指定属性的文本（上游就是"立即返回"语义，
     * 所以 getlastmodified 缺失时返回 null 而不是继续找后面的 propstat）。
     */
    private static String firstText(List<Element> props, String localName) {
        if (props.isEmpty()) {
            return null;
        }
        return textOrNull(firstChild(props.get(0), localName));
    }

    /** 从 `<status>HTTP/1.1 200 OK</status>` 里取状态码；缺失/异常回落 200（与上游一致）。 */
    private static int statusOf(Element response) {
        String status = textOrNull(firstChild(response, "status"));
        if (status == null || status.isEmpty()) {
            return DEFAULT_STATUS_CODE;
        }
        // 找第一段纯数字的 token
        int i = 0;
        while (i < status.length()) {
            if (Character.isDigit(status.charAt(i))) {
                int j = i;
                while (j < status.length() && Character.isDigit(status.charAt(j))) {
                    j++;
                }
                try {
                    return Integer.parseInt(status.substring(i, j));
                } catch (NumberFormatException ignored) {
                    return -1;
                }
            }
            i++;
        }
        return DEFAULT_STATUS_CODE;
    }

    // ------------------------------------------------------------------ 路径/日期

    /**
     * href → 解码后的 path。
     * 优先用 {@link URI}（与上游 `new URI(href).getPath()` 完全一致）；
     * 但部分服务器会回**未转义的原始 UTF-8/空格** href，`new URI` 直接抛
     * URISyntaxException（上游会把这个资源整个丢掉 → 蜘蛛里中文目录凭空消失）。
     * 桌面端这里做一次宽容回落，比"丢掉"更符合用户预期。
     */
    private static String pathOf(String href) {
        String s = href == null ? "" : href.trim();
        if (!s.isEmpty()) {
            try {
                String uriPath = new URI(s).getPath();
                if (uriPath != null) {
                    return uriPath;
                }
            } catch (URISyntaxException ignored) {
                // 落到下面的宽容解析
            }
        }
        int hash = s.indexOf('#');
        if (hash >= 0) {
            s = s.substring(0, hash);
        }
        int query = s.indexOf('?');
        if (query >= 0) {
            s = s.substring(0, query);
        }
        int scheme = s.indexOf("://");
        if (scheme >= 0) {
            int slash = s.indexOf('/', scheme + 3);
            s = slash >= 0 ? s.substring(slash) : SEPARATOR;
        }
        return decodePercent(s);
    }

    /** path → 资源名：去掉结尾 "/" 后取最后一段（与上游逐字一致）。 */
    private static String nameOf(String path) {
        String s = path == null ? "" : path;
        if (s.endsWith(SEPARATOR)) {
            s = s.substring(0, s.length() - 1);
        }
        return s.substring(s.lastIndexOf('/') + 1);
    }

    /** 仅解码 %XX 字节序（不用 URLDecoder —— 它会把 "+" 变成空格，路径里那是错的）。 */
    private static String decodePercent(String s) {
        if (s == null || s.indexOf('%') < 0) {
            return s;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(s.length());
        for (int i = 0; i < s.length(); ) {
            char c = s.charAt(i);
            if (c == '%' && i + 2 < s.length()) {
                int hi = Character.digit(s.charAt(i + 1), 16);
                int lo = Character.digit(s.charAt(i + 2), 16);
                if (hi >= 0 && lo >= 0) {
                    out.write((hi << 4) + lo);
                    i += 3;
                    continue;
                }
            }
            int cp = s.codePointAt(i);
            int len = Character.charCount(cp);
            byte[] bytes = s.substring(i, i + len).getBytes(StandardCharsets.UTF_8);
            out.write(bytes, 0, bytes.length);
            i += len;
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    /** 按上游的格式清单依次尝试解析日期（UTC + Locale.US）。 */
    public static Date parseDate(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        String v = value.trim();
        for (String pattern : SUPPORTED_DATE_FORMATS) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            format.setLenient(false);
            try {
                return format.parse(v);
            } catch (ParseException ignored) {
                // 换下一个格式
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ DOM 小工具

    /**
     * 按**本地名**取直接子元素。
     * 不用 getElementsByTagNameNS：部分服务器发的 XML 根本没声明命名空间，
     * namespace-aware 解析下会匹配不到；按 localName（缺失时退回去前缀的 nodeName）
     * 遍历则两种写法通吃。
     */
    static List<Element> children(Node parent, String localName) {
        List<Element> out = new ArrayList<Element>();
        if (parent == null) {
            return out;
        }
        NodeList kids = parent.getChildNodes();
        for (int i = 0; i < kids.getLength(); i++) {
            Node kid = kids.item(i);
            if (kid.getNodeType() == Node.ELEMENT_NODE && matches(kid, localName)) {
                out.add((Element) kid);
            }
        }
        return out;
    }

    static Element firstChild(Node parent, String localName) {
        List<Element> found = children(parent, localName);
        return found.isEmpty() ? null : found.get(0);
    }

    static String text(Element element) {
        return element == null ? "" : element.getTextContent();
    }

    static String textOrNull(Element element) {
        if (element == null) {
            return null;
        }
        String value = element.getTextContent();
        if (value == null) {
            return null;
        }
        value = value.trim();
        return value.isEmpty() ? null : value;
    }

    private static boolean matches(Node node, String localName) {
        String local = node.getLocalName();
        if (local == null) {
            // 非 namespace-aware 解析（或没有命名空间声明）时的回落
            local = node.getNodeName();
            int colon = local.indexOf(':');
            if (colon >= 0) {
                local = local.substring(colon + 1);
            }
        }
        return localName.equals(local);
    }

    private static void setFeatureQuietly(DocumentBuilderFactory factory, String feature, boolean value) {
        try {
            factory.setFeature(feature, value);
        } catch (Throwable ignored) {
            // 解析器不认这个 feature —— 不影响正常解析
        }
    }
}
