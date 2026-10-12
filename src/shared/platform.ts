// src/shared/platform.ts
// ★★★ 平台事实的**唯一真源**（P0-1 / macOS 适配 2026-10-12）★★★
//
// 设计约定（全项目通用，见 docs/architecture-macos.md §9）：
//  1. 本文件**零依赖**：不 import electron、不 import `node:fs` / `node:path` / `node:os`。
//     只用全局 `process`（node 与 Electron 主进程均可用）+ 字符串模板拼路径。
//     → 因此 `src/main/**`、`src/engine/**`、`src/shared/update.ts` 都能直接 import 它。
//  2. **渲染层不得 import 本模块**（Vite 打包 `process.platform` 语义不可靠）：
//     渲染层一律走 IPC（`WB_APP_PLATFORM`）+ `src/renderer/lib/platform.ts` 缓存。
//  3. 所有含平台语义的函数，平台参数**一律可选、缺省 = 当前真实平台**
//     → Windows 上既有单测（缺省 win32）行为逐字节不变（零回归）。
//  4. 测试注入两条路：可选参数注入（推荐）+ 模块级 `setPlatformForTest` / `withPlatform`
//     （用于「平台不是显式参数」的调用点，如 `MpvController.status()`）。
//
// ★ 注入状态挂在 `globalThis` 上（而非模块局部变量）：这样 `vi.resetModules()` 之后
//   重新求值的本模块依然能读到覆盖值 —— `dataDirBootstrap` 这类「import 即执行」的
//   模块必须在动态 import 之前注入平台，否则覆盖会随模块重建而丢失。
// ============================================================
// ① 类型
// ============================================================

/** 归一后的平台名（只关心这三个；其余归到 'linux'） */
export type PlatformName = 'win32' | 'darwin' | 'linux';

/** 归一后的 CPU 架构 */
export type ArchName = 'arm64' | 'x64' | 'ia32' | 'unknown';

/** dmg/zip 资产名里用的架构标签；未知架构返回 ''（= 不挑架构） */
export type ArchTag = 'arm64' | 'x64' | '';

/** 归一化后的发布平台（用于 pickInstallerAsset，T04） */
export type InstallerPlatform = 'win32' | 'darwin';

/** 需要探测的外部依赖（本仓用到的全部） */
export type ToolId =
  | 'mpv'
  | 'ffmpeg'
  | 'ffprobe'
  | 'aria2c'
  | 'java'
  | 'python3'
  | 'vlc'
  | 'iina'
  | 'potplayer'
  | 'mpc-hc';

/** 探测结果契约（全项目统一；`path === ''` ⟺ `source === 'none'`） */
export interface ToolProbeResult {
  path: string;
  source: 'override' | 'bundled' | 'system' | 'none';
  /** 人话提示：`source !== 'none'` 时为来源描述；`none` 时为修复指引（darwin 必含 `brew install <x>`） */
  hint: string;
}

/** 本机探测上下文（全部可选，缺省取运行时真实值） */
export interface SystemProbeCtx {
  env?: Record<string, string | undefined>;
  home?: string;
  /** 直接给 PATH 拆分结果（省去解析 env） */
  pathDirs?: string[];
}

/** mpv JSON IPC 端点参数 */
export interface MpvIpcOptions {
  pid: number;
  seq: number;
  nonce?: string;
  /** darwin 的 unix socket 目录（缺省取系统临时目录） */
  tmpDir?: string;
}

// ============================================================
// ② 平台/架构判定（可被测试注入）
// ============================================================

/**
 * 注入态存储。
 *
 * ★★ 为什么同时写「模块变量 + `process.env`」：★★
 *   模块变量在 `vi.resetModules()` 后会随模块重建而丢失，但 `process.env` 是**同一个
 *   进程对象**、跨模块重建存活。像 `dataDirBootstrap` 这种「import 即执行」的模块，
 *   spec 必须在动态 import **之前**注入平台 —— 只靠模块变量会失效（已实测）。
 *   env 键名带 `WINBOX_TEST_` 前缀，生产环境不会被设置。
 */
