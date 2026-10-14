#!/usr/bin/env node
// =============================================================================
// export-jvm-assets.mjs —— 把「桌面端跑 jar 蜘蛛所需的私有运行时资产」打包 / 搬运 / 体检
// =============================================================================
//
// 为什么需要它
// -----------------------------------------------------------------------------
// `resources/jvm/` 下的运行期资产大部分**不入库**（`.gitignore` 明文排除），理由是它们
// 逆向自第三方 app、不接受开源分发：
//
//     stubs/            安卓桩 + Spider 基类 + SpiderRunner（宿主环境）
//     stubs/shell-shim.jar   影子 DexNative（加固壳的兜底入口）
//     libs/             okhttp / okio / gson / jsoup / sqlite-jdbc / bcprov …
//     d2j/              dex2jar 分发（把蜘蛛 jar 里的 classes.dex 转成 .class）
//     shell-shim/real/  加固壳的「真实实现」jar（按壳名命名，如 wexshinidie.jar）
//
// 后果：在另一台机器（典型场景是 Mac）上从 git clone 出来的仓库**缺这些资产**：
//   · 普通 jar 蜘蛛 —— 缺 libs → 类加载失败；
//   · 加固壳源（BiliGuard / 摸鱼 / fty / wex…）—— 缺 `shell-shim/real/<壳>.jar`
//     → 原生解密没产出加载器 → 守卫类字段为 null → `init()` 抛 NPE。
//     界面上那句「加固壳内部蜘蛛未就绪…已自动改用内置真实实现」里，
//     **后半句是无条件写死的**（见 JarSpiderBridge.translateSpiderLog），
//     真凶往往是「本机压根没有该壳的真实实现」，而不是源站坏了。
//
// 这个脚本把「搬运」变成一条命令，并在目标机器上给一份**可执行**的体检报告。
//
// 三种用法
// -----------------------------------------------------------------------------
//   node scripts/export-jvm-assets.mjs --export [输出目录]   # 源机器（Windows）打包
//   node scripts/export-jvm-assets.mjs --import <包>         # 目标机器（Mac）导入
//   node scripts/export-jvm-assets.mjs --doctor              # 目标机器体检（不写文件）
//   node scripts/export-jvm-assets.mjs --help
//
// `--import` 额外支持 `--dry-run`（只校验不落盘）与 `--force`（覆盖内容不同的已存在文件）。
// 默认输出目录 `.tmp/jvm-assets/`（`.tmp/` 已被 `.gitignore` 排除）。
//
// ⚠ 打出来的 `.tar.gz` 含第三方私有资产：**仅供作者本人在自己的机器之间搬运**。
//   不要提交进仓库、不要上传到任何公开位置。
//
// 实现说明：tar / gzip / zip 全部用 Node 标准库自己实现（无外部依赖、无需 `tar` 命令），
//   这样 Windows 与 macOS 行为完全一致 —— 尤其避开 Git Bash 的 GNU tar 把 `C:` 写进
//   归档路径、以及 bsdtar / GNU tar 对权限位处理不一致这两类坑。
// =============================================================================

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JVM_DIR = join(ROOT, 'resources', 'jvm');
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 取某个选项后面的值（下一项不是 `--` 开头才算值） */
function optValue(name) {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

// ---------------------------------------------------------------------------
// tar（ustar）读写 —— 只支持普通文件，够用且可预测
// ---------------------------------------------------------------------------
function tarOctal(n, len) {
  const s = n.toString(8);
  if (s.length > len - 1) throw new Error(`tar 字段溢出：${n} 放不进 ${len} 字节`);
  return s.padStart(len - 1, '0') + '\0';
}

function tarHeader(name, size, mtime, typeflag) {
  const buf = Buffer.alloc(512);
  let pathName = name;
  let prefix = '';
  if (Buffer.byteLength(pathName) > 100) {
    // ustar 的 prefix + name 拆分（从第 100 字节处往前找分隔符）
    const cut = pathName.lastIndexOf('/', 100);
    if (cut < 0) throw new Error(`tar 路径过长且无法拆分：${name}`);
    prefix = pathName.slice(0, cut);
    pathName = pathName.slice(cut + 1);
    if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(pathName) > 100) {
      throw new Error(`tar 路径过长：${name}`);
    }
  }
  buf.write(pathName, 0, 100, 'utf8');
  buf.write(tarOctal(0o644, 8), 100, 8, 'ascii');
  buf.write(tarOctal(0, 8), 108, 8, 'ascii');
  buf.write(tarOctal(0, 8), 116, 8, 'ascii');
  buf.write(tarOctal(size, 12), 124, 12, 'ascii');
  buf.write(tarOctal(mtime, 12), 136, 12, 'ascii');
  buf.write('        ', 148, 8, 'ascii'); // 校验和先占位 8 空格
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  buf.write('root', 265, 32, 'ascii');
  buf.write('root', 297, 32, 'ascii');
  if (prefix) buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return buf;
}

function tarAppend(out, name, data, mtime, typeflag = '0') {
  out.push(tarHeader(name, data.length, mtime, typeflag));
  out.push(data);
  const pad = (512 - (data.length % 512)) % 512;
  if (pad) out.push(Buffer.alloc(pad));
}

