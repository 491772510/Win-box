// 重建随包 JRE（resources/jvm/jre）—— 蜘蛛 JVM 的运行时，**不进 git**（.gitignore 已排除）。
//
// ---------------------------------------------------------------------------
// 为什么需要这个脚本（★ 2026-10-13 踩坑记录，别删）
// ---------------------------------------------------------------------------
// 随包 JRE 早先是用 jlink 手工生成的，仓库里没有构建脚本，模块清单只存在于
// 产物自己 `release` 文件的 MODULES 变量里。结果**漏了 `jdk.charsets`**：
//
//   java.base 只带标准字符集（UTF-8 / ISO-8859-1 / US-ASCII / UTF-16 …），
//   **GB2312 / GBK / GB18030 / Big5 这类扩展字符集在 `jdk.charsets` 模块里**。
//
// 缺了它的真机症状（很容易被误判成「源坏了」）：
//   jvm-bridge com.github.catvod.spider.Nmvod.homeContent 失败原因:
//     蜘蛛静态初始化失败（内部依赖在桌面版缺失，请反馈此源）
//     ｜原始: java.lang.ExceptionInInitializerError
//             → java.nio.charset.UnsupportedCharsetException: gb2312
//   即：蜘蛛在 **静态初始化** 阶段 `Charset.forName("gb2312")` 就炸了，
//   → 整个类初始化失败 → 该源任何方法（home/搜索/详情）全部不可用。
//   国内站点用 GBK/GB2312 的很多（柠檬、天天…），影响面是一整批源。
//
// 实测对照（同一台机）：
//   随包 JRE(缺 jdk.charsets)：gb2312 ✗  big5 ✗   （gbk / gb18030 侥幸可用）
//   系统 JDK 17：               gb2312 ✓  big5 ✓
//
// ---------------------------------------------------------------------------
// ⚠⚠ 血统红线：**必须用 Zulu 17.0.13 的 jmods，不要用 Oracle 17.0.14+**
// ---------------------------------------------------------------------------
// 这不是迷信，是 2026-10-13 用一整轮对照实验换来的结论。用 Oracle 17.0.14 重建的
// JRE 字符集确实齐全了，但引入**更严重的回归**：
//
//   java.security.NoSuchProviderException: JCE cannot authenticate the provider
//   AndroidKeyStore
//   Caused by: java.security.SecurityException: Cannot verify jar:file:/…/classes/!/
//
// 机理：17.0.14 起 JCE 会校验 provider 的 jar 签名；而我们桌面的 AndroidKeyStore
// （android.security.keystore.DesktopKeyStoreProvider）是 classpath 上的普通 class，
// 不在签名 jar 里 → 注册即失败 → **所有用到 AndroidKeyStore 的源全部失效**。
//
// 已验证的死路（别再试一遍）：
//   · 给 provider jar 自签名        → `not signed by a trusted signer`（JCE 要信任链，
//                                      自签证书不在 JRE 的 cacerts 里，过不了）
//   · 运行时 `--module-path` 补模块  → `Hash of jdk.charsets … differs to expected hash
//                                      recorded in java.base`：jlink 会把它链接进来的
//                                      模块哈希写死在 java.base 里，只能在 jlink 阶段加
//   · `--patch-module java.base`    → 无法给已存在的模块追加 `provides` 声明，
//                                      SPI 依旧发现不到
//   · classpath 上的 `META-INF/services/java.nio.spi.CharsetProvider` → 无效：
//                                      JDK 不会从 classpath 加载 java.base 的核心 SPI
//                                      （同样的写法对自定义 SPI 有效，对 CharsetProvider 无效）
//
// 所以：**字符集只能在 jlink 阶段补齐，且 JRE 血统必须保持 Zulu 17.0.13**。
// 脚本末尾的 `verifyJce()` 就是在守这条红线 —— 换了血统它会立刻报出来。
//
// ---------------------------------------------------------------------------
// 用法
// ---------------------------------------------------------------------------
//   node scripts/build-jre.mjs                       # 自动找 JDK 17，构建到 resources/jvm/jre
//   node scripts/build-jre.mjs --jdk "C:/Program Files/Java/jdk-17"
//   node scripts/build-jre.mjs --out /tmp/jre-test   # 先构建到别处验证，不动正式目录
//   node scripts/build-jre.mjs --check               # 只校验现有 JRE 的字符集，不重建
//
// 要求：**JDK**（不是 JRE）—— jlink 与 jmods 只在 JDK 里。
// 大版本必须是 17：`stubs.jar` 与 JRE 的 class 文件版本都是 61（Java 17），
// 换成别的版本会出现 `class file has wrong version`。

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOut = join(root, 'resources', 'jvm', 'jre');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const checkOnly = argv.includes('--check');
const jdk = arg('--jdk');
const out = resolve(arg('--out') || defaultOut);

