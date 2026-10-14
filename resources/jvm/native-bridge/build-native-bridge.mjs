// 重建原生桥 `native-bridge.jar`（ARM .so 桥的 **JVM 侧**实现）—— 跨平台版。
//
// ---------------------------------------------------------------------------
// 为什么需要这个脚本（★ 2026-10-14，macOS 适配缺口）
// ---------------------------------------------------------------------------
// 同一件事原先只有 `build.ps1`（**PowerShell，Windows 专用**）。后果是一条完整的断链：
//
//   ① macOS 上跑不了 build.ps1 → 建不出 jar；
//   ② `native-bridge.jar` 又被 .gitignore 排除（`resources/jvm/**/*.jar`）→
//      **从零 clone 的 mac 仓库里根本没有这只 jar**；
//   ③ `JarSpiderBridge.nativeNeeded()` 第一件事就是 `existsSync(native-bridge.jar)`，
//      见不到就整条原生桥不启用（连 unidbg 运行时不下载、日志一个字节都不打）；
//   ④ 于是 jar 内含 `.so` 的加固壳源（摸鱼/fty/嗷呜…）**只能**照原样加载 →
//      `UnsatisfiedLinkError` → 用户看到那句「该源依赖安卓原生库（.so），桌面版无法加载
//      （架构限制，非移植缺陷）」。
//
// 而真相是：**桥本身与平台无关**。
//   · `NativeBridge.available()` 只做 `Class.forName("…AndroidEmulatorBuilder")`（classpath 判定）；
//   · 模拟器 = unidbg 的纯 Java 代码（`AndroidEmulatorBuilder` + `AndroidResolver(23)`，
//     Android 系统库**内置在 unidbg-android jar 里**，不需要另找 rootfs）；
//   · 唯一需要原生码的是 unidbg 的**后端**（dynarmic / unicorn）与 capstone/keystone/JNA，
//     而它们发布的 jar **本身就带 macOS 二进制**：
//       unicorn-1.0.15.jar      → natives/osx_64|osx_arm64/libunicorn_java.dylib
//       unidbg-unicorn2-0.9.9   → natives/osx_64|osx_arm64/libunicorn.dylib
//       unidbg-dynarmic-0.9.9   → natives/osx_64|osx_arm64/libdynarmic.dylib
//       capstone / keystone     → darwin/libcapstone.dylib、darwin/libkeystone.dylib
//       jna-5.10.0.jar          → darwin-x86-64|darwin-aarch64/libjnidispatch.jnilib
//
// 所以本脚本存在的意义 = **把「只有 Windows 能建」这件事修掉**，让 Windows / macOS / Linux
// 都能用同一条命令产出同一只 jar（纯 Java 字节码，产物跨平台通用）。
//
// ---------------------------------------------------------------------------
// ⚠ class 文件版本必须是 61（Java 17）
// ---------------------------------------------------------------------------
// `native-bridge.jar` 由随包 JRE 加载（Windows 上是 jlink 出来的 **Zulu 17.0.13**）。
// 用 JDK 21 直接编译会产出 class 65 → Windows 侧 `UnsupportedClassVersionError`。
// 因此本脚本固定传 `--release 17` 钉死 61，并在打包前**实测校验**产物版本。
//
// ---------------------------------------------------------------------------
// 用法
// ---------------------------------------------------------------------------
//   node resources/jvm/native-bridge/build-native-bridge.mjs
//     # 自动找 JDK、自动找 unidbg 运行时 jar；产出 resources/jvm/native-bridge/native-bridge.jar
//
//   node resources/jvm/native-bridge/build-native-bridge.mjs --jdk "/opt/homebrew/opt/openjdk@17"
//   node resources/jvm/native-bridge/build-native-bridge.mjs --lib "~/Library/Application Support/Win-Box/winbox-cache/native/unidbg-0.9.9"
//   node resources/jvm/native-bridge/build-native-bridge.mjs --out /tmp/nb.jar   # 先试建到别处，不动正式产物
//
// 要求：**JDK**（不是 JRE）—— javac 与 jar 只在 JDK 里。
//   macOS: `brew install openjdk@17`（或任何 ≥17 的 JDK）
//   Windows: 见 scripts/build-jre.mjs 的候选目录（C:/Program Files/{Java,Eclipse Adoptium,Zulu}）
//
// 关于 unidbg 运行时 jar（`--lib` 未指定时的自动查找）：
//   它们**不入库**，由应用首次运行时按需下载到
//     Windows: %APPDATA%\win-box\winbox-cache\native\unidbg-0.9.9
//     macOS  : ~/Library/Application Support/Win-Box/winbox-cache/native/unidbg-0.9.9
//   所以在一台干净机器上的正确顺序是：**先跑一次应用并导入任意含 .so 的源**
//   （会触发运行时下载），再执行本脚本；或直接把上面那个目录从别的机器拷过来。

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = resolve(dirname(fileURLToPath(import.meta.url)));
const root = resolve(here, '..', '..', '..');
const SRC_DIR = join(here, 'com');
const DEFAULT_OUT = join(here, 'native-bridge.jar');