function tarPack(files) {
  const out = [];
  for (const f of files) tarAppend(out, f.name, f.data, f.mtime);
  out.push(Buffer.alloc(1024)); // 两个全零块 = 归档结束
  return Buffer.concat(out);
}

function tarUnpack(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    off += 512;
    let allZero = true;
    for (const b of h) if (b !== 0) { allZero = false; break; }
    if (allZero) break;
    let name = h.toString('utf8', 0, 100).replace(/\0[\s\S]*$/, '');
    const prefix = h.toString('utf8', 345, 500).replace(/\0[\s\S]*$/, '');
    if (prefix) name = `${prefix}/${name}`;
    const sizeStr = h.toString('ascii', 124, 136).replace(/\0[\s\S]*$/, '').trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const type = h.toString('ascii', 156, 157);
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g' || type === 'L') continue; // PAX / GNU 扩展头：忽略
    if (type === '5') continue; // 目录项：忽略（按文件路径建目录即可）
    if (type === '0' || type === '\0' || type === '') out.push({ name, data });
  }
  return out;
}

// ---------------------------------------------------------------------------
// zip 只读解析 —— 用于校验 jar 是不是有效 zip、列出条目、读 class 版本
// ---------------------------------------------------------------------------
function zipRead(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip（找不到 EOCD 尾记录）');
  const total = buf.readUInt16LE(eocd + 10);
  if (total === 0xffff) throw new Error('zip64 归档暂不支持');
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, csize, usize, lho });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    names: entries.map((e) => e.name),
    read(name) {
      const e = byName.get(name);
      if (!e) return null;
      if (buf.readUInt32LE(e.lho) !== 0x04034b50) throw new Error(`zip 本地头损坏：${name}`);
      const nameLen = buf.readUInt16LE(e.lho + 26);
      const extraLen = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRawSync(raw);
      throw new Error(`不支持的压缩方式 ${e.method}：${name}`);
    },
  };
}

/** class 文件的主版本号（第 7~8 字节；class 61 = Java 17） */
function classMajor(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0xcafebabe) return null;
  return buf.readUInt16BE(6);
}

/**
 * 校验一个 jar：是不是有效 zip + 条目数 + 若干个「必须存在的类」+ class 版本。
 * @returns {{ ok: boolean, reason?: string, count: number, classVer: number|null, missing: string[] }}
 */
function inspectJar(absPath, mustHave = []) {
  let buf;
  try {
    buf = readFileSync(absPath);
  } catch (e) {
    return { ok: false, reason: `读不到：${e.message}`, count: 0, classVer: null, missing: mustHave };
  }
  let z;
  try {
    z = zipRead(buf);
  } catch (e) {
    return { ok: false, reason: e.message, count: 0, classVer: null, missing: mustHave };
  }
  const missing = mustHave.filter((n) => !z.names.includes(n));
  let classVer = null;
  for (const e of z.entries) {
    if (!e.name.endsWith('.class')) continue;
    try { classVer = classMajor(z.read(e.name)); } catch { /* 单个类坏了先不算致命 */ }
    if (classVer !== null) break;
  }
  if (missing.length) return { ok: false, reason: `缺少类：${missing.join(', ')}`, count: z.entries.length, classVer, missing };
  return { ok: true, count: z.entries.length, classVer, missing };
}

// ---------------------------------------------------------------------------
// 资产清单定义（单一来源：导出、导入校验、体检都读这里）
// ---------------------------------------------------------------------------
/** 随包搬运的目录（相对 resources/jvm），rel 用正斜杠以便跨平台一致 */
const BUNDLE_DIRS = [
  { rel: 'stubs', name: '安卓桩 + SpiderRunner', files: /^(stubs|shell-shim)\.jar$/ },
  { rel: 'libs', name: '宿主依赖（okhttp/gson/jsoup/sqlite…）', files: /\.jar$/ },
  { rel: 'd2j', name: 'dex2jar 分发', files: /\.jar$/ },
  { rel: 'shell-shim/real', name: '加固壳的真实实现（按壳名命名）', files: /\.jar$/ },
];

/** 单个必需文件 + 必须含有的类（体检用） */
const REQUIRED_FILES = [
  {
    rel: 'stubs/stubs.jar',
    label: '安卓桩 + SpiderRunner',
    mustHave: ['SpiderRunner.class', 'com/github/catvod/crawler/Spider.class'],
    why: '没有它，任何 jar 蜘蛛都起不来',
  },
  {
    rel: 'stubs/shell-shim.jar',
    label: '影子 DexNative（加固壳兜底入口）',
    mustHave: ['com/github/catvod/spider/DexNative.class'],
    why: '没有它，加固壳源连兜底都进不去',
  },
];

/** libs 里按「前缀」认定必需的依赖（不钉版本号，避免升级即误报） */
const REQUIRED_LIBS = [
  [/^okhttp-\d/, 'okhttp'],
  [/^okio-\d/, 'okio'],
  [/^gson-\d/, 'gson'],
  [/^jsoup-\d/, 'jsoup'],
  [/^json-\d/, 'org.json'],
  [/^bcprov-/, 'bcprov（国密/加解密）'],
  [/^sqlite-jdbc-/, 'sqlite-jdbc'],
  [/^slf4j-api-/, 'slf4j-api'],
  [/^slf4j-simple-/, 'slf4j-simple'],
  [/^python-runner\.jar$/, 'python-runner（.py 蜘蛛宿主）'],
];