// ---------------------------------------------------------------------------
// 模块清单：原 JRE 的模块 + jdk.charsets（★ 本次修复的关键一行）
// ---------------------------------------------------------------------------
// 说明：`java.se` 是聚合模块，jlink 会把它 require 的模块一并解析进来，
// 但它**不含** jdk.charsets（后者不在 java.se 的传递依赖里），必须显式列出。
const MODULES = [
  'java.base', 'java.compiler', 'java.datatransfer', 'java.xml', 'java.prefs',
  'java.desktop', 'java.instrument', 'java.logging', 'java.management',
  'java.security.sasl', 'java.naming', 'java.rmi', 'java.management.rmi',
  'java.net.http', 'java.scripting', 'java.security.jgss', 'java.transaction.xa',
  'java.sql', 'java.sql.rowset', 'java.xml.crypto', 'java.se',
  'jdk.charsets', // ★ 扩展字符集：GB2312 / GBK / GB18030 / Big5 / IBM 系列
  'jdk.localedata', // ★ 区域数据：缺了它 Locale 只剩 5 个（带上它 1017 个），
  //     中文日期/月份会退化成 `2026 Oct 13, Tue`。源若按中文日期解析会直接失败。
  //     ⚠ 体积（2026-10-15 实测，别再照抄旧注释里那句「+22MB / +2MB」）：JRE 46MB → 96MB。
  //     试过 `--include-locales=zh,en` 只降到 76MB（省 20MB），代价是 locale 从 1017 掉到 124、
  //     并且会让下面 verifyCharsets() 的 MIN_LOCALES 守卫失去意义 —— 不值得，故**不裁剪**。
  //     哪天真要压包体：在这里加 --include-locales，并同步下调 MIN_LOCALES（两者必须一起改）。
  'jdk.crypto.ec', 'jdk.crypto.cryptoki', 'jdk.unsupported', 'jdk.zipfs',
];

// 蜘蛛会用到、缺了就会让源整体崩掉的字符集（不含 java.base 自带的标准集）
const REQUIRED_CHARSETS = ['gb2312', 'gbk', 'gb18030', 'big5'];

// 缺 jdk.localedata 时 Locale 只剩 5 个，中文日期会退化成英文 —— 一并盯住。
const MIN_LOCALES = 500;

// ★ JCE 血统护栏：注册桌面的 AndroidKeyStore provider 并真的取一次 KeyGenerator。
//   Oracle 17.0.14+ 会在这里挂掉（详见文件头的「血统红线」注释）。
const JCE_PROBE = `
import java.security.Security;
import javax.crypto.KeyGenerator;
public class WinboxJceProbe {
    public static void main(String[] a) throws Exception {
        Security.addProvider(new android.security.keystore.DesktopKeyStoreProvider());
        KeyGenerator kg = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        if (kg == null) { System.out.println("JCE-FAIL null"); Runtime.getRuntime().halt(1); }
        System.out.println("JCE-OK " + kg.getAlgorithm() + "/" + kg.getProvider().getName());
        Runtime.getRuntime().halt(0);
    }
}
`;