const TEST_PLATFORM_ENV = 'WINBOX_TEST_PLATFORM';
const TEST_ARCH_ENV = 'WINBOX_TEST_ARCH';

let forcedPlatform: PlatformName | null = null;
let forcedArch: ArchName | null = null;

/**
 * 取 node 的 `process`（★ 用裸 `process` 而不是 `globalThis.process`：
 * vitest 的 vmThreads 下模块的 `globalThis` 与 spec 的不是同一个对象，
 * 但 `process` 是各上下文共享的同一个进程对象 —— 已实测）。
 */
function nodeProcess(): { platform?: string; arch?: string; env?: Record<string, string | undefined> } | undefined {
  return typeof process !== 'undefined' ? process : undefined;
}

function readEnv(key: string): string {
  try {
    return String(nodeProcess()?.env?.[key] || '');
  } catch {
    return '';
  }
}

function writeEnv(key: string, value: string | null): void {
  try {
    const env = nodeProcess()?.env;
    if (!env) return;
    if (value) env[key] = value;
    else delete env[key];
  } catch {
    /* env 不可写（极端沙箱）→ 退回纯模块变量 */
  }
}

/** 把 node 的 `process.platform` 归一到三态 */
function normalizePlatform(raw: string): PlatformName {
  if (raw === 'darwin') return 'darwin';
  if (raw === 'win32') return 'win32';
  return 'linux';
}

/** 把 node 的 `process.arch` 归一到四态 */
function normalizeArch(raw: string): ArchName {
  if (raw === 'arm64') return 'arm64';
  if (raw === 'x64') return 'x64';
  if (raw === 'ia32') return 'ia32';
  return 'unknown';
}

function realPlatform(): PlatformName {
  return normalizePlatform(String(nodeProcess()?.platform || ''));
}

function realArch(): ArchName {
  return normalizeArch(String(nodeProcess()?.arch || ''));
}

/** 当前平台（可被 `setPlatformForTest` / `withPlatform` 覆写） */
export function platformName(): PlatformName {
  const fromEnv = readEnv(TEST_PLATFORM_ENV);
  if (fromEnv) return normalizePlatform(fromEnv);
  if (forcedPlatform) return forcedPlatform;
  return realPlatform();
}

/** 当前架构（可被 `setArchForTest` / `withArch` 覆写） */
export function archName(): ArchName {
  const fromEnv = readEnv(TEST_ARCH_ENV);
  if (fromEnv) return normalizeArch(fromEnv);
  if (forcedArch) return forcedArch;
  return realArch();
}

/** 是否 Windows（缺省 = 当前平台） */
export function isWin(p: PlatformName = platformName()): boolean {
  return p === 'win32';
}

/** 是否 macOS（缺省 = 当前平台） */
export function isMac(p: PlatformName = platformName()): boolean {
  return p === 'darwin';
}

/** 是否 Linux（缺省 = 当前平台） */
export function isLinux(p: PlatformName = platformName()): boolean {
  return p === 'linux';
}

/** 发布资产里的架构标签：arm64 → 'arm64'，x64 → 'x64'，其余 → ''（= 不挑架构） */
export function archTag(a: ArchName = archName()): ArchTag {
  if (a === 'arm64') return 'arm64';
  if (a === 'x64') return 'x64';
  return '';
}

/** ★ 测试注入：传 null 恢复真实平台 */
export function setPlatformForTest(p: PlatformName | null): void {
  forcedPlatform = p ?? null;
  writeEnv(TEST_PLATFORM_ENV, p ? p : null);
}

/** ★ 测试注入：传 null 恢复真实架构 */
export function setArchForTest(a: ArchName | null): void {
  forcedArch = a ?? null;
  writeEnv(TEST_ARCH_ENV, a ? a : null);
}

/** 作用域内切换平台（finally 自动还原）；推荐 spec 用这个 */
export function withPlatform<T>(p: PlatformName, fn: () => T): T {
  const prevPlatform = forcedPlatform;
  const prevEnv = readEnv(TEST_PLATFORM_ENV);
  forcedPlatform = p;
  writeEnv(TEST_PLATFORM_ENV, p);
  try {
    return fn();
  } finally {
    forcedPlatform = prevPlatform;
    writeEnv(TEST_PLATFORM_ENV, prevEnv || null);
  }
}

