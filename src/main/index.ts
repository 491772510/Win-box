// src/main/index.ts — Electron 主进程入口
// ★★ 第一条 import（import 即执行，勿挪位置）：把数据目录切到**安装目录/data**，
//   并在老用户首次启动时自动迁移 %APPDATA%\win-box（见 dataDirBootstrap.ts 头注释）。
//   必须早于 logger / 各 Store 的模块求值，否则它们会把路径解析到旧位置。
import { dataDirReport } from './util/dataDirBootstrap';
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { registerIpc } from './ipc';
import { SpiderHost } from './spider/SpiderHost';
import { LocalProxyServer } from './server/LocalProxyServer';
import { fileLogger } from './util/logger';
import { applyWindowCorner } from './util/windowCorner';
import { bossKey } from './bossKey';
import { playerWindow, onPlayerWindowClosed } from './player/PlayerWindow';
import { playerSettings } from './player/playerSettings';
import { hostRegexFor } from '../engine/util/m3u8Purify';
import { TorrentPlay } from './torrent/torrentPlay';
import { DavService } from './webdav/DavService';
import { DlnaService } from './dlna/DlnaService';
import { UpdateService } from './update/UpdateService';
import { DavStore } from './store/DavStore';
import { JsonStore } from './store/JsonStore';
import { LocalPkgStore } from './store/LocalPkgStore';
import { PluginHost } from './plugin/PluginHost';
import { LOCAL_PROXY_BASE } from '../shared/constants';
import { IPC } from '../shared/ipc-channels';
import { builtinPluginsDir, cacheDir, legacyLocalImportsDir, localImportsDir, pluginsDir, userDataDir } from './util/paths';
import { safeStorageDriveCodec } from './util/driveCodec';
import { clearWinboxCache, type ClearCacheResult } from './util/cacheClean';
import {
  isFirstLaunchAfterUpdate,
  lastRunVersionPath,
  readLastRunVersion,
  writeLastRunVersion,
} from './util/updateCacheReset';
import { installApplicationMenu } from './menu';
import { restartApp, setSoftRestartHandler, shouldDeferQuitCleanup } from './util/appRestart';
import {
  exeName,
  isMac,
  javaExeName,
  platformName,
  pythonExeName,
  shouldQuitOnLastWindowClosed,
  shouldStopProxyOnLastWindowClosed,
  type ToolId,
} from '../shared/platform';

// esbuild 打成 CJS：__dirname 由 Node 提供（= dist/）。资源在 dist/../../resources。
declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
const host = new SpiderHost();
/**
 * ★ 2026-10-13：**源侧请求重启应用**的落地（加固壳网页配置中心「恢复配置后自动重启」）。
 *
 * 链路：wex `x0.e.v0()` → 桩 `stubs-src/android/content/Context.startActivity` 打
 * stderr 信令 `[winbox] app-restart-request` → `JarSpiderBridge.noteBridgeLog` 识别 →
 * `EngineHost.requestAppRestart` → 这里 → `restartApp()`（app.relaunch + 走正常退出清理）。
 *
 * 为什么在此注入而不是让 SpiderHost 直接用 electron：`src/main/spider/SpiderHost.ts`
 * 与 `src/engine/**` 都不 import electron（保可测试性 / 引擎可脱离 Electron 运行）。
 */
host.onAppRestartRequest = (reason: string) => restartApp(reason);
/**
 * ★ 2026-10-13：开发模式「软重启」落地（原因见 `util/appRestart.ts` 头注释）。
 *
 * 三步：
 * <ol>
 *   <li>关掉主窗口以外的窗口（网页版配置中心 / 播放器窗 / 详情子窗 …）。主窗口**保留** ——
 *       全关会触发 `window-all-closed` → 非 darwin 直接 `app.quit()`，那就变回进程重启了。</li>
 *   <li>`host.resetSpidersForConfigReload()` 丢弃全部常驻 JVM + 清引擎实例缓存。
 *       源侧（wex 等）刚恢复的配置写在沙箱文件里，下一次调用会重新拉起 JVM 并重读 ——
 *       这正是「重启」要达到的效果。**不能用 `dispose()`**：那是给退出用的，会清掉
 *       只创建一次的池回收定时器（详见 `SpiderHost.resetSpidersForConfigReload` 注释）。</li>
 *   <li>重载界面：渲染层重新初始化并重新拉取源列表 / 首页。</li>
 * </ol>
 */