/** 用目标 JRE 跑一次 AndroidKeyStore 注册，挡住「换了 JRE 血统」这类回归。 */
function verifyJce(javaHome) {
  const tools = pickJdk();
  if (!tools || !tools.javac) {
    console.warn('⚠ 没有 javac，跳过 JCE 校验');
    return true;
  }
  const stubSrc = join(root, 'resources', 'jvm', 'stubs-src', 'android', 'security', 'keystore', 'DesktopKeyStoreProvider.java');
  const stubsJar = join(root, 'resources', 'jvm', 'stubs', 'stubs.jar');
  if (!existsSync(stubSrc) || !existsSync(stubsJar)) {
    console.warn('⚠ 缺少 DesktopKeyStoreProvider 源码或 stubs.jar，跳过 JCE 校验');
    return true;
  }
  const tmp = join(root, '.jre-jceprobe');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'WinboxJceProbe.java'), JCE_PROBE, 'utf8');
  const c = spawnSync(tools.javac, ['-encoding', 'UTF-8', '-cp', stubsJar, '-d', tmp,
    join(tmp, 'WinboxJceProbe.java'), stubSrc], { encoding: 'utf8' });
  if (c.status !== 0) {
    console.warn(`⚠ JCE 探针编译失败，跳过校验：${(c.stderr || '').slice(0, 200)}`);
    rmSync(tmp, { recursive: true, force: true });
    return true;
  }
  // ⚠ classpath 分隔符必须走 path.delimiter（win `;` / mac·linux `:`）。
  //   这里曾硬编码 `;` —— 在 mac 上 `-cp "a;b"` 会被当成**一个**路径 → ClassNotFoundException
  //   → 探针打不出 JCE-OK → verifyJce() 误判「血统红线」并 exit 1，等于把 mac 用户彻底
  //   挡在「重建 JRE」之外（明明血统没问题）。注意 delimiter 是**字符串常量**、不是函数。
  const r = spawnSync(join(javaHome, 'bin', exe('java')), ['-cp', [tmp, stubsJar].join(delimiter), 'WinboxJceProbe'], { encoding: 'utf8' });
  const txt = `${r.stdout}${r.stderr}`;
  rmSync(tmp, { recursive: true, force: true });
  if (!txt.includes('JCE-OK')) {
    console.error('✗ JCE provider 校验失败（血统红线）');
    console.error('  桌面 AndroidKeyStore 桩是 classpath 上的未签名类；JRE 若是 Oracle 17.0.14+，');
    console.error('  JCE 会拒绝它 → 所有用到 AndroidKeyStore 的源全部失效。');
    console.error(`  详情：${(txt || '').slice(0, 600)}`);
    return false;
  }
  console.log(`✓ JCE provider 可用：${txt.match(/JCE-OK .*/)[0].replace('JCE-OK ', '')}`);
  return true;
}

// ---------------------------------------------------------------------------
// 找 JDK 17
// ---------------------------------------------------------------------------
function isWin() { return process.platform === 'win32'; }
const exe = (n) => (isWin() ? `${n}.exe` : n);

/**
 * 兼容两种 JRE 布局，返回可直接传给探针的 Java home：
 *   · `<dir>/bin/java`                  —— jlink 直出（本脚本的产物）
 *   · `<dir>/Contents/Home/bin/java`    —— macOS 上「拖一个 JDK/JRE bundle 进来」的形态
 * 两种都不在则返回 null。产品侧 `JarSpiderBridge.javaExeCandidates()` 认同样的两种布局。
 */
function javaHomeOf(dir) {
  if (existsSync(join(dir, 'bin', exe('java')))) return dir;
  const macHome = join(dir, 'Contents', 'Home');
  if (existsSync(join(macHome, 'bin', exe('java')))) return macHome;
  return null;
}