/** 作用域内切换架构（finally 自动还原） */
export function withArch<T>(a: ArchName, fn: () => T): T {
  const prevArch = forcedArch;
  const prevEnv = readEnv(TEST_ARCH_ENV);
  forcedArch = a;
  writeEnv(TEST_ARCH_ENV, a);
  try {
    return fn();
  } finally {
    forcedArch = prevArch;
    writeEnv(TEST_ARCH_ENV, prevEnv || null);
  }
}

// ============================================================
// ③ 可执行文件名与分隔符
// ============================================================

const EXE_RE = /\.exe$/i;

/**
 * 可执行文件名：`'mpv'` → win32 `'mpv.exe'` / 其余 `'mpv'`。
 * 已带 `.exe` 后缀时：win32 原样返回；非 win32 **剥掉** `.exe`（macOS/Linux 上不存在该后缀）。
 */
export function exeName(base: string, p: PlatformName = platformName()): string {
  const b = String(base || '').trim();
  if (!b) return '';
  const hasExe = EXE_RE.test(b);
  if (isWin(p)) return hasExe ? b : `${b}.exe`;
  return hasExe ? b.slice(0, -4) : b;
}

/** JVM 可执行名：'java.exe' | 'java' */
export function javaExeName(p: PlatformName = platformName()): string {
  return exeName('java', p);
}

/** Python 可执行名：'python.exe' | 'python3'（★ macOS/Linux 没有 `python`，只有 `python3`） */
export function pythonExeName(p: PlatformName = platformName()): string {
  return isWin(p) ? 'python.exe' : 'python3';
}

/** classpath 分隔符：win32 `;` / 其余 `:`（★ Unix 必须用 `:`，否则 JVM 完全不认） */
export function classpathSep(p: PlatformName = platformName()): ';' | ':' {
  return isWin(p) ? ';' : ':';
}

/** 按平台拼 classpath（过滤空片段） */
export function joinClasspath(parts: string[], p: PlatformName = platformName()): string {
  const sep = classpathSep(p);
  return parts.filter((s) => !!s && !!String(s).trim()).join(sep);
}

/** PATH 环境变量分隔符：win32 `;` / 其余 `:` */
export function envPathSep(p: PlatformName = platformName()): ';' | ':' {
  return isWin(p) ? ';' : ':';
}

// ============================================================
// ④ 目录约定
// ============================================================

/** 用 `/` 拼接路径片段（本模块不 import node:path，只做字符串拼装） */
function posixJoin(...parts: string[]): string {
  return parts
    .filter((s) => !!s)
    .map((s, i) => (i === 0 ? String(s).replace(/\/+$/, '') : String(s).replace(/^\/+|\/+$/g, '')))
    .filter((s) => !!s)
    .join('/');
}