setSoftRestartHandler(() => {
  let mainAlive = false;
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    if (w === mainWindow) {
      mainAlive = true;
      continue;
    }
    try {
      w.close();
    } catch {
      /* 关不掉也无所谓，reload 后它们本来就该重建 */
    }
  }
  try {
    host.resetSpidersForConfigReload();
  } catch (e) {
    fileLogger.w(`软重启：重置蜘蛛失败：${(e as Error).message}`);
  }
  if (mainAlive && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.reload();
    } catch (e) {
      fileLogger.w(`软重启：重载界面失败：${(e as Error).message}`);
    }
  } else {
    createWindow();
  }
});
/**
 * ★ 2026-09-29：磁力（BT）引擎（用户选定方案 B）—— aria2c sidecar + 本机中继 `/bt` + 外部播放器接力。
 * 懒启动（首次磁力播放才拉起 aria2c），退出时 dispose（另有 `--stop-with-process` 兜底防孤儿）。
 */
const torrent = new TorrentPlay(fileLogger, () => playerSettings.settings.btExternalPlayer);
host.torrentPlay = torrent;
/**
 * ★ 2026-09-29 WebDAV 存储（用户选定「WebDAV 直连」）：服务器与凭据加密落盘，
 * 浏览走 PROPFIND、播放走 `/play?dav=<id>` 由中继注入 Authorization（凭据绝不进 URL）。
 */
const dav = new DavService(
  new DavStore(new JsonStore(join(userDataDir(), 'webdav-servers.json')), fileLogger, safeStorageDriveCodec()),
  fileLogger,
);
/** ★ 2026-09-29 DLNA 投屏（SSDP 发现 + AVTransport 三动作；对位 CatClaw Dlna.cs = TVBox osc/dlna） */
const dlna = new DlnaService(fileLogger);
/**
 * ★ 2026-09-29 启动更新检查：本地版本低于 GitHub 最新 Release 时提示用户选择——
 *   查 `api.github.com`（失败不锁死）→ 代理加速下载 Setup → 拉起安装程序并退出本程序。
 */
const updater = new UpdateService(fileLogger);
/**
 * ★ 2026-09-29（用户要求）本地包（影视壳/影视仓 目录包）：登记表 + `/pkg` 资源路由 + py 就地运行。
 *   导入安装目录下的 imports 副本，原始包可移动/删除，不影响已导入订阅。
 */
const localPkgs = new LocalPkgStore(
  new JsonStore(join(userDataDir(), 'local-pkgs.json')),
  LOCAL_PROXY_BASE,
  localImportsDir(),
  legacyLocalImportsDir(),
);
/**
 * ★ 2026-10-16 插件系统（M1，用户拍板「方案 A」）：宿主聚合——
 *   随包官方插件启动时**物化**（`resources/plugins/*.winbox` → `<userData>/plugins/<id>.winbox/` + 侧签）
 *   → 与用户安装**同构**；用户插件安装/启停；超分档位 → mpv 着色器**绝对路径**解析。
 */