/** d2j 里按前缀认定必需的（缺了就转不了 dex） */
const REQUIRED_D2J = [
  [/^dex-tools-.*\.jar$/, 'dex-tools（d2j-dex2jar 入口）'],
  [/^dex-translator-.*\.jar$/, 'dex-translator'],
  [/^asm-.*\.jar$/, 'asm'],
];

/** 明确「不随包搬运」的东西 —— 体检时逐条给出原因与修法 */
function notBundled() {
  const appCache = IS_WIN
    ? join(process.env.APPDATA ?? '~/AppData/Roaming', 'win-box', 'winbox-cache')
    : join(process.env.HOME ?? '~', 'Library', 'Application Support', 'Win-Box', 'winbox-cache');
  const jdkCmd = IS_WIN
    ? 'node scripts/build-jre.mjs --jdk "C:/Program Files/Java/jdk-17"'
    : 'node scripts/build-jre.mjs --jdk "$(/usr/libexec/java_home -v 17)"';
  return [
    {
      label: 'resources/jvm/jre',
      fatal: true,
      why: '**平台相关**：jlink 产物只能在本平台生成（Windows 的 java.exe 在 mac 上跑不了），所以不进包',
      fix: `${jdkCmd}\n      ⚠ 血统红线：必须用 **Zulu 17.0.13** 的 JDK；17.0.14+ 会让 JCE 拒绝注册 provider\n        → 所有用 AndroidKeyStore 的源全灭（机理与已试过的死路见 docs/jvm-notes.md）`,
    },
    {
      label: 'resources/jvm/native-bridge/native-bridge.jar',
      fatal: true,
      why: '已随源码**入库**（git 里有），不需要搬运；含 .so 的壳源没有它就只能报「架构限制」',
      fix: 'git checkout -- resources/jvm/native-bridge/native-bridge.jar  （或 pnpm build:native-bridge 重建）',
    },
    {
      label: 'resources/jvm/okhttp4-compat/winbox-okhttp4-compat.jar',
      fatal: false,
      why: '**构建产物**：由 scripts/build-main.mjs 现场生成，不入库（跑过 build/dev/dist 就会自动出现）',
      fix: 'pnpm build:main',
    },
    {
      label: 'resources/jvm/python-runner/base（.py 蜘蛛脚本）',
      fatal: false,
      why: '已在 git 里（python-runner/ 未忽略），不需要搬运',
      fix: 'git checkout -- resources/jvm/python-runner',
    },
    {
      label: join(appCache, 'native', 'unidbg-0.9.9'),
      fatal: false,
      why: '**运行时按需下载**（18 个包 ≈ 39MB，jar 内含各平台原生库，跨平台可用）',
      fix: '首次调用含 .so 的壳源时自动从 maven 镜像下载；也可先启动应用导入一次壳源预热',
    },
  ];
}