/** 去重（保持顺序） */
function uniq(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Homebrew 前缀 bin（Apple Silicon 优先）；非 darwin 返回 [] */
export function homebrewBinDirs(p: PlatformName = platformName()): string[] {
  if (!isMac(p)) return [];
  return ['/opt/homebrew/bin', '/usr/local/bin'];
}

/** 通用系统 bin 目录（darwin: homebrew + /usr/local/bin + /usr/bin；win32: []） */
export function systemBinDirs(p: PlatformName = platformName()): string[] {
  if (!isMac(p)) return [];
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
}

/** `.app` 安装根（darwin: `/Applications` + `~/Applications`；其余 []） */
export function appBundleRoots(home?: string, p: PlatformName = platformName()): string[] {
  if (!isMac(p)) return [];
  const roots = ['/Applications'];
  const h = (home || '').trim();
  if (h) roots.push(posixJoin(h, 'Applications'));
  return uniq(roots);
}

/**
 * `<root>/<App>.app/Contents/MacOS/<bin>`。
 * - `app` 已以 `.app` 结尾时原样使用，否则补 `.app`；
 * - `bin` 缺省时取 app 名（去 `.app`）。
 * - 非 darwin 返回 ''（`.app` 是 macOS 独有概念，调用方应在 darwin 分支内使用）。
 */
export function appBundleBinary(
  root: string,
  app: string,
  bin?: string,
  p: PlatformName = platformName(),
): string {
  if (!isMac(p) || !root || !app) return '';
  const appName = /\.app$/i.test(app) ? app : `${app}.app`;
  const binName = (bin || '').trim() || appName.replace(/\.app$/i, '');
  return posixJoin(root, appName, 'Contents', 'MacOS', binName);
}

/** PATH 拆分（按 `envPathSep`；空片段与重复项剔除） */
export function pathBinDirs(
  env: Record<string, string | undefined> = {},
  p: PlatformName = platformName(),
): string[] {
  const sep = envPathSep(p);
  // ★ Windows 上环境变量名大小写不敏感（Path / PATH 都可能出现）
  const raw = isWin(p)
    ? (env.PATH ?? env.Path ?? env.path ?? '')
    : (env.PATH ?? env.Path ?? '');
  return uniq(String(raw || '').split(sep).map((s) => s.trim()).filter(Boolean));
}

/** macOS 打包态 resources 根相对 exe（`exeDir` = `<App>/Contents/MacOS` → `../Resources`） */
export function packagedResourcesRel(p: PlatformName = platformName()): string[] {
  if (isWin(p)) return [];
  return ['..', 'Resources'];
}

// ============================================================
// ⑤ 子进程与 IPC
// ============================================================

/** spawn 隐藏窗口选项（win32 `windowsHide:true`；其余 false —— 传 false 亦无害） */
export function spawnOptions(p: PlatformName = platformName()): { windowsHide: boolean } {
  return { windowsHide: isWin(p) };
}

/** 系统临时目录（不 import node:os，按平台取环境变量，最后兜底 `/tmp`） */
function defaultTmpDir(): string {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  return (env.TMPDIR || env.TEMP || env.TMP || '/tmp').replace(/\/+$/, '') || '/tmp';
}

/**
 * mpv JSON IPC 端点：
 *   win32  → `\\.\pipe\winbox-mpv-<pid>-<seq>-<nonce>`
 *   darwin → `<tmpDir>/winbox-mpv-<pid>-<seq>-<nonce>.sock`
 * （`nonce` 缺省时省略该段，与既有 `MpvController` 的管道名形态一致。）
 */
export function mpvIpcPath(o: MpvIpcOptions, p: PlatformName = platformName()): string {
  const pid = Number(o?.pid) || 0;
  const seq = Number(o?.seq) || 0;
  const nonce = (o?.nonce || '').trim();
  const stem = `winbox-mpv-${pid}-${seq}${nonce ? `-${nonce}` : ''}`;
  if (isWin(p)) return `\\\\.\\pipe\\${stem}`;
  return `${(o?.tmpDir || '').trim().replace(/\/+$/, '') || defaultTmpDir()}/${stem}.sock`;
}

/**
 * ★ 风险 R1 能力开关：mpv 能否用 `--wid` 嵌进 Electron 窗口。
 *   - win32 恒 true（既有行为，已实测可用）；
 *   - 其余平台默认 true（「先尝试」），可用环境变量 `WINBOX_MAC_MPV_EMBED=0` 关闭
 *     （真机验证失败时的总闸；关闭后 macOS 走「仅 HTML5 + 外部播放器」降级路径）。
 */
export function mpvEmbedSupported(
  env: Record<string, string | undefined> = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>,
  p: PlatformName = platformName(),
): boolean {
  if (isWin(p)) return true;
  const raw = String(env?.WINBOX_MAC_MPV_EMBED ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
}

// ============================================================
// ⑥ 资源根与数据目录语义
// ============================================================

/**
 * 是否把 userData 搬到「安装目录/data」（win32 true = 现状；darwin false = **绝不写进 .app**）。
 * ★★ macOS 上写进 `.app` 内部会破坏签名密封（Gatekeeper 直接判定「已损坏」），必须 false。
 */
export function shouldRelocateUserData(p: PlatformName = platformName()): boolean {
  return isWin(p);
}

/** 是否生成 NSIS portable 的 7z-out 候选（仅 win32） */
export function hasPortableLayout(p: PlatformName = platformName()): boolean {
  return isWin(p);
}

/**
 * 「最后一个窗口关闭」后是否**退出应用**（P0-10）。
 *   win32 true = 现状；darwin false = macOS 惯例（关窗不退出，应用常驻 Dock，`Cmd+Q` 才退）。
 */
export function shouldQuitOnLastWindowClosed(p: PlatformName = platformName()): boolean {
  return !isMac(p);
}

/**
 * 「拉起安装包之后」是否**退出本应用**（★ 2026-10-12 更新流程平台差异）。
 *   win32 true = 现状：NSIS **覆盖安装需要独占安装目录**，本程序不退会占住文件导致装不上；
 *   darwin false：macOS 更新是「打开 .dmg → 用户在访达里把 Win-Box 拖进「应用程序」覆盖」，
 *   本程序占不占用毫无关系；退出反而会在 1.5s 后**吞掉引导提示**，用户看不到该做什么。
 */
export function shouldQuitAfterLaunchingInstaller(p: PlatformName = platformName()): boolean {
  return !isMac(p);
}

/**
 * 「最后一个窗口关闭」后是否**停掉本地代理**（P0-10 ★ 易错点）。
 *   win32 true = 现状；darwin false —— macOS 关窗后应用还活着，代理被停会导致
 *   「点 Dock 重开窗口 → 播放失败（本地中继已死）」，只能重启应用。
 */
export function shouldStopProxyOnLastWindowClosed(p: PlatformName = platformName()): boolean {
  return !isMac(p);
}

// ============================================================
// ⑦ 依赖探测契约
// ============================================================

/** Homebrew 包名（darwin 修复指引用） */
function brewPackage(tool: ToolId): string {
  switch (tool) {
    case 'mpv':
      return 'mpv';
    case 'ffmpeg':
    case 'ffprobe':
      return 'ffmpeg';
    case 'aria2c':
      return 'aria2';
    case 'java':
      return 'openjdk';
    case 'python3':
      return 'python@3.11';
    case 'vlc':
      return '--cask vlc';
    case 'iina':
      return '--cask iina';
    default:
      return '';
  }
}

/** 人类可读的工具名（中文文案用） */
function toolLabel(tool: ToolId): string {
  switch (tool) {
    case 'mpv':
      return 'mpv 播放内核';
    case 'ffmpeg':
      return 'ffmpeg（转封装）';
    case 'ffprobe':
      return 'ffprobe（格式探测）';
    case 'aria2c':
      return 'aria2c（BT 引擎）';
    case 'java':
      return 'Java 运行时（JRE）';
    case 'python3':
      return 'Python 3 运行时';
    case 'vlc':
      return 'VLC 播放器';
    case 'iina':
      return 'IINA 播放器';
    case 'potplayer':
      return 'PotPlayer';
    case 'mpc-hc':
      return 'MPC-HC';
    default:
      return tool;
  }
}

/** 缺失时的人话修复指引（darwin → `brew install <x>`；win32 → 官网 / winget） */
export function installHint(tool: ToolId, p: PlatformName = platformName()): string {
  const name = toolLabel(tool);
  if (isMac(p)) {
    const brew = brewPackage(tool);
    if (!brew) return `未找到 ${name}：该组件在 macOS 上不可用。`;
    return `未找到 ${name}。请执行 brew install ${brew}，或在配置页手动指定路径。`;
  }
  if (isWin(p)) {
    if (tool === 'vlc') return '未找到 VLC。请从 videolan.org 安装，或在配置页手动指定 vlc.exe 路径。';
    if (tool === 'iina') return 'IINA 仅适用于 macOS（Windows 请用 PotPlayer / VLC / mpv）。';
    if (tool === 'potplayer') return '未找到 PotPlayer。请从 potplayer.daum.net 安装，或在配置页手动指定路径。';
    if (tool === 'mpc-hc') return '未找到 MPC-HC。请安装 K-Lite Codec Pack 或 MPC-HC，或在配置页手动指定路径。';
    return `未找到 ${name}。请安装后重试，或在配置页手动指定 ${exeName(tool === 'python3' ? 'python' : tool, p)} 路径。`;
  }
  return `未找到 ${name}。请用系统包管理器安装（如 apt install ${brewPackage(tool) || tool}）。`;
}

/** 某工具在 `.app` 里的常见形态（darwin 专用）；没有则返回空数组 */
function appBundleCandidates(tool: ToolId, ctx: SystemProbeCtx, p: PlatformName): string[] {
  if (!isMac(p)) return [];
  const roots = appBundleRoots(ctx.home, p);
  const out: string[] = [];
  const pushBundle = (app: string, bin?: string): void => {
    for (const r of roots) {
      const b = appBundleBinary(r, app, bin, p);
      if (b) out.push(b);
    }
  };
  switch (tool) {
    case 'vlc':
      pushBundle('VLC', 'VLC');
      break;
    case 'iina':
      pushBundle('IINA', 'IINA');
      break;
    case 'mpv':
      pushBundle('mpv', 'mpv');
      break;
    default:
      break;
  }
  return out;
}

/** PATH 目录（ctx.pathDirs 优先，否则从 env 解析） */
function ctxPathDirs(ctx: SystemProbeCtx, p: PlatformName): string[] {
  if (Array.isArray(ctx.pathDirs) && ctx.pathDirs.length) {
    return uniq(ctx.pathDirs.map((s) => String(s || '').trim()).filter(Boolean));
  }
  return pathBinDirs(ctx.env || {}, p);
}

/**
 * 本机探测候选（有序，顺序＝优先级）：
 *   darwin → `*.app/Contents/MacOS/<bin>` → Homebrew / `/usr/local/bin` / `/usr/bin` → PATH；
 *   win32  → 返回 []（Windows 的 Program Files 系候选由调用方既有逻辑负责，
 *            见 `src/main/torrent/externalPlayer.ts` 的 `playerCandidates`）。
 */
export function systemToolCandidates(
  tool: ToolId,
  ctx: SystemProbeCtx = {},
  p: PlatformName = platformName(),
): string[] {
  if (!isMac(p)) return [];
  const bins = systemBinDirs(p);
  const paths = ctxPathDirs(ctx, p);
  const out: string[] = [];

  // ① .app 内二进制（VLC / IINA / mpv）
  out.push(...appBundleCandidates(tool, ctx, p));

  // ② 系统 bin 目录（Homebrew → /usr/local/bin → /usr/bin）
  if (tool === 'java') {
    for (const d of bins) out.push(posixJoin(d, javaExeName(p)));
  } else if (tool === 'python3') {
    for (const d of bins) out.push(posixJoin(d, pythonExeName(p)));
  } else if (tool !== 'potplayer' && tool !== 'mpc-hc') {
    for (const d of bins) out.push(posixJoin(d, exeName(tool, p)));
  }

  // ③ PATH
  if (tool === 'java') {
    for (const d of paths) out.push(posixJoin(d, javaExeName(p)));
  } else if (tool === 'python3') {
    for (const d of paths) out.push(posixJoin(d, pythonExeName(p)));
  } else if (tool !== 'potplayer' && tool !== 'mpc-hc') {
    for (const d of paths) out.push(posixJoin(d, exeName(tool, p)));
  }

  return uniq(out);
}

// ============================================================
// ⑧ 发布资产（T04 用）
// ============================================================

/** dmg 资产名：`Win-Box-1.20.10-arm64.dmg`（arch 为空时 `Win-Box-1.20.10.dmg`） */
export function dmgArtifactName(product: string, version: string, arch: ArchTag): string {
  const base = `${product}-${version}`;
  return `${base}${arch ? `-${arch}` : ''}.dmg`;
}