const plugins = new PluginHost({
  pluginsDir: pluginsDir(),
  builtinDir: builtinPluginsDir(),
  statePath: join(userDataDir(), 'plugins-state.json'),
});
const proxy = new LocalProxyServer(
  fileLogger,
  () => host.driveList(),
  // ★ 2026-09-29 m3u8 去广告注入（默认关，配置页「播放」可开）：
  //   开关每轮清单回源时现读（改后即时生效）；规则用当前订阅的 rules[].regex 按 host 匹配。
  {
    enabled: () => playerSettings.settings.m3u8Purify,
    rulesFor: (url) => hostRegexFor(url, host.siteConfig?.rules),
  },
  // ★ 2026-09-29 WebDAV 取流认证（凭据只在主进程加密存储里）
  (id) => dav.authHeader(id),
);
// ★ 2026-09-29（用户要求）本地包：包内资源路由（/pkg/<i>/<rel>）+ 订阅 pkg:// 读取
proxy.pkgRoot = (i) => localPkgs.rootOf(i);
host.localPkgs = localPkgs;
host.initializeLocalImports();
// ★ 把 /play 中继的真实转发字节速率推给渲染层（播放器「缓存中」实时网速）
const pushSpeed = (kbs: number): void => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('net:speed', kbs);
  }
};
proxy.onSpeed = pushSpeed;
// ★ 2026-09-29：BT 下载速率走同一条通道（/bt 中继写回字节 + aria2 下载速率）→ 播放器「缓存中 x MB/s」
torrent.onSpeed = pushSpeed;
// ★ 2026-09-26：壳/蜘蛛的宿主代理（`/proxy/<jvmPort>?do=proxy&key=…`）被访问 → 钉住那个 JVM
proxy.onSpiderProxy = (port) => host.pinSpiderProxy(port);
proxy.onPythonProxy = (key, params) => host.pythonProxy(key, params);
/**
 * ★ 2026-10-13：**源侧恢复配置后重启的宿主侧兜底**。
 *
 * 源侧（`stubs` → stderr 信令）那条路已打通，但**不可靠**：承载配置中心的 JVM 常常在
 * 还原完成后立刻死掉，wex 自己排的 3 秒 `Handler.post` 来不及发出（真机三次还原只成功一次）。
 * 本地代理是这条链路的必经之处 —— 它在**拿到还原应答的那一刻**就观测到了，
 * 不依赖任何 JVM 之后是否存活，于是重启从「看运气」变成确定行为。
 *
 * 两条路先到者生效，另一路被 `restartApp` 的 20s 抑制窗挡掉，不会重复重启。
 */
proxy.onSpiderConfigRestored = (hint) => restartApp(`源侧恢复配置（${hint}）`);
// ★ 2026-09-29：`/bt/<hash>/<idx>` 取流口（Range + piece 门控 + 本地读盘）
proxy.bt = torrent;

function isDev(): boolean {
  return !app.isPackaged && process.env.NODE_ENV !== 'production';
}

