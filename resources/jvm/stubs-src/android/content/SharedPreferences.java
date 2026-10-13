package android.content;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * SharedPreferences stub —— Android 键值配置。
 *
 * <h3>★ 2026-10-13 为什么必须真持久化（此前是纯内存，等于每次重启丢配置）</h3>
 * 加固壳（wex / AiWex 系：玩偶、木偶、新光影 AiNewGuanYing、AiPan1Me、AiNewWoNiu4K…）
 * 把**全部账号与网盘凭据**都放在这里：
 * <pre>
 *   Context.getSharedPreferences("NewWexFnw_preferences", 0)
 *     · Wex_quark_cookie / Wex_ucpan_cookie / Wex_baidu_cookie / Wex_pan115_cookie / Wex_bili_cookie
 *     · Wex_guanying_cookie / Wex_pan1me_cookie / Wex_WoNiu4K_Cookie / Wex_guangya_zhenying_cookie
 *     · pan.credential.* / Wex_WebDav_url / thunderCfg …
 * </pre>
 * 而宿主（桌面端）会按需回收/重启蜘蛛 JVM（见 SpiderHost 的池回收）。
 * 桩此前是 `Mem` 里的一个 HashMap、**从不落盘** → 每重启一次进程，`Wex_*` 全空 →
 * 用户明明绑过夸克，源侧却报「还没有配置夸克 Cookie，请先去配置中心登录」。
 *
 * 现在按 Android 真实语义持久化到
 *   `{@code <Context.getBaseDir()>/shared_prefs/<name>.xml}`
 * （与壳自带的备份/还原 `merge.o0.c` 写出的 `NewWexFnw_preferences.xml` **同路径同格式**，
 *   所以壳自己备份出来的文件能被原样读回，反之亦然）。
 *
 * <h3>★ 宿主侧默认值（Win-box 自己的扫码绑定如何喂给壳）</h3>
 * 光有持久化还不够：用户在 Win-box「网盘」页扫码绑定的 cookie 只进了宿主的 DriveStore，
 * 壳的 `Wex_*_cookie` 只有在**网页配置中心登录**时才会被写入。
 * 故约定一个宿主专属文件
 *   `{@code <shared_prefs>/winbox-host-prefs.properties}`（UTF-8，每行 `key=value`）
 * 由宿主写入，`Mem` 在**载入时**把里面的键当作「缺省值」并入 —— 且只在 XML 里
 * **没有这个键（或值为空）**时才生效。
 *
 * ⚠ **不用 `java.util.Properties` 解析**：它把 `\` 当转义、把 `:` 也当分隔符，
 *   而网盘 cookie 里既有 base64 的 `+/=` 也可能出现 `\` —— 会被静默改坏。
 *   这里按「第一个 `=` 切一刀」手写解析，值原样保留（只去掉行尾空白）。
 *
 * 为什么是「缺省」而不是「覆盖」：壳会自己刷新 cookie
 * （`merge.d0.i.C()` → `auth/pc/flush` → 回写 `Wex_quark_cookie`）。
 * 若宿主值恒优先，壳每次刷新完都会被旧的宿主值盖回去 → 反而把有效凭据改坏。
 * <h3>★ 谁优先：按**文件新旧**裁定，而不是固定谁大</h3>
 * 固定「XML 优先」看着对（壳会自己刷新 cookie），但真机上会翻车：
 * 本机 `NewWexFnw_preferences.xml` 是用户从 WebDAV **还原**出来的备份（09:48），
 * 里面躺着一个**别人的/过期的** `Wex_quark_cookie`；而宿主那份是 11:01 刚扫码绑定的。
 * 固定 XML 优先 → 用户绑了新的却仍在用旧的 → 等于没修。
 *
 * 故按 mtime 裁定：`winbox-host-prefs.properties` 比 `<name>.xml` 新 → 宿主值优先，反之 XML 优先。
 * 配套要求：宿主**内容没变就不要重写**这个文件（见 `syncWexHostPrefs`），
 * 否则每次启动都会把它刷新成「现在」，宿主就恒赢了，壳自己的刷新又会被盖掉。
 * 于是三种情形都自洽：
 *   ① 只在 Win-box 绑过（无 XML）→ 用宿主的；
 *   ② 在网页配置中心登录/刷新过（XML 随之变新）→ 用壳的（更新）；
 *   ③ 还原了旧备份又重新绑过（宿主文件更晚）→ 用宿主的（新绑的）。
 *
 * ⚠ **宿主默认值绝不写进 XML**：`Mem` 为它单独留了一个 map，读的时候兜底、
 * 落盘的时候跳过。否则只要壳因为任何原因 `apply()` 一次（改个开关就算），
 * 宿主值就会被固化进 XML —— 之后用户在 Win-box 里解绑，壳这边却还留着一份，
 * 表现为「解绑了照样能播」。
 *
 * <h3>设计原则（与全部桩一致）</h3>
 * · **永不抛异常**：读不到/写不了只降级为「内存态」，绝不能中断业务链；
 * · 所有文件 I/O 一律 {@code catch Throwable}（`NoClassDefFoundError` 是 Error 不是 Exception）。
 */
public interface SharedPreferences {

    SharedPreferences.Editor edit();

    String getString(String key, String defValue);

    int getInt(String key, int defValue);

    boolean getBoolean(String key, boolean defValue);

    long getLong(String key, long defValue);

    float getFloat(String key, float defValue);

    Set<String> getStringSet(String key, Set<String> defValues);

    Map<String, ?> getAll();

    boolean contains(String key);

    interface Editor {

        Editor putString(String key, String value);

        Editor putInt(String key, int value);

        Editor putBoolean(String key, boolean value);

        Editor putLong(String key, long value);

        /** ★ 2026-10-13：`merge.x0.e` 会调它，此前桩里没有 → NoSuchMethodError。 */
        Editor putFloat(String key, float value);

        Editor remove(String key);

        Editor clear();

        boolean commit();

        void apply();
    }

    /**
     * 进程内按名字共享的一族偏好；每个实例对应一个 `{@code <name>.xml}`。
     * 同时实现 {@link Editor}（与旧桩一致，`edit()` 返回自身）—— 壳的调用方
     * 有对 Editor 的 checkcast，返回别的对象会在 `-noverify` 下变成类型混淆。
     */
    final class Mem implements SharedPreferences, SharedPreferences.Editor {

        private static final Map<String, Mem> INST = new LinkedHashMap<String, Mem>();

        /** ★ 2026-10-13：宿主写入的默认值文件名（本进程只读，不写） */
        private static final String HOST_PREFS_FILE = "winbox-host-prefs.properties";

        private final String name;
        /** 壳自己的配置（会被持久化到 `<name>.xml`） */
        private final Map<String, Object> data = new LinkedHashMap<String, Object>();
        /**
         * ★ 宿主（Win-box）扫码绑定写下的默认值 —— **只读兜底，绝不落盘**。
         * 与 `data` 分开存，就是为了让「宿主值」永远不变成「壳的状态」（详见类注释）。
         */
        private final Map<String, Object> hostDefaults = new LinkedHashMap<String, Object>();
        /** 载入完成时是否为「空配置」（用于避免把空壳回写成 0 字节 XML 覆盖掉好文件） */
        private volatile boolean loadedEmpty;
        /**
         * ★ 宿主默认值是否**优先于**本族 XML —— 按两个文件的 mtime 裁定（详见类注释）。
         * 只有在宿主确实提供了值时才有意义（hostDefaults 为空时恒为「XML 优先」也无妨）。
         */
        private volatile boolean hostWins;

        public Mem() {
            this("default");
        }

        public Mem(String name) {
            this.name = name == null ? "default" : name;
            load();
        }

        public static Mem get(String name) {
            String key = name == null ? "default" : name;
            synchronized (INST) {
                Mem m = INST.get(key);
                if (m == null) {
                    m = new Mem(key);
                    INST.put(key, m);
                }
                return m;
            }
        }

        // ---------------- 读 ----------------

        @Override
        public synchronized Editor edit() {
            return this;
        }

        /**
         * 取值口径：`hostWins` 为真时宿主默认值优先，否则壳自己的 `data` 优先；
         * 一方缺失或为空 → 退回另一方；两边都没有 → null（调用方用它的缺省值）。
         *
         * 「为空也退」是因为壳清 cookie 时是写空串而不是 remove —— 空串等于没配。
         */
        private synchronized Object raw(String key) {
            Object d = data.get(key);
            Object h = hostDefaults.get(key);
            boolean dEmpty = isBlank(d);
            boolean hEmpty = isBlank(h);
            if (hostWins) {
                if (!hEmpty) return h;
                return dEmpty ? null : d;
            }
            if (!dEmpty) return d;
            return hEmpty ? null : h;
        }

        private static boolean isBlank(Object v) {
            return v == null || (v instanceof String && ((String) v).trim().isEmpty());
        }

        @Override
        public synchronized String getString(String key, String defValue) {
            Object v = raw(key);
            if (v == null || (v instanceof String && ((String) v).trim().isEmpty())) return defValue;
            if (v instanceof String) return (String) v;
            return String.valueOf(v);
        }

        @Override
        public synchronized int getInt(String key, int defValue) {
            Object v = raw(key);
            if (v instanceof Integer) return ((Integer) v).intValue();
            if (v instanceof Long) return (int) ((Long) v).longValue();
            if (v instanceof String) {
                try {
                    return Integer.parseInt(((String) v).trim());
                } catch (Throwable ignored) {
                    return defValue;
                }
            }
            return defValue;
        }

        @Override
        public synchronized boolean getBoolean(String key, boolean defValue) {
            Object v = raw(key);
            if (v instanceof Boolean) return ((Boolean) v).booleanValue();
            if (v instanceof String) return Boolean.parseBoolean(((String) v).trim());
            if (v instanceof Integer) return ((Integer) v).intValue() != 0;
            return defValue;
        }

        @Override
        public synchronized long getLong(String key, long defValue) {
            Object v = raw(key);
            if (v instanceof Long) return ((Long) v).longValue();
            if (v instanceof Integer) return ((Integer) v).intValue();
            if (v instanceof String) {
                try {
                    return Long.parseLong(((String) v).trim());
                } catch (Throwable ignored) {
                    return defValue;
                }
            }
            return defValue;
        }

        @Override
        public synchronized float getFloat(String key, float defValue) {
            Object v = raw(key);
            if (v instanceof Float) return ((Float) v).floatValue();
            if (v instanceof Double) return (float) ((Double) v).doubleValue();
            if (v instanceof String) {
                try {
                    return Float.parseFloat(((String) v).trim());
                } catch (Throwable ignored) {
                    return defValue;
                }
            }
            return defValue;
        }

        @Override
        @SuppressWarnings("unchecked")
        public synchronized Set<String> getStringSet(String key, Set<String> defValues) {
            Object v = raw(key);
            if (v instanceof Set) return (Set<String>) v;
            return defValues;
        }

        @Override
        public synchronized Map<String, ?> getAll() {
            // 备份场景：把宿主兜底值一并给出，还原到别处也能带上绑定信息。
            // 覆盖顺序与 raw() 的裁定保持一致（hostWins 时宿主值后写、覆盖壳值）
            Map<String, Object> all = new LinkedHashMap<String, Object>();
            if (hostWins) {
                all.putAll(data);
                all.putAll(hostDefaults);
            } else {
                all.putAll(hostDefaults);
                all.putAll(data);
            }
            return all;
        }

        @Override
        public synchronized boolean contains(String key) {
            return data.containsKey(key) || hostDefaults.containsKey(key);
        }

        // ---------------- 写 ----------------

        @Override
        public synchronized Editor putString(String key, String value) {
            if (key != null) data.put(key, value);
            return this;
        }

        @Override
        public synchronized Editor putInt(String key, int value) {
            if (key != null) data.put(key, Integer.valueOf(value));
            return this;
        }

        @Override
        public synchronized Editor putBoolean(String key, boolean value) {
            if (key != null) data.put(key, Boolean.valueOf(value));
            return this;
        }

        @Override
        public synchronized Editor putLong(String key, long value) {
            if (key != null) data.put(key, Long.valueOf(value));
            return this;
        }

        @Override
        public synchronized Editor putFloat(String key, float value) {
            if (key != null) data.put(key, Float.valueOf(value));
            return this;
        }

        @Override
        public synchronized Editor remove(String key) {
            if (key != null) data.remove(key);
            return this;
        }

        @Override
        public synchronized Editor clear() {
            data.clear();
            return this;
        }

        @Override
        public synchronized boolean commit() {
            save();
            return true;
        }

        /**
         * Android 的 apply() 是异步落盘；这里改为**同步写**。
         * 理由：蜘蛛 JVM 会被宿主随时回收，异步写很可能在进程被杀时丢掉刚配好的凭据，
         * 而配置写入频率极低（一次登录/一次刷新），同步写的代价可以忽略。
         */
        @Override
        public synchronized void apply() {
            save();
        }

        // ---------------- 持久化 ----------------

        private File file() {
            try {
                File base = Context.getBaseDir();
                if (base == null) return null;
                File dir = new File(base, "shared_prefs");
                String safe = name.replace('/', '_').replace('\\', '_').replace(':', '_');
                return new File(dir, safe + ".xml");
            } catch (Throwable t) {
                return null;
            }
        }

        private void load() {
            try {
                File f = file();
                if (f != null && f.isFile()) {
                    parseXml(readAll(f));
                }
                loadedEmpty = data.isEmpty();
                mergeHostDefaults();
            } catch (Throwable t) {
                /* 读失败只降级为内存态 */
            }
        }

        /**
         * 并入宿主写入的默认值：`winbox-host-prefs.properties`。
         * 值只进 `hostDefaults`（不进 `data`），并顺带按 mtime 裁定 `hostWins`（详见类注释）。
         */
        private void mergeHostDefaults() {
            try {
                File base = Context.getBaseDir();
                if (base == null) return;
                File f = new File(new File(base, "shared_prefs"), HOST_PREFS_FILE);
                if (!f.isFile()) return;
                // 每行一个 `key=value`；值里允许出现 `=`（取第一个 `=` 切开），不做任何转义处理。
                for (String entry : readAll(f).split("\n")) {
                    String line = entry.trim();
                    if (line.isEmpty() || line.charAt(0) == '#') continue;
                    int eq = line.indexOf('=');
                    if (eq <= 0) continue;
                    String k = line.substring(0, eq).trim();
                    String v = line.substring(eq + 1).trim();
                    if (k.isEmpty() || v.isEmpty()) continue;
                    // 只进 hostDefaults（不进 data）→ 永远不会被落盘，解绑即生效
                    hostDefaults.put(k, v);
                }
                // 谁更新用谁：宿主文件比本族 XML 新 → 宿主值优先（详见类注释）
                File xml = file();
                long xmlMs = xml != null && xml.isFile() ? xml.lastModified() : 0L;
                hostWins = !hostDefaults.isEmpty() && f.lastModified() > xmlMs;
            } catch (Throwable t) {
                /* ignore */
            }
        }

        private void save() {
            try {
                // 载入是空的、且没有新写入 → 不写一个空文件去覆盖壳已有的好文件
                if (loadedEmpty && data.isEmpty()) return;
                File f = file();
                if (f == null) return;
                File dir = f.getParentFile();
                if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return;
                File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
                FileOutputStream out = null;
                try {
                    out = new FileOutputStream(tmp);
                    OutputStreamWriter w = new OutputStreamWriter(out, StandardCharsets.UTF_8);
                    w.write(toXml());
                    w.flush();
                    w.close();
                    out = null;
                } finally {
                    if (out != null) {
                        try {
                            out.close();
                        } catch (Throwable ignored) {
                            /* ignore */
                        }
                    }
                }
                // 原子替换（与宿主侧「写 .part 再改名」同款约定）
                if (f.exists() && !f.delete()) {
                    /* 删不掉就直写，Windows 上偶发；不因此丢配置 */
                }
                if (!tmp.renameTo(f)) {
                    writeDirect(f);
                }
            } catch (Throwable t) {
                /* 写失败只影响持久化，不影响本次进程内的读写 */
            }
        }

        private void writeDirect(File f) {
            FileOutputStream out = null;
            try {
                out = new FileOutputStream(f);
                OutputStreamWriter w = new OutputStreamWriter(out, StandardCharsets.UTF_8);
                w.write(toXml());
                w.flush();
            } catch (Throwable t) {
                /* ignore */
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (Throwable ignored) {
                        /* ignore */
                    }
                }
            }
        }

        /** 与 Android XmlUtils.writeMapXml 同形（壳的备份/还原也认这个格式） */
        private synchronized String toXml() {
            StringBuilder sb = new StringBuilder();
            sb.append("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n");
            sb.append("<map>\n");
            for (Map.Entry<String, Object> e : data.entrySet()) {
                String k = esc(e.getKey());
                Object v = e.getValue();
                if (v instanceof String) {
                    sb.append("    <string name=\"").append(k).append("\">").append(esc((String) v)).append("</string>\n");
                } else if (v instanceof Integer) {
                    sb.append("    <int name=\"").append(k).append("\" value=\"").append(v).append("\" />\n");
                } else if (v instanceof Long) {
                    sb.append("    <long name=\"").append(k).append("\" value=\"").append(v).append("\" />\n");
                } else if (v instanceof Float) {
                    sb.append("    <float name=\"").append(k).append("\" value=\"").append(v).append("\" />\n");
                } else if (v instanceof Boolean) {
                    sb.append("    <boolean name=\"").append(k).append("\" value=\"").append(v).append("\" />\n");
                } else if (v instanceof Set) {
                    sb.append("    <set name=\"").append(k).append("\">");
                    for (Object o : (Set<?>) v) {
                        sb.append("<string>").append(esc(String.valueOf(o))).append("</string>");
                    }
                    sb.append("</set>\n");
                } else if (v != null) {
                    sb.append("    <string name=\"").append(k).append("\">").append(esc(String.valueOf(v))).append("</string>\n");
                }
            }
            sb.append("</map>\n");
            return sb.toString();
        }

        private void parseXml(String xml) {
            if (xml == null || xml.isEmpty()) return;
            try {
                DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
                try {
                    f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                } catch (Throwable ignored) {
                    /* 老实现不支持该 feature，忽略 */
                }
                try {
                    f.setFeature("http://xml.org/sax/features/external-general-entities", false);
                } catch (Throwable ignored) {
                    /* ignore */
                }
                try {
                    f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
                } catch (Throwable ignored) {
                    /* ignore */
                }
                DocumentBuilder b = f.newDocumentBuilder();
                Document doc = b.parse(new org.xml.sax.InputSource(new StringReader(xml)));
                NodeList nodes = doc.getElementsByTagName("*");
                for (int i = 0; i < nodes.getLength(); i++) {
                    Node n = nodes.item(i);
                    if (!(n instanceof Element)) continue;
                    Element el = (Element) n;
                    String tag = el.getTagName();
                    if (!el.hasAttribute("name")) continue;
                    String key = el.getAttribute("name");
                    if (key == null || key.isEmpty()) continue;
                    if ("string".equals(tag)) {
                        data.put(key, text(el));
                    } else if ("set".equals(tag)) {
                        java.util.LinkedHashSet<String> set = new java.util.LinkedHashSet<String>();
                        NodeList kids = el.getElementsByTagName("string");
                        for (int j = 0; j < kids.getLength(); j++) set.add(text((Element) kids.item(j)));
                        data.put(key, set);
                    } else if ("int".equals(tag)) {
                        Integer v = num(el.getAttribute("value"));
                        if (v != null) {
                            try {
                                data.put(key, Integer.valueOf(v.intValue()));
                            } catch (Throwable ignored) {
                                data.put(key, v);
                            }
                        }
                    } else if ("long".equals(tag)) {
                        Integer v = num(el.getAttribute("value"));
                        if (v != null) data.put(key, Long.valueOf(v.longValue()));
                    } else if ("float".equals(tag)) {
                        try {
                            data.put(key, Float.valueOf(Float.parseFloat(el.getAttribute("value"))));
                        } catch (Throwable ignored) {
                            /* ignore */
                        }
                    } else if ("boolean".equals(tag)) {
                        data.put(key, Boolean.valueOf(el.getAttribute("value")));
                    }
                }
            } catch (Throwable t) {
                /* XML 解析失败：保留已解析到的部分，绝不抛出 */
            }
        }

        private static Integer num(String s) {
            try {
                return Integer.valueOf(Integer.parseInt(String.valueOf(s).trim()));
            } catch (Throwable t) {
                return null;
            }
        }

        private static String text(Element el) {
            try {
                return el.getTextContent() == null ? "" : el.getTextContent();
            } catch (Throwable t) {
                return "";
            }
        }

        private static String readAll(File f) {
            FileInputStream in = null;
            try {
                in = new FileInputStream(f);
                byte[] buf = new byte[(int) Math.min(f.length(), 8 * 1024 * 1024L)];
                int off = 0;
                while (off < buf.length) {
                    int r = in.read(buf, off, buf.length - off);
                    if (r < 0) break;
                    off += r;
                }
                return new String(buf, 0, off, StandardCharsets.UTF_8);
            } catch (Throwable t) {
                return "";
            } finally {
                if (in != null) {
                    try {
                        in.close();
                    } catch (Throwable ignored) {
                        /* ignore */
                    }
                }
            }
        }

        private static String esc(String s) {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.length() + 16);
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    // 实体一律用 unicode 转义写前导 & —— 源文件里直写 &xxx; 会被工具链当成
                    // 真实体吃掉，导致转义失效（写出的 XML 解析不了）。
                    case '&': sb.append("\u0026amp;"); break;
                    case '<': sb.append("\u0026lt;"); break;
                    case '>': sb.append("\u0026gt;"); break;
                    case '"': sb.append("\u0026quot;"); break;
                    case '\'': sb.append("\u0026apos;"); break;
                    default: sb.append(c);
                }
            }
            return sb.toString();
        }
    }
}