// ---------------------------------------------------------------------------
// 收集要打包的文件
// ---------------------------------------------------------------------------
function collect() {
  const files = [];
  for (const g of BUNDLE_DIRS) {
    const dir = join(JVM_DIR, ...g.rel.split('/'));
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!g.files.test(f)) continue;
      const abs = join(dir, f);
      if (!statSync(abs).isFile()) continue;
      files.push({ rel: `resources/jvm/${g.rel}/${f}`, abs, group: g.rel });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// 模式：--export
// ---------------------------------------------------------------------------
function doExport(outDirArg) {
  const files = collect();
  if (files.length === 0) {
    die(`没有可导出的资产（${JVM_DIR} 里什么都没找到）。\n`
      + '  这台机器上是不是从来没跑过 dev / 没放过私有资产？');
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const gitRev = (() => {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : 'unknown';
  })();
  const gitDirty = (() => {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim().length > 0 : false;
  })();

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outDir = resolve(outDirArg ?? join(ROOT, '.tmp', 'jvm-assets'));
  mkdirSync(outDir, { recursive: true });

  // ---- 逐条读入 + 计算哈希
  const entries = [];
  const tarFiles = [];
  let totalRaw = 0;
  for (const f of files) {
    const data = readFileSync(f.abs);
    totalRaw += data.length;
    entries.push({
      path: f.rel,
      size: data.length,
      sha256: sha256(data),
      group: f.group,
    });
    tarFiles.push({ name: f.rel, data, mtime: Math.floor(statSync(f.abs).mtimeMs / 1000) });
  }

  const manifest = {
    schema: 1,
    generator: 'scripts/export-jvm-assets.mjs',
    generatedAt: new Date().toISOString(),
    app: { name: pkg.name, version: pkg.version },
    source: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      gitRev,
      gitDirty,
    },
    note: '本包含**第三方私有资产**（逆向自第三方 app），仅供作者本人机器间搬运；'
      + '不得提交进仓库、不得公开分发。',
    contains: BUNDLE_DIRS.map((g) => ({
      dir: `resources/jvm/${g.rel}`,
      what: g.name,
      count: entries.filter((e) => e.group === g.rel).length,
    })),
    entries,
    notIncluded: notBundled().map((n) => ({ path: n.label.split('（')[0], why: n.why, fix: n.fix })),
  };

  const readme = [
    'Win-Box —— 桌面端 jar 蜘蛛的私有运行时资产',
    '================================================',
    '',
    `打包机器：${process.platform} ${process.arch}    Node ${process.version}`,
    `应用版本：${pkg.name} ${pkg.version}`,
    `源码版本：${gitRev}${gitDirty ? '（工作区有未提交改动）' : ''}`,
    `打包时间：${manifest.generatedAt}`,
    '',
    '⚠ 本包含第三方私有资产（逆向自第三方 app），仅供作者本人机器间搬运。',
    '  不要提交进 git 仓库，不要上传到任何公开位置。',
    '',
    '怎么用（在目标机器的仓库根目录执行）',
    '-------------------------------------------------',
    '  node scripts/export-jvm-assets.mjs --import <本包路径>',
    '',
    '它会先逐个校验 sha256，再落到 resources/jvm/ 下，最后自动跑一次体检。',
    '只想校验不想写文件：加 --dry-run。',
    '',
    '本包**不包含**（需要在那台机器上自己准备）',
    '-------------------------------------------------',
    ...notBundled().map((n) => `  · ${n.label}\n      ${n.why.replace(/\*\*/g, '')}`),
    '',
    '体检（随时可跑，不写文件）',
    '-------------------------------------------------',
    '  node scripts/export-jvm-assets.mjs --doctor',
    '',
    '详见 docs/macos-build.md。',
    '',
  ].join('\n');

  tarFiles.push({
    name: 'manifest.json',
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mtime: Math.floor(Date.now() / 1000),
  });
  tarFiles.push({
    name: 'README.txt',
    data: Buffer.from(readme, 'utf8'),
    mtime: Math.floor(Date.now() / 1000),
  });

  const tgz = gzipSync(tarPack(tarFiles), { level: 6 });
  const baseName = `winbox-jvm-assets-${pkg.version}-${stamp}.tar.gz`;
  const tgzPath = join(outDir, baseName);
  writeFileSync(tgzPath, tgz);
  const outer = sha256(tgz);
  writeFileSync(`${tgzPath}.sha256`, `${outer}  ${baseName}\n`);

  // ---- 汇报
  console.log(`\n=== Win-Box JVM 私有资产导出 ===\n`);
  console.log(`源机器：${process.platform} ${process.arch}   版本：${pkg.version}   源码：${gitRev}${gitDirty ? '（有未提交改动）' : ''}\n`);
  console.log('【打包内容】');
  for (const g of BUNDLE_DIRS) {
    const list = entries.filter((e) => e.group === g.rel);
    if (!list.length) continue;
    const bytes = list.reduce((a, e) => a + e.size, 0);
    console.log(`  resources/jvm/${g.rel.padEnd(16)} ${String(list.length).padStart(3)} 个  ${fmtSize(bytes).padStart(9)}  ${g.name}`);
    if (g.rel === 'stubs' || g.rel === 'shell-shim/real') {
      for (const e of list) console.log(`        · ${e.path.split('/').pop()}  (${fmtSize(e.size)})`);
    }
  }
  console.log(`\n  原始合计 ${fmtSize(totalRaw)} → 压缩包 ${fmtSize(tgz.length)}`);

  console.log('\n【本包不含（目标机器自备）】');
  for (const n of notBundled()) {
    console.log(`  · ${n.label}${n.fatal ? '  ← 缺了会致命' : ''}`);
  }

  console.log('\n【产物】');
  console.log(`  ${tgzPath}`);
  console.log(`  ${tgzPath}.sha256`);
  console.log(`  sha256 = ${outer}`);
  console.log('\n【下一步】把上面那个 .tar.gz 传到目标机器，然后在该机器的仓库根目录执行：');
  console.log(`  node scripts/export-jvm-assets.mjs --import "${baseName}"`);
  console.log('\n⚠ 这是私有资产包：不要提交进仓库，不要上传到公开位置。\n');
}

// ---------------------------------------------------------------------------
// 读取一个「包」（目录 或 .tar.gz）
// ---------------------------------------------------------------------------
function loadBundle(bundleArg) {
  if (!bundleArg) die('--import 需要一个包路径（.tar.gz 或解压后的目录）');
  const p = resolve(bundleArg);
  if (!existsSync(p)) {
    die(`找不到：${p}\n`
      + '  提示：如果包在别处，请给完整路径；也可以先把 .tar.gz 解压再指定目录。');
  }
  const st = statSync(p);
  if (st.isDirectory()) {
    const files = new Map();
    const walk = (dir, rel) => {
      for (const f of readdirSync(dir)) {
        const abs = join(dir, f);
        const r = rel ? `${rel}/${f}` : f;
        if (statSync(abs).isDirectory()) walk(abs, r);
        else files.set(r, readFileSync(abs));
      }
    };
    walk(p, '');
    return { files, label: p };
  }
  const raw = readFileSync(p);
  const buf = p.endsWith('.gz') || p.endsWith('.tgz') ? gunzipSync(raw) : raw;
  const files = new Map();
  for (const f of tarUnpack(buf)) files.set(f.name, Buffer.from(f.data));
  return { files, label: p };
}

// ---------------------------------------------------------------------------
// 模式：--import
// ---------------------------------------------------------------------------
function doImport(bundleArg, { dryRun, force }) {
  let loaded;
  try {
    loaded = loadBundle(bundleArg);
  } catch (e) {
    die(`包读不出来：${e.message}\n`
      + '  传输中断 / 网盘自动二次压缩 / 下载不完整都可能造成 —— 重新传一次，别用这个文件。');
  }
  const { files, label } = loaded;
  console.log(`\n=== Win-Box JVM 私有资产导入 ===\n`);
  console.log(`包：${label}`);
  console.log(`方式：${dryRun ? '只校验（--dry-run，不写文件）' : '校验后落盘'}\n`);

  const mRaw = files.get('manifest.json');
  if (!mRaw) {
    die('这个包里没有 manifest.json —— 不是本脚本导出的资产包。\n'
      + '  如果你只是想在目标机器上「体检」，请直接跑：node scripts/export-jvm-assets.mjs --doctor');
  }
  let manifest;
  try {
    manifest = JSON.parse(mRaw.toString('utf8'));
  } catch (e) {
    die(`manifest.json 解析失败：${e.message}`);
  }
  if (manifest.schema !== 1) die(`manifest schema 不认识：${manifest.schema}（本脚本支持 1）`);

  console.log(`来源：${manifest.source.platform} ${manifest.source.arch}   版本：${manifest.app.version}   源码：${manifest.source.gitRev}${manifest.source.gitDirty ? '（导出时有未提交改动）' : ''}`);
  console.log(`打包时间：${manifest.generatedAt}\n`);

  // ---- 逐条校验哈希
  let badHash = 0;
  let missing = 0;
  const planned = [];
  for (const e of manifest.entries) {
    const data = files.get(e.path);
    if (!data) {
      console.log(`  ✗ 包内缺少 ${e.path}`);
      missing++;
      continue;
    }
    const h = sha256(data);
    if (h !== e.sha256 || data.length !== e.size) {
      console.log(`  ✗ 哈希不符 ${e.path}`);
      console.log(`      期望 ${e.sha256} (${e.size} B)`);
      console.log(`      实际 ${h} (${data.length} B)`);
      badHash++;
      continue;
    }
    planned.push({ rel: e.path, data, size: e.size, sha256: e.sha256 });
  }
  if (missing || badHash) {
    die(`包已损坏：${missing} 个缺失、${badHash} 个哈希不符。`
      + '\n  重新传一次（传输中断/网盘二次压缩都可能造成），不要用这个包落盘。');
  }
  console.log(`  ✓ 全部 ${planned.length} 个文件 sha256 校验通过\n`);

  // ---- 冲突检测
  const conflicts = [];
  const same = [];
  for (const p of planned) {
    const abs = join(ROOT, ...p.rel.split('/'));
    if (!existsSync(abs)) continue;
    const cur = readFileSync(abs);
    if (sha256(cur) === p.sha256) same.push(p.rel);
    else conflicts.push({ rel: p.rel, size: cur.length, sha256: sha256(cur) });
  }

  if (same.length) console.log(`  已是最新（内容一致，跳过）：${same.length} 个`);
  if (conflicts.length) {
    console.log(`\n  ⚠ 有 ${conflicts.length} 个文件本机已存在且**内容不同**：`);
    for (const c of conflicts) console.log(`      ${c.rel}  本机 ${fmtSize(c.size)}  ${c.sha256.slice(0, 12)}…`);
    if (!force) {
      die('拒绝覆盖（避免悄悄替换掉本机正在用的资产）。\n'
        + '  · 想保留本机版本 → 什么都不用做，或先用 --dry-run 看看差异；\n'
        + '  · 确认要用包里的版本覆盖 → 加 --force 再跑一次。');
    }
    console.log('  → 已指定 --force，将覆盖。');
  }

  const toWrite = planned.filter((p) => !same.includes(p.rel));
  if (dryRun) {
    console.log(`\n  [dry-run] 将要写入 ${toWrite.length} 个文件到 ${JVM_DIR}，未实际写盘。\n`);
    return;
  }

  let n = 0;
  for (const p of toWrite) {
    const abs = join(ROOT, ...p.rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, p.data);
    n++;
  }
  console.log(`\n  ✓ 已写入 ${n} 个文件到 resources/jvm/\n`);

  // ---- 顺手跑一次体检
  console.log('='.repeat(72));
  doctor();
}

// ---------------------------------------------------------------------------
// 模式：--doctor
// ---------------------------------------------------------------------------
function findJava() {
  const cands = [
    join(JVM_DIR, 'jre', 'bin', 'java'),
    join(JVM_DIR, 'jre', 'bin', 'java.exe'),
    join(JVM_DIR, 'jre', 'Contents', 'Home', 'bin', 'java'),
    join(JVM_DIR, 'jre', 'Contents', 'Home', 'bin', 'java.exe'),
  ];
  return cands.find((c) => existsSync(c)) ?? null;
}

function which(bin) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const first = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

function doctor() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  console.log(`\n=== Win-Box JVM 资产体检 ===\n`);
  console.log(`仓库：${ROOT}`);
  console.log(`平台：${process.platform} ${process.arch}    Node ${process.version}    版本 ${pkg.version}\n`);

  const problems = []; // { fatal, text, fix }

  // ------------------------------------------------------------------ [1]
  console.log('[1] 搬运包覆盖的资产（缺了 → 用 --export/--import 从主开发机搬）');
  for (const f of REQUIRED_FILES) {
    const abs = join(JVM_DIR, ...f.rel.split('/'));
    if (!existsSync(abs)) {
      console.log(`  ✗ ${f.rel.padEnd(26)} 缺失`);
      console.log(`      ${f.why}`);
      problems.push({ fatal: true, text: f.rel, fix: '从主开发机导出资产包后 --import' });
      continue;
    }
    const size = statSync(abs).size;
    const r = inspectJar(abs, f.mustHave);
    if (!r.ok) {
      console.log(`  ✗ ${f.rel.padEnd(26)} ${fmtSize(size).padStart(9)}  ${r.reason}`);
      problems.push({ fatal: true, text: `${f.rel}（${r.reason}）`, fix: '从主开发机导出资产包后 --import' });
      continue;
    }
    const cv = r.classVer === null ? '未知' : String(r.classVer);
    const cvMark = r.classVer === 61 ? '✓' : '⚠';
    console.log(`  ✓ ${f.rel.padEnd(26)} ${fmtSize(size).padStart(9)}  ${r.count} 条目  class ${cv}${cvMark}  ${f.label}`);
    if (r.classVer !== null && r.classVer !== 61) {
      problems.push({
        fatal: true,
        text: `${f.rel} class 版本 ${r.classVer}（应为 61）`,
        fix: '这只 jar 是用非 JDK 17 构建的，运行时会 UnsupportedClassVersionError；重新搬运',
      });
    }
  }

  // libs
  {
    const dir = join(JVM_DIR, 'libs');
    const jars = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jar')).sort() : [];
    const bytes = jars.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
    const lack = REQUIRED_LIBS.filter(([re]) => !jars.some((f) => re.test(f)));
    if (!jars.length) {
      console.log(`  ✗ ${'libs'.padEnd(26)} 目录缺失或没有 jar`);
      problems.push({ fatal: true, text: 'libs/', fix: '从主开发机导出资产包后 --import' });
    } else if (lack.length) {
      console.log(`  ✗ ${'libs/'.padEnd(26)} ${fmtSize(bytes).padStart(9)}  ${jars.length} 个 jar，缺 ${lack.length} 个必需依赖`);
      for (const [, label] of lack) console.log(`      ✗ 缺 ${label}`);
      problems.push({ fatal: true, text: `libs/ 缺 ${lack.map((x) => x[1]).join(', ')}`, fix: '从主开发机导出资产包后 --import' });
    } else {
      console.log(`  ✓ ${'libs/'.padEnd(26)} ${fmtSize(bytes).padStart(9)}  ${jars.length} 个 jar（必需 ${REQUIRED_LIBS.length}/${REQUIRED_LIBS.length} 齐）`);
    }
  }

  // d2j
  {
    const dir = join(JVM_DIR, 'd2j');
    const jars = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jar')).sort() : [];
    const bytes = jars.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
    const lack = REQUIRED_D2J.filter(([re]) => !jars.some((f) => re.test(f)));
    if (!jars.length) {
      console.log(`  ✗ ${'d2j'.padEnd(26)} 目录缺失或没有 jar`);
      problems.push({ fatal: true, text: 'd2j/', fix: '从主开发机导出资产包后 --import' });
    } else if (lack.length) {
      console.log(`  ✗ ${'d2j/'.padEnd(26)} ${fmtSize(bytes).padStart(9)}  ${jars.length} 个 jar，缺 ${lack.length} 个必需项`);
      for (const [, label] of lack) console.log(`      ✗ 缺 ${label}`);
      problems.push({ fatal: true, text: `d2j/ 缺 ${lack.map((x) => x[1]).join(', ')}`, fix: '从主开发机导出资产包后 --import' });
    } else {
      console.log(`  ✓ ${'d2j/'.padEnd(26)} ${fmtSize(bytes).padStart(9)}  ${jars.length} 个 jar（dex2jar 齐）`);
    }
  }

  // shell-shim/real
  {
    const dir = join(JVM_DIR, 'shell-shim', 'real');
    const jars = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jar')).sort() : [];
    const names = jars.map((f) => f.replace(/\.jar$/, ''));
    if (!jars.length) {
      console.log(`  ✗ ${'shell-shim/real/'.padEnd(26)} 目录缺失或没有 jar`);
      console.log('      没有它，加固壳源（BiliGuard / 摸鱼 / fty / wex…）只会走原生解密，');
      console.log('      拿不到加载器就报「加固壳内部蜘蛛未就绪」，普通 jar 源不受影响。');
      problems.push({ fatal: false, text: 'shell-shim/real/ 为空', fix: '从主开发机导出资产包后 --import' });
    } else {
      const bytes = jars.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
      console.log(`  ✓ ${'shell-shim/real/'.padEnd(26)} ${fmtSize(bytes).padStart(9)}  ${jars.length} 个：${names.join(', ')}`);
      for (const f of jars) {
        const r = inspectJar(join(dir, f), []);
        if (!r.ok) {
          console.log(`      ✗ ${f}：${r.reason}`);
          problems.push({ fatal: false, text: `shell-shim/real/${f} 损坏`, fix: '重新搬运' });
        }
      }
    }
  }

  // ------------------------------------------------------------------ [2]
  console.log('\n[2] 平台自备 / 生成物（本包不含，必须在目标机器上准备）');
  const java = findJava();
  if (!java) {
    console.log('  ✗ resources/jvm/jre/ 里没有 java —— **所有 jar 蜘蛛都不可用**');
    problems.push({
      fatal: true,
      text: 'jre 缺失',
      fix: 'node scripts/build-jre.mjs --jdk "$(/usr/libexec/java_home -v 17)"  （必须 Zulu 17.0.13）',
    });
  } else {
    const r = spawnSync(java, ['-version'], { encoding: 'utf8' });
    const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/);
    const ver = /version "([^"]+)"/.exec(lines[0] ?? '')?.[1] ?? '未知';
    const impl = /Runtime Environment (\S+)/.exec(lines[1] ?? '')?.[1] ?? '';
    const major = ver.split('.')[0];
    console.log(`  ${major === '17' ? '✓' : '⚠'} jre/  ${ver}${impl ? `  (${impl})` : ''}`);
    if (major !== '17') {
      problems.push({
        fatal: false,
        text: `jre 大版本 ${major}（项目对齐 17 / class 61）`,
        fix: '用 Zulu 17.0.13 重建：node scripts/build-jre.mjs --jdk "$(/usr/libexec/java_home -v 17)"',
      });
    }
    if (ver !== '17.0.13') {
      console.log('      ⚠ 血统红线：建议 **Zulu 17.0.13**。');
      console.log('        17.0.14+ 会让 JCE 拒绝注册 provider → 所有用 AndroidKeyStore 的源全灭。');
      console.log('        跑一次 `node scripts/build-jre.mjs --check` 可以实测字符集与 JCE。');
    } else {
      console.log('      ✓ 血统符合（17.0.13）');
    }

    // ★ 模块体检：jlink 裁剪出来的 JRE，其 release 里有 MODULES=…；
    //   完整的 JDK/JRE 没有这个键（说明模块齐全，不必再查）。
    const rel = join(dirname(dirname(java)), 'release');
    let mods = null;
    if (existsSync(rel)) {
      const m = /(?:^|\n)MODULES="([^"]*)"/.exec(readFileSync(rel, 'utf8'));
      if (m) mods = m[1].trim().split(/\s+/);
    }
    if (mods === null) {
      console.log('      模块：整套（release 里没有 MODULES 键 → 不是 jlink 裁剪产物），字符集/区域数据齐全');
    } else {
      const lack = ['jdk.charsets', 'jdk.localedata'].filter((x) => !mods.includes(x));
      if (lack.length) {
        console.log(`      ✗ 模块缺失：${lack.join(', ')}（jlink 裁剪产物里没有它，共 ${mods.length} 个模块）`);
        if (lack.includes('jdk.charsets')) {
          console.log('        → GB2312 / GBK / Big5 的站点（柠檬、天天…）会在**静态初始化**阶段抛');
          console.log('          UnsupportedCharsetException，整个源（首页/搜索/详情）全废。');
        }
        if (lack.includes('jdk.localedata')) {
          console.log('        → Locale 只剩 5 个，中文日期会退化成英文（按中文日期解析的源会失败）。');
        }
        problems.push({
          fatal: false,
          text: `jre 缺模块 ${lack.join(', ')}`,
          fix: '用 Zulu 17.0.13 重建：node scripts/build-jre.mjs（模块清单里已含这两个）；\n'
            + '        重建前可先跑 node scripts/build-jre.mjs --check 实测（它会真的 Charset.forName 一遍）',
        });
      } else {
        console.log(`      ✓ 模块：含 jdk.charsets + jdk.localedata（共 ${mods.length} 个模块）`);
      }
    }
  }

  for (const n of notBundled()) {
    if (n.label.startsWith('resources/jvm/jre')) continue; // 上面单独判过了
    if (n.label.startsWith('resources/jvm/native-bridge')) {
      const abs = join(JVM_DIR, 'native-bridge', 'native-bridge.jar');
      if (existsSync(abs)) {
        console.log(`  ✓ native-bridge/native-bridge.jar  ${fmtSize(statSync(abs).size)}`);
      } else {
        console.log('  ✗ native-bridge/native-bridge.jar 缺失 —— 含 .so 的壳源会报「依赖安卓原生库」');
        problems.push({ fatal: true, text: 'native-bridge.jar 缺失', fix: n.fix.split('\n')[0].trim() });
      }
      continue;
    }
    if (n.label.startsWith('resources/jvm/okhttp4-compat')) {
      const abs = join(JVM_DIR, 'okhttp4-compat', 'winbox-okhttp4-compat.jar');
      if (existsSync(abs)) {
        console.log(`  ✓ okhttp4-compat/winbox-okhttp4-compat.jar  ${fmtSize(statSync(abs).size)}`);
      } else {
        console.log('  · okhttp4-compat 未生成（按 okhttp4 参数序调 RequestBody.create 的源会 NoSuchMethodError）');
        console.log('      → pnpm build:main');
        problems.push({ fatal: false, text: 'okhttp4-compat 未生成', fix: 'pnpm build:main' });
      }
      continue;
    }
    if (n.label.startsWith('resources/jvm/python-runner')) {
      const abs = join(JVM_DIR, 'python-runner', 'base', 'spider.py');
      if (existsSync(abs)) {
        console.log('  ✓ python-runner/base/（.py 蜘蛛脚本，在 git 里）');
      } else {
        console.log('  ✗ python-runner/base/ 缺失（.py 蜘蛛不可用）');
        problems.push({ fatal: false, text: 'python-runner/base/ 缺失', fix: 'git checkout -- resources/jvm/python-runner' });
      }
      continue;
    }
    if (n.label.includes('unidbg')) {
      const abs = n.label;
      if (existsSync(abs)) {
        const jars = readdirSync(abs).filter((f) => f.endsWith('.jar'));
        const bytes = jars.reduce((a, f) => a + statSync(join(abs, f)).size, 0);
        console.log(`  ✓ unidbg 运行时 ${fmtSize(bytes)}（${jars.length} 个 jar）`);
      } else {
        console.log('  · unidbg 运行时尚未下载（首次用含 .so 的壳源时自动下载，约 39MB）');
      }
    }
  }

  // ------------------------------------------------------------------ [3]
  console.log('\n[3] 其他工具（仅供参考；口径见 docs/macos-build.md §2.1-2.2，不影响本脚本结论）');
  const extras = [
    ['mpv', IS_WIN ? 'mpv.exe' : 'mpv', ['resources/mpv']],
    ['ffmpeg', IS_WIN ? 'ffmpeg.exe' : 'ffmpeg', ['resources/ffmpeg']],
    ['ffprobe', IS_WIN ? 'ffprobe.exe' : 'ffprobe', ['resources/ffmpeg']],
    ['aria2c', IS_WIN ? 'aria2c.exe' : 'aria2c', ['resources/aria2']],
    ['python3', IS_WIN ? 'python.exe' : 'python3', []],
  ];
  for (const [name, bin, bundleDirs] of extras) {
    const bundled = bundleDirs
      .map((d) => join(ROOT, ...d.split('/'), bin))
      .find((p) => existsSync(p));
    const sys = which(bin);
    const mark = bundled || sys ? '✓' : '·';
    console.log(`  ${mark} ${name.padEnd(9)} bundled=${bundled ? '有' : '无'}   system=${sys ?? '无'}`);
  }

  // ------------------------------------------------------------------ 结论
  const fatal = problems.filter((p) => p.fatal);
  console.log(`\n${'='.repeat(72)}`);
  if (!problems.length) {
    console.log('结论：全部就绪 —— jar 蜘蛛（含加固壳源）在这台机器上应当可用。');
    console.log('      还没验证真机的话，导入一个含 .so 的壳源，看日志里有没有 `原生桥就绪`（docs/macos-build.md §10 V9）。\n');
    return;
  }
  if (!fatal.length) {
    console.log(`结论：核心可用，但有 ${problems.length} 项降级：\n`);
  } else {
    console.log(`结论：有 ${fatal.length} 项致命问题、${problems.length - fatal.length} 项降级：\n`);
  }
  let i = 1;
  for (const p of problems) {
    console.log(`  ${p.fatal ? '✗' : '⚠'} ${p.text}`);
    console.log(`      → ${p.fix}`);
    i++;
  }
  console.log('');
  process.exitCode = fatal.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