// 渲染策略：**不再强制禁用 GPU/硬件加速**。
//   过往为"无 GPU/驱动异常环境"加了 disableHardwareAcceleration + disable-gpu + disable-software-rasterizer，
//   但用户实测（本机有正常 GPU）强禁后无边框窗口在最大化/resize 时合成器不刷新，
//   网页只渲染在左上角原尺寸、右侧/下方直接露出 backgroundColor（"最大化异形"）。
//   交由 Electron/Chromium 按环境自选：有 GPU 走硬件合成（最大化正常），无 GPU 时自动回退软件。
// no-sandbox / disable-dev-shm-usage 仍保留（子进程沙箱相关，与渲染无关）。
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// 原生崩溃此前没有应用日志；记录进程类型/退出码，不记录资源 URL 或凭据。
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_e, details) => {
    fileLogger.w(`renderer-gone wc=${contents.id} reason=${details.reason} exitCode=${details.exitCode}`);
  });
  contents.on('unresponsive', () => fileLogger.w(`renderer-unresponsive wc=${contents.id}`));
});
app.on('child-process-gone', (_event, details) => {
  fileLogger.w(`child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
});

function createWindow(): void {
  // 默认跟随系统亮暗（Mica 背景会随之切换深浅）
  // backgroundMaterial: 'mica' 仅 Win11 有效；旧版本自动降级无副作用
  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // ★ 用不透明底色：无边框窗口若背景全透明，放大/最大化时未渲染区域会显示黑色残影/形状异常
    //   （--bg-glass 本身约 90% 不透明，视觉几乎无差异，Mica 磨砂不受影响）
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0c10' : '#dce4ec',
    title: 'Win-Box',
    // 无边框自定义标题栏：窗口控制（最小化/最大化/关闭）与拖拽由渲染层 TitleBar 处理
    frame: false,
    autoHideMenuBar: true,
    icon: app.isPackaged ? undefined : join(__dirname, '..', '..', 'build', 'icon.png'),
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  mainWindow = new BrowserWindow(winOpts);

  // ★ Win11 无边框圆角在最大化时露出右上角黑角（关闭钮旁异形）：最大化取消圆角、还原恢复
  const setCorner = (round: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) applyWindowCorner(mainWindow, round);
  };
  // ★ 最大化/还原后强制重绘：无边框窗口在最大化动画期间 webContents 视口可能未铺到新尺寸，
  //   未重绘区域会直接显示 backgroundColor（暗色）→ 观感像"小窗贴左上、右侧补背景"。强制重绘兜底。
  const refreshContent = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const { webContents } = mainWindow;
        if (!webContents.isDestroyed()) webContents.invalidate();
      } catch {
        /* ignore */
      }
    }
  };
  mainWindow.on('maximize', () => { setCorner(false); refreshContent(); });
  mainWindow.on('unmaximize', () => { setCorner(true); refreshContent(); });

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // ★ 2026-09-30 数据目录（安装目录/data；老用户自动迁移 + 清理旧 C 盘目录）——排障第一现场
  try {
    const m = dataDirReport.migration;
    const migDesc = m
      ? `迁移=${m.status}${m.files ? `（${m.files} 文件 / ${(m.bytes / 1024 / 1024).toFixed(1)}MB）` : ''}${m.skipped ? `，跳过可重建缓存 ${m.skipped} 项` : ''}${m.status === 'moved' ? '（整目录移动）' : ''}${m.cleanedLegacy ? '，旧目录已清理' : ''}${m.error ? `，注意：${m.error}` : ''}`
      : '迁移=无旧数据';
    if (dataDirReport.mode === 'fallback') {
      fileLogger.w(
        `数据目录: ${dataDirReport.target}（回退，计划目录 ${dataDirReport.planned}）：${dataDirReport.reason || ''}`,
      );
    } else {
      fileLogger.i(`数据目录: ${dataDirReport.target}（模式 ${dataDirReport.mode}；${migDesc}）`);
    }
    // ★ 2026-10-13：旧目录若被判定为「在用数据」而未清理，必须单独告警 ——
    //   混在 info 那行里极易被略过，用户会误以为「配置丢了」（事故当天的实际观感）。
    if (m && !m.cleanedLegacy && m.error) {
      fileLogger.w(`数据目录注意：${m.error}`);
    }
  } catch {
    /* ignore */
  }

  // 启动即记录资源根定位结果：打包后（尤其 portable 的 7z-out 解压布局）
  // 若再出现「JRE 缺失」，日志首行就能看出真实路径命中情况。
  //
  // ★ 2026-10-12（macOS 适配 P0-3）：不再硬编码 `jvm/jre/bin/java.exe` ——
  //   darwin 上没有 `.exe`，且 JRE 可能是 `Contents/Home/bin/java` 布局；
  //   统一走 `javaCandidates()`（返回第一个存在的候选）。Windows 分支结果逐字节不变。
  let resourcesRoot = '';
  try {
    const { resourcesDir, resourcesDirDebug, javaCandidates } = await import('./util/paths');
    const dir = resourcesDir();
    resourcesRoot = dir;
    const ok = javaCandidates(dir).some((p) => existsSync(p));
    fileLogger.i(`资源根: ${dir} | ${javaExeName()}: ${ok ? 'OK' : '缺失'}`);
    if (!ok) fileLogger.w('资源候选路径探测:\n' + resourcesDirDebug());
  } catch (e) {
    fileLogger.w('资源根探测失败: ' + (e instanceof Error ? e.message : String(e)));
  }

  // ★ 2026-10-12（macOS 适配 G4「依赖可观测」）：启动依赖探测总览 —— 一行一个依赖。
  //   探测链：用户覆盖 → 随包内置 → 本机探测（Homebrew / /usr/local/bin / PATH / *.app）。
  //   缺失时给「人话」修复指引（darwin 必含 `brew install <x>`），不再只留一句「缺失」。
  //   ★ 日志级别按平台区分：darwin 缺依赖是**真故障**（仓库不随包二进制）→ warn；
  //     win32 依赖以随包内置为主、本机探测本就返回空（Program Files 系逻辑在调用方）
  //     → 降为 info，避免 Windows 启动日志被无意义的 warn 刷屏（零行为变化）。
  try {
    const { probeTools } = await import('./util/toolProbe');
    const p = platformName();
    const missingIsWarn = isMac(p);
    const deps: Array<{ tool: ToolId; bundled: string }> = [
      { tool: 'mpv', bundled: join(resourcesRoot, 'mpv', exeName('mpv', p)) },
      { tool: 'ffmpeg', bundled: join(resourcesRoot, 'ffmpeg', exeName('ffmpeg', p)) },
      { tool: 'ffprobe', bundled: join(resourcesRoot, 'ffmpeg', exeName('ffprobe', p)) },
      { tool: 'aria2c', bundled: join(resourcesRoot, 'aria2', exeName('aria2c', p)) },
      { tool: 'java', bundled: join(resourcesRoot, 'jvm', 'jre', 'bin', javaExeName(p)) },
      { tool: 'python3', bundled: join(resourcesRoot, 'python', pythonExeName(p)) },
    ];
    const found = probeTools(deps, (c: string) => existsSync(c));
    for (const d of deps) {
      const r = found[d.tool];
      if (r && r.source !== 'none') {
        fileLogger.i(`依赖: ${d.tool}=${r.source} ${r.path}`);
      } else {
        const msg = `依赖: ${d.tool}=none（${r ? r.hint : ''}）`;
        if (missingIsWarn) fileLogger.w(msg);
        else fileLogger.i(msg);
      }
    }
  } catch (e) {
    fileLogger.w('依赖探测失败: ' + (e instanceof Error ? e.message : String(e)));
  }

  // ★ 2026-10-09：构建标记 —— 日志排障第一行就能确认「跑的是哪只构建」。
  //   背景：同版本号覆盖安装时用户日志无法区分新旧产物（1.20.0 两轮都叫 1.20.0），
  //   此标记随每轮 main 改动手工递增（含当轮关键词，grep 即证）。
    fileLogger.i(`build: 20261012.1 release-${app.getVersion()} (macOS T02: platform layer / dataDir no-relocate / darwin lifecycle / app menu / dep probe)`);

  // ★ 2026-10-12（macOS 适配 P1-1）：安装 macOS 应用菜单（App / 编辑 / 窗口 / 帮助）。
  //   **非 darwin 内部直接 no-op** —— Windows 完全无感（全应用零菜单的现状保持不变）。
  //   Cmd+Q 退出 / Cmd+W 关窗 / Cmd+, 跳配置页 都靠它。
  try {
    installApplicationMenu({
      /**
       * 「设置…」（Cmd+,）：
       *   ① macOS 上窗口可能已被用户 Cmd+W 关掉（应用仍常驻 Dock）→ 先确保**主窗口**存在；
       *   ② 只向**主窗口**发 UI_GOTO_SETTINGS 让它跳配置页（渲染层订阅与否都无害）；
       *   ③ 无论渲染层是否订阅，都把主窗口**前置可见** —— 否则用户按 Cmd+, 什么都不会发生。
       *
       * ★★ 目标恒为 `mainWindow`（**不是**「第一个窗口」）：macOS 关主窗不退出，若此时只剩
       *   播放器窗 / 详情 / 搜索子窗，用「第一个非销毁窗口」会跳过 `createWindow()`、把焦点
       *   给到一个**没有 `/config` 路由**的子窗 → Cmd+, 看着像没反应。故这里显式锚定主窗口。
       */
      onPreferences: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        const w = mainWindow;
        if (w && !w.isDestroyed()) {
          try {
            w.webContents.send(IPC.UI_GOTO_SETTINGS);
          } catch {
            /* 窗口已关：忽略 */
          }
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
      },
    });
  } catch {
    /* 菜单安装失败不影响启动 */
  }

  // ★ 2026-10-15（用户要求）：**更新后首次启动**清空应用私有缓存（winbox-cache）。
  //   背景：升级下载的安装包落在 `winbox-cache/update/` 且从不删除，逐版累积会让安装目录涨到 GB 级。
  //   判定 = 与 `<userData>/last-run-version.json` 记的「上次运行版本」比较，版本变化即视为更新后首次启动；
  //   **仅打包态生效**（开发态版本抖动不应误清）；标记文件放在 winbox-cache 之外，不会被本次清理删掉。
  //   清理后所有内容自动重建（见下方 `enablePrewarm` 之后的 `rewarmAfterCacheClear`）。
  let privateCacheReset: ClearCacheResult | null = null;
  try {
    const marker = lastRunVersionPath(userDataDir());
    const prev = readLastRunVersion(marker);
    if (app.isPackaged && isFirstLaunchAfterUpdate(prev, app.getVersion())) {
      privateCacheReset = clearWinboxCache(cacheDir());
      fileLogger.i(
        `更新后首次启动（${prev} → ${app.getVersion()}）：已清空应用私有缓存 winbox-cache（释放 ${(privateCacheReset.freedBytes / 1024 / 1024).toFixed(1)}MB；`
          + `清理 ${privateCacheReset.cleared.length} 项${privateCacheReset.cleared.length ? `：${privateCacheReset.cleared.slice(0, 12).join('/')}` : ''}`
          + `${privateCacheReset.failed.length ? `；失败 ${privateCacheReset.failed.join('/')}` : ''}）`,
      );
    }
    if (app.isPackaged) writeLastRunVersion(marker, app.getVersion());
  } catch (e) {
    fileLogger.w('更新后清空私有缓存失败：' + (e instanceof Error ? e.message : String(e)));
  }

  try {
    await proxy.start();
  } catch {
    fileLogger.w('本地代理启动失败，直播归一化可能受影响');
  }
  // ★ 网络代理设置（用户可在配置页填 http 代理；用于被 DNS 污染 / SNI 阻断的站点）。
  //   初始化后所有出站（本进程请求 / 本地中继 / JVM 与 Python 蜘蛛 / 嗅探窗口）统一生效。
  try {
    const { initProxySettings } = await import('./net/proxy');
    const { userDataDir } = await import('./util/paths');
    initProxySettings(join(userDataDir(), 'proxy.json'));
  } catch (e) {
    fileLogger.w('代理设置初始化失败：' + (e as Error).message);
  }
  // ★ 2026-09-28：播放/落盘诊断落盘（`<userData>/logs/play-diag-*.jsonl`）
  //   注入式（playDiag 不静态依赖 electron），供「落盘/播放成功率」排查取数。
  try {
    const { initPlayDiag } = await import('./util/playDiag');
    const { userDataDir } = await import('./util/paths');
    initPlayDiag({
      logDir: () => join(userDataDir(), 'logs'),
      log: (m: string) => fileLogger.i(m),
    });
  } catch (e) {
    fileLogger.w('播放诊断初始化失败：' + (e as Error).message);
  }
  // ★ 网盘会话必须在蜘蛛预热前准备好：夸克 member 接口会补发新版 __puus，
  //   而 Pizazz/fty 蜘蛛在 init 时只读一次 cookie。失败时保留旧凭据并继续启动。
  try { host.syncDriveFiles(); } catch { /* 同步失败不影响启动 */ }
  try { await host.refreshDriveSessions(); } catch (e) {
    fileLogger.w('网盘会话刷新失败（保留现有绑定）：' + (e as Error).message);
  }
  try { host.syncDriveFiles(); } catch { /* 同步失败不影响启动 */ }
  host.enablePrewarm();
  // ★ 更新后已清空 winbox-cache（含 jar 转换产物与常驻运行时）→ 立刻在后台重建，
  //   否则用户下次进源要现付「下载 + dex2jar + JVM 冷启动」（实测 37s，会被请求超时顶掉）。
  if (privateCacheReset) {
    try { host.rewarmAfterCacheClear(); } catch { /* 预热失败不影响清理结果 */ }
  }
  // ★ 2026-10-16 插件宿主：物化随包官方插件 + 刷新登记表（失败不阻塞启动）
  try {
    await plugins.init();
    const items = await plugins.list();
    fileLogger.i(`插件：登记 ${items.length} 个（${items.map((p) => `${p.id}@${p.version}/${p.source}`).join('、') || '无'}）`);
  } catch (e) {
    fileLogger.w('插件初始化失败：' + (e instanceof Error ? e.message : String(e)));
  }
  registerIpc(host, dav, dlna, updater, localPkgs, plugins);
  // 老板键：注入窗口提供者（主窗口 + 播放器窗口）并按上次设置注册全局快捷键
  bossKey.start(() => {
    const ws: BrowserWindow[] = [];
    if (mainWindow && !mainWindow.isDestroyed()) ws.push(mainWindow);
    const pw = playerWindow();
    if (pw) ws.push(pw);
    return ws;
  });
  bossKey.apply();
  // ★ 关闭播放器窗口 → 删除本次夸克转存落盘文件（观看进度保留在本地历史）
  onPlayerWindowClosed(() => {
    void host.quarkDeletePending().catch(() => undefined);
  });
  // ★ 启动时清理上次遗留的夸克落盘文件（此前关闭/退出未删成功的）
  void host.quarkDeletePending().catch(() => undefined);
  createWindow();
  // ★ 启动时自动订阅刷新（≥7 天一次，静默后台执行，失败仅记日志）
  void host.maybeAutoRefreshSubscriptions();
  app.on('activate', () => {
    // ★ 2026-10-12（macOS 适配 P0-10 / P1-3）：Dock 图标点击（以及 Cmd+Tab 切回）时
    //   必须能**重建主窗口** —— macOS 关窗不退出，应用常驻 Dock；没有窗口又建不出来
    //   就变成了「点了 Dock 图标什么都没有」。老板键隐藏态（`mainWindow` 仍非 null、
    //   窗口也未关闭）不受影响。
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    const first = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
    if (first) {
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // ★ 2026-10-12（macOS 适配 P0-10）★★：
  //   改前 `proxy.stop()` 对**所有平台**都执行，再 `if (process.platform !== 'darwin') app.quit()`。
  //   → macOS 上关掉最后一个窗口后代理被停掉、但应用按 macOS 惯例仍常驻 Dock，
  //     「点 Dock 重开窗口接着播」直接播不了（本地中继已死），只能 Cmd+Q 重启。
  //   darwin：直接 return —— **既不 quit 也不 stop 代理**（真正的清理统一放 `will-quit`）。
  //   非 darwin：逻辑一字不变（stop + quit）。
  if (!shouldStopProxyOnLastWindowClosed()) return;
  proxy.stop();
  if (shouldQuitOnLastWindowClosed()) app.quit();
});

// ★ 退出前彻底清理：terminate 所有 JVM 蜘蛛子进程 + 停本地代理 + 断 token 解码，
//   确保关闭应用后无任何后台残留进程/服务（含 Electron 隐含子进程会在 app.quit 后自行结束）。
let quitCleanupStarted = false;
app.on('will-quit', (event) => {
  // will-quit 不会等待普通 async 回调；先阻止退出，给待清理的网盘目录一次有限时长的
  // 删除机会，避免窗口关闭后马上退出导致“播完即删”只写入队列却未发出请求。
  if (!quitCleanupStarted) {
    quitCleanupStarted = true;
    // ★ 2026-10-13：**重启场景绝不能在这里异步挂起**。
    //   `app.relaunch()` 会立刻 spawn 一个 `--type=relauncher` 子进程，它必须等本进程
    //   **真正退出**才会拉起新实例；一旦在 will-quit 里 preventDefault 挂住，退出流程
    //   走不完 → 旧进程不退、relauncher 死等 → 用户看到「窗口关了，应用再也不起来」。
    //   （真机取证与完整论证见 `util/appRestart.ts` 的 shouldDeferQuitCleanup 注释）
    if (shouldDeferQuitCleanup()) {
      event.preventDefault();
      void Promise.race([
        host.quarkDeletePending(),
        new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
      ]).finally(() => app.quit());
      return;
    }
    fileLogger.w(
      '重启退出：跳过异步清理等待，改为立即同步清理' +
        '（否则 relauncher 永远等不到本进程退出，新实例就起不来）',
    );
  }
  try {
    // ★ 退出前再尝试一次夸克落盘文件清理（失败会持久化到下次启动重试）
    void host.quarkDeletePending();
  } catch {
    /* ignore */
  }
  try {
    host.dispose();
  } catch {
    /* ignore */
  }
  try {
    // ★ 2026-09-29：停 BT 引擎（回收到 win-quit 这一步，保证不留 aria2c 孤儿进程）
    torrent.dispose();
  } catch {
    /* ignore */
  }
  try {
    proxy.stop();
  } catch {
    /* ignore */
  }
});

// 兜底：若 did-fail-load 或异常，也让 JVM 子进程不残留
process.on('beforeExit', () => {
  try { host.dispose(); } catch { /* ignore */ }
});

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