/** 应用运行期下载 unidbg 运行时的版本目录名（与 JarSpiderBridge.NATIVE_VER 保持一致） */
const NATIVE_VER = 'unidbg-0.9.9';
/** 产出 class 版本：61 = Java 17（随包 JRE 是 Zulu 17.0.13，必须对齐） */
const REQUIRED_CLASS_MAJOR = 61;

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const isWin = platform() === 'win32';
const exe = (n) => (isWin ? `${n}.exe` : n);
const expand = (p) => (p && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

const jdkArg = expand(arg('--jdk'));
const libArg = expand(arg('--lib'));
const asmArg = expand(arg('--asm'));
const out = resolve(expand(arg('--out')) || DEFAULT_OUT);

function die(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(hint);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) 找 JDK —— ★ 显式指定的目录必须真的有效，**绝不静默回退**
// ---------------------------------------------------------------------------
// 教训出处：scripts/build-jre.mjs 的“血统红线”。那里 `--jdk` 指向不存在的目录会静默回退到
// 自动查找，而自动查到的恰好是会被 JCE 拒掉的版本 —— 用户以为自己在用指定 JDK，其实没有。
// 这里沿用同样的口径：给了 `--jdk` 就必须存在且含 javac，否则直接失败。
function jdkCandidates() {
  const list = [];
  if (jdkArg) list.push(jdkArg);
  for (const e of ['JAVA_HOME', 'JDK17_HOME']) if (process.env[e]) list.push(process.env[e]);

  if (isWin) {
    for (const base of ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Zulu',
      'C:/Program Files/Microsoft', 'C:/Program Files/Amazon Corretto']) {
      try {
        for (const d of readdirSync(base)) if (/^(jdk-?1[789]|jdk-?2\d|zulu1[789]|zulu2\d)/i.test(d)) list.push(join(base, d));
      } catch { /* 目录不存在 */ }
    }
  } else {
    // macOS：/Library/Java/JavaVirtualMachines/<vendor>/Contents/Home + Homebrew 前缀
    for (const base of ['/Library/Java/JavaVirtualMachines', '/System/Volumes/Data/Library/Java/JavaVirtualMachines']) {
      try {
        for (const d of readdirSync(base)) {
          const home = join(base, d, 'Contents', 'Home');
          if (/jdk|openjdk|temurin|zulu|corretto/i.test(d)) list.push(home);
        }
      } catch { /* 目录不存在 */ }
    }
    for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
      try {
        for (const d of readdirSync(base)) if (/^openjdk/.test(d)) list.push(join(base, d, 'libexec', 'openjdk.jdk', 'Contents', 'Home'), join(base, d));
      } catch { /* 目录不存在 */ }
    }
    for (const p of ['/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
      '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home']) list.push(p);
  }
  // 兜底：PATH 上的 javac（`which javac` 得到的 …/bin/javac → 回到 home）
  const which = spawnSync(isWin ? 'where' : 'which', ['javac'], { encoding: 'utf8' });
  const first = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (first) list.push(resolve(dirname(first), '..'));
  return list;
}