function candidates() {
  const list = [];
  if (jdk) list.push(jdk);
  for (const e of ['JAVA_HOME', 'JDK17_HOME']) {
    if (process.env[e]) list.push(process.env[e]);
  }
  // 常见安装位置（Windows）
  if (isWin()) {
    for (const base of ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Zulu']) {
      try {
        for (const d of readdirSync(base)) {
          if (/^jdk-?17/.test(d) || /^zulu17/.test(d)) list.push(join(base, d));
        }
      } catch { /* 目录不存在 */ }
    }
  }
  return list;
}

function pickJdk() {
  for (const c of candidates()) {
    if (!c || !existsSync(c)) continue;
    const jlink = join(c, 'bin', exe('jlink'));
    const jmods = join(c, 'jmods');
    const javac = join(c, 'bin', exe('javac'));
    if (!existsSync(jlink) || !existsSync(jmods)) continue; // 要 JDK，光有 JRE 不行
    const v = spawnSync(join(c, 'bin', exe('java')), ['-version'], { encoding: 'utf8' });
    const txt = `${v.stdout}${v.stderr}`;
    const m = txt.match(/version "(\d+)\./);
    const major = m ? Number(m[1]) : 0;
    if (major !== 17) {
      console.warn(`⚠ 跳过 ${c}：大版本 ${major || '未知'}，需要 17（stubs.jar 的 class 版本是 61）`);
      continue;
    }
    return { home: c, jlink, jmods, javac: existsSync(javac) ? javac : null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 字符集校验：生成一段小程序，用目标 JRE 跑一遍
// ---------------------------------------------------------------------------
const PROBE = `
import java.nio.charset.Charset;
import java.util.Locale;
public class WinboxCharsetProbe {
    public static void main(String[] a) {
        int bad = 0;
        for (String n : a) {
            try { Charset.forName(n); System.out.println("OK " + n); }
            catch (Throwable t) { System.out.println("MISSING " + n); bad++; }
        }
        System.out.println("LOCALES " + Locale.getAvailableLocales().length);
        Runtime.getRuntime().halt(bad == 0 ? 0 : 1);
    }
}
`;

function verifyCharsets(javaHome) {
  const tmp = join(root, '.jre-probe');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'WinboxCharsetProbe.java'), PROBE, 'utf8');

  const tools = pickJdk(); // 用它自带的 javac 编译（目标 JRE 是 jlink 产物，可能没有 javac）
  if (!tools || !tools.javac) {
    console.error('✗ 找不到可用的 javac（需要与 JRE 同大版本 17 的 JDK 来编译探针）');
    rmSync(tmp, { recursive: true, force: true });
    return false;
  }
  const c = spawnSync(tools.javac, ['-encoding', 'UTF-8', '-d', tmp, join(tmp, 'WinboxCharsetProbe.java')], { encoding: 'utf8' });
  if (c.status !== 0) {
    console.error(`✗ 探针编译失败：${c.stderr || c.stdout}`);
    rmSync(tmp, { recursive: true, force: true });
    return false;
  }
  const r = spawnSync(join(javaHome, 'bin', exe('java')), ['-cp', tmp, 'WinboxCharsetProbe', ...REQUIRED_CHARSETS], { encoding: 'utf8' });
  const txt = `${r.stdout}`;
  const missing = txt.split('\n').filter((l) => l.startsWith('MISSING')).map((l) => l.split(' ')[1]);
  rmSync(tmp, { recursive: true, force: true });

  if (missing.length) {
    console.error(`✗ 目标 JRE 缺少字符集：${missing.join(', ')}`);
    console.error('  → 这些字符集在 `jdk.charsets` 模块里，确认它已列入 MODULES');
    return false;
  }
  const nm = txt.match(/LOCALES (\d+)/);
  const n = nm ? Number(nm[1]) : 0;
  if (n < MIN_LOCALES) {
    console.error(`✗ 目标 JRE 只有 ${n} 个 Locale（期望 ≥ ${MIN_LOCALES}）`);
    console.error('  → 中文日期/月份会退化成英文，缺的是 `jdk.localedata` 模块');
    return false;
  }
  console.log(`✓ 字符集齐全：${REQUIRED_CHARSETS.join(', ')}`);
  console.log(`✓ Locale 数量：${n}`);
  return true;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
if (checkOnly) {
  const home = javaHomeOf(out);
  if (!home) {
    console.error(`✗ ${out} 里没有 java（找过 bin/java 与 Contents/Home/bin/java），先跑一次构建`);
    process.exit(1);
  }
  console.log(`检查现有 JRE：${home}`);
  // 两个校验都要跑（别用 && 短路）：一次把「字符集 / 区域数据」与「JCE 血统」两条线都报出来
  const okCharsets = verifyCharsets(home);
  const okJce = verifyJce(home);
  process.exit(okCharsets && okJce ? 0 : 1);
}

const tools = pickJdk();
if (!tools) {
  console.error('✗ 找不到 JDK 17（需要 jlink + jmods，JRE 不行）。');
  console.error('  可显式指定：node scripts/build-jre.mjs --jdk "C:/Program Files/Java/jdk-17"');
  process.exit(1);
}
console.log(`使用 JDK：${tools.home}`);

// ★ 2026-10-15：先建到旁边的临时目录，**校验全部通过后才替换正式目录**。
//   旧实现是「先 rmSync(out) 再 jlink」—— 一旦血统不对（verifyJce 拦下并 exit 1），
//   原来那份能用的 JRE 已经被删掉了，只能再弄一份 JDK 才能恢复（mac 上尤其疼）。
//   用 `out.building` 同目录兄弟目录，保证 rename 是同卷操作（跨卷 rename 会失败）。
const staging = `${out}.building`;
if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });

console.log(`生成到（临时）：${staging}`);
console.log(`模块（${MODULES.length} 个，含 jdk.charsets）`);
const r = spawnSync(
  tools.jlink,
  [
    '--module-path', tools.jmods,
    '--add-modules', MODULES.join(','),
    '--output', staging,
    '--strip-debug', '--no-header-files', '--no-man-pages',
  ],
  { encoding: 'utf8' },
);
if (r.status !== 0) {
  console.error(`✗ jlink 失败：\n${r.stderr || r.stdout}`);
  process.exit(1);
}

// 校验跑在**临时产物**上；两个都要跑，一次把两条线都报出来
const home = javaHomeOf(staging);
const okCharsets = home ? verifyCharsets(home) : false;
const okJce = home ? verifyJce(home) : false;
if (!okCharsets || !okJce) {
  rmSync(staging, { recursive: true, force: true });
  console.error('✗ 血统校验未通过 —— 已丢弃临时产物，**正式目录原样保留**：');
  console.error(`    保留的正式目录：${existsSync(out) ? out : '（原本就没有，这次没建成）'}`);
  if (!okCharsets) console.error('  → 扩展字符集 / 区域数据缺失：换用 Zulu 17.0.13 的 JDK（见 docs/jvm-notes.md 的血统红线）');
  if (!okJce) console.error('  → JCE 拒注册 provider：JDK 血统不对（17.0.14+ 会校验 provider 的 jar 签名）');
  process.exit(1);
}

// 校验通过 → 原子替换：先把旧的挪到 `.old`，再落新的；中途失败就回滚
if (existsSync(out)) {
  const backup = `${out}.old`;
  rmSync(backup, { recursive: true, force: true });
  renameSync(out, backup);
  try {
    renameSync(staging, out);
    rmSync(backup, { recursive: true, force: true });
  } catch (e) {
    renameSync(backup, out);
    console.error(`✗ 替换 ${out} 失败，已回滚到原目录：${e.message}`);
    console.error('  （多半是文件被占用：先关掉正在跑的 Win-Box / JVM 子进程再重试）');
    process.exit(1);
  }
  console.log(`已替换旧产物：${out}`);
} else {
  renameSync(staging, out);
}
console.log(`✓ 完成：${out}\n  （该目录被 .gitignore 排除，不会进仓库；打包时由 electron-builder 带走）`);