function usage() {
  console.log(`
Win-Box JVM 私有资产 打包 / 搬运 / 体检

用法：
  node scripts/export-jvm-assets.mjs --export [输出目录]
      在**主开发机**打包 resources/jvm 下的私有资产为单个 .tar.gz（含 manifest.json + sha256）。
      默认输出到 .tmp/jvm-assets/。

  node scripts/export-jvm-assets.mjs --import <包路径> [--dry-run] [--force]
      在**目标机器**校验包（逐个比 sha256）并落盘到 resources/jvm/，随后自动体检。
        --dry-run  只校验、只报告会写什么，不落盘
        --force    覆盖本机已存在且内容不同的同名文件（默认拒绝覆盖）

  node scripts/export-jvm-assets.mjs --doctor
      只体检：必需资产 / 平台自备项 / 其他工具，并给出每项的修复命令。退出码 1 = 有致命项。

  node scripts/export-jvm-assets.mjs --help
`);
}

if (argv.includes('--help') || argv.includes('-h')) {
  usage();
} else if (argv.includes('--doctor')) {
  doctor();
} else if (argv.includes('--import')) {
  const b = optValue('--import');
  if (!b) {
    console.error('\n✗ --import 后面要跟包路径，例如：--import winbox-jvm-assets-1.21.3-20261015T001500Z.tar.gz\n');
    process.exit(1);
  }
  doImport(b, {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  });
} else if (argv.includes('--export')) {
  doExport(optValue('--export'));
} else if (argv.length === 0) {
  doExport(undefined);
} else {
  console.error(`\n✗ 不认识的参数：${argv.join(' ')}`);
  usage();
  process.exit(1);
}