function pickJdk() {
  const tried = [];
  for (const c of jdkCandidates()) {
    if (!c) continue;
    const javac = join(c, 'bin', exe('javac'));
    const jar = join(c, 'bin', exe('jar'));
    if (!existsSync(javac) || !existsSync(jar)) {
      // 只有用户显式指定的那个才值得提示；自动候选里混着 JRE 是正常的
      if (jdkArg && resolve(c) === resolve(jdkArg)) {
        die(`--jdk 指定的目录不是可用的 JDK（缺 bin/${exe('javac')}）: ${c}`,
          '  注意必须是 **JDK**，不是 JRE —— javac / jar 只在 JDK 里。');
      }
      tried.push(c);
      continue;
    }
    const v = spawnSync(join(c, 'bin', exe('java')), ['-version'], { encoding: 'utf8' });
    const txt = `${v.stdout}${v.stderr}`;
    const m = txt.match(/version "(\d+)(?:\.(\d+))?/);
    const major = m ? Number(m[1]) : 0;
    if (major && major < 17) {
      console.warn(`⚠ 跳过 ${c}：大版本 ${major} < 17（--release 17 不可用）`);
      continue;
    }
    return { home: c, javac, jar, major, version: txt.trim().split(/\r?\n/)[0] };
  }
  die('没找到可用的 JDK（需要 ≥17，且含 bin/javac）。',
    [
      '  指定一个：',
      '    Windows: --jdk "C:/Program Files/Java/jdk-17"',
      '    macOS  : --jdk "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"',
      '  安装：',
      '    macOS : brew install openjdk@17',
      '    Windows: https://adoptium.net/temurin/releases/?version=17 （选 JDK，不是 JRE）',
      tried.length ? `  （已看过但不含 javac：${tried.join(', ')}）` : '',
    ].filter(Boolean).join('\n'));
}

// ---------------------------------------------------------------------------
// 2) 找 unidbg 运行时 jar（编译期 classpath：unidbg-* / unicorn / capstone / keystone / jna）
// ---------------------------------------------------------------------------
function cacheCandidates() {
  const appDirs = [];
  if (isWin) {
    for (const base of [process.env.APPDATA, join(homedir(), 'AppData', 'Roaming')]) {
      if (base) for (const n of ['win-box', 'Win-Box']) appDirs.push(join(base, n));
    }
  } else if (platform() === 'darwin') {
    for (const n of ['Win-Box', 'win-box']) appDirs.push(join(homedir(), 'Library', 'Application Support', n));
  } else {
    for (const n of ['Win-Box', 'win-box']) appDirs.push(join(homedir(), '.config', n));
  }
  // 打包版数据目录可能被搬到「安装目录/data」（见主进程 migrateLegacy），也顺手看一眼
  return appDirs.flatMap((d) => [
    join(d, 'winbox-cache', 'native', NATIVE_VER),
    join(d, 'cache', 'native', NATIVE_VER),
    d,
  ]);
}

function pickLibDir() {
  if (libArg) {
    if (!existsSync(libArg)) die(`--lib 指定的目录不存在: ${libArg}`);
    return libArg;
  }
  for (const c of cacheCandidates()) {
    try {
      if (!existsSync(c)) continue;
      if (readdirSync(c).some((f) => /^unidbg-android-.*\.jar$/.test(f))) return c;
    } catch { /* 忽略不可读目录 */ }
  }
  die('没找到 unidbg 运行时 jar（unidbg-android-*.jar）。', [
    '  它们不入库，由应用按需下载，常见位置：',
    `    Windows: %APPDATA%\\win-box\\winbox-cache\\native\\${NATIVE_VER}`,
    `    macOS  : ~/Library/Application Support/Win-Box/winbox-cache/native/${NATIVE_VER}`,
    '  二选一即可：',
    '    ① 先启动一次应用并导入任意含 .so 的加固壳源（会自动下载运行时），再重跑本脚本；',
    `    ② 用 --lib 指向任意含 unidbg-android-*.jar 的目录。`,
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 3) 收集源码与 classpath
// ---------------------------------------------------------------------------
function walkJava(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJava(p));
    else if (e.name.endsWith('.java')) out.push(p);
  }
  return out;
}

function classMajorOf(file) {
  const b = readFileSync(file);
  return (b[6] << 8) | b[7];
}

// ---------------------------------------------------------------------------
function main() {
  const jdk = pickJdk();
  if (jdk.major !== 17) {
    console.warn(`⚠ 构建用 JDK 是 ${jdk.major}（非 17）—— 已用 --release 17 钉死 class 版本，产物仍为 61。`);
  }

  const libDir = pickLibDir();
  const libJars = readdirSync(libDir).filter((f) => f.endsWith('.jar')).map((f) => join(libDir, f));
  if (!libJars.some((p) => /unidbg-android-.*\.jar$/.test(basename(p)))) {
    die(`--lib 目录里没有 unidbg-android-*.jar: ${libDir}`);
  }
  // asm 优先用显式参数；否则在 lib 目录里找（应用下载的运行时清单里就带 asm-9.7.jar），
  // 最后回退到仓库 tools/（历史上这里是缺的，build.ps1 的默认 -Asm 因此必然报错，别指望它）。
  const asm = asmArg
    || libJars.find((p) => /^asm-.*\.jar$/.test(basename(p)))
    || [join(here, '..', 'tools', 'asm-9.7.jar')].find((p) => existsSync(p));
  if (!asm) {
    die('找不到 asm jar（NativePatcher 用它改写字节码）。',
      '  用 --asm <path> 指定；应用下载的 unidbg 运行时目录里通常带 asm-9.7.jar。');
  }

  if (!existsSync(SRC_DIR)) die(`源码目录不存在: ${SRC_DIR}`);
  const sources = walkJava(SRC_DIR);
  if (sources.length === 0) die(`源码目录下没有 .java: ${SRC_DIR}`);

  // 平台分隔符：Windows ';'，macOS/Linux ':' —— 写错会让整串被当成一个路径
  const cp = [...new Set([asm, ...libJars])].join(isWin ? ';' : ':');
  const tmpOut = join(here, '.build-classes');
  rmSync(tmpOut, { recursive: true, force: true });
  mkdirSync(tmpOut, { recursive: true });

  console.log(`JDK       : ${jdk.home}  (${jdk.version})`);
  console.log(`运行时 jar : ${libDir}  (${libJars.length} 个)`);
  console.log(`源码      : ${sources.length} 个 .java`);
  console.log(`输出      : ${out}`);

  const jc = spawnSync(jdk.javac, [
    '-encoding', 'UTF-8',
    '--release', '17',        // ★ 钉死 class 61：随包 JRE 是 17
    '-cp', cp,
    '-d', tmpOut,
    ...sources,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (jc.status !== 0) {
    rmSync(tmpOut, { recursive: true, force: true });
    die(`javac 失败（exit ${jc.status}）:\n${(jc.stderr || jc.stdout || '').trim()}`,
      '  若报 “--release 17 不可用”，说明 JDK 太老；若报找不到符号，检查 --lib 是否指向了完整的运行时目录。');
  }
  if (jc.stderr && jc.stderr.trim()) console.warn(jc.stderr.trim());

  // 产物 class 版本实测（防御：--release 万一被绕过，这里必须拦住）
  const probeClass = join(tmpOut, 'com', 'winbox', 'nativebridge', 'NativeBridgeMain.class');
  if (!existsSync(probeClass)) die(`编译产物缺少 NativeBridgeMain.class，构建目录: ${tmpOut}`);
  const major = classMajorOf(probeClass);
  if (major !== REQUIRED_CLASS_MAJOR) {
    rmSync(tmpOut, { recursive: true, force: true });
    die(`产物 class 版本 ${major} ≠ ${REQUIRED_CLASS_MAJOR}（Java 17）。`,
      '  class 版本过高会让随包 JRE（17）抛 UnsupportedClassVersionError；请用 JDK 17 构建。');
  }

  const outTmp = `${out}.tmp`;
  rmSync(outTmp, { force: true });
  const jr = spawnSync(jdk.jar, ['cf', outTmp, '-C', tmpOut, '.'], { encoding: 'utf8' });
  if (jr.status !== 0) {
    rmSync(tmpOut, { recursive: true, force: true });
    die(`jar 打包失败（exit ${jr.status}）:\n${(jr.stderr || jr.stdout || '').trim()}`);
  }
  // 原子替换：先写 .tmp 再改名，避免构建失败留下半只 jar 把打包链路带偏
  if (existsSync(out)) rmSync(out, { force: true });
  copyFileSync(outTmp, out);
  rmSync(outTmp, { force: true });
  rmSync(tmpOut, { recursive: true, force: true });

  console.log(`\n✓ 原生桥已构建: ${out}  (${statSync(out).size} B, class ${major})`);
  console.log('  提示：改了 com/**/*.java 之后必须重跑本脚本 —— 运行时加载的是这只 jar，不是源码。');
}

main();
