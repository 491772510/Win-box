# Win-Box · macOS 适配 —— 增量 PRD

| 项 | 内容 |
| --- | --- |
| 文档语言 | 中文 |
| 项目名 | `win_box_macos_adaptation` |
| 变更类型 | **增量需求**（在既有 Windows 版本上新增 macOS 支持，不重写产品） |
| 技术栈（沿用） | Electron 33 + React 19 + TypeScript + Vite + esbuild（主进程 CJS）+ pnpm + electron-builder 25 |
| 当前版本 | package.json `1.20.10`（README 标注 1.20.5，CHANGELOG 最新 1.20.7 —— 以 package.json 为准） |
| 仓库根 | `Win-box-main/`（本文所有路径均相对此根） |
| 目标平台 | macOS（Apple Silicon arm64 优先，Intel x64 次优先） |

---

## 0. 既定前提（已与用户确认，本 PRD 不再讨论）

1. **双平台共存**：抽象出 platform 层，Windows 与 macOS 共用一套代码；**现有 Windows 行为必须完全不变、可回归**，新增 `darwin` 分支而非改公共路径。
2. **原生依赖策略 = 自动探测优先，内置兜底**：mpv / ffmpeg / aria2 / JRE(JVM) / CPython 等，先探测本机已安装（Homebrew `/opt/homebrew/bin`、`/usr/local/bin`、`PATH`、`/Applications`），找不到再回退随包内置二进制；探测/回退结果必须在日志与 UI 上可见。
3. **交付深度 = 代码适配 + macOS 构建配置 + 构建文档**：含 electron-builder 的 `dmg`/`zip` target、`.icns` 图标、签名/公证脚本占位，以及在 Mac 上构建与签名的操作文档。

> 源码仓库现状提醒：`resources/mpv/`、`resources/ffmpeg/*.exe`、`resources/jvm/jre|libs|stubs|dex2jar|*.jar` 均在 `.gitignore` 中（不随源码分发），因此 macOS 侧"内置兜底"二进制需由构建方自备并放在同样的 `resources/<tool>/` 目录，不入库。

---

## 1. 产品目标

**一句话**：让 Win-Box 在 macOS 上以"原生 Mac 应用的观感与习惯"跑起来 —— 装得上、打得开、能播、BT/磁力能用、能更新，且 Windows 版一行行为都不变。

拆解为 5 条：

| # | 目标 | 可度量口径 |
| --- | --- | --- |
| G1 | **装得上、打得开**：产出可安装的 macOS 分发物，普通 Mac 用户无需关闭 Gatekeeper 即可打开 | 提供 `.dmg`（arm64 / x64）与 `.zip` 便携包；签名+公证后双击可启动，首次无"已损坏"提示 |
| G2 | **核心链路可用**：点播（HTML5 内核）、MPV 内核、BT/磁力、外部播放器接力、本地代理、自动更新在 macOS 上全部可跑通 | 在 macOS 真机上通过 6 条用户故事（第 2 节）的冒烟清单 |
| G3 | **看起来像 Mac 应用**：窗口控制、菜单栏、Dock、`Cmd` 系快捷键、全屏、字体、滚动符合 macOS 习惯 | 第 4 节 UI/交互差异项逐条验收 |
| G4 | **依赖可观测、可兜底**：原生二进制缺失时给出人话提示与修复指引，而不是静默失败 | 每个依赖（mpv/ffmpeg/aria2c/java/python3）在启动日志一行 + 配置页可见来源（本机/内置/未找到） |
| G5 | **Windows 零回归**：本次改动不得改变 Windows 任何既有行为 | `pnpm typecheck` + `pnpm test`（Vitest）全绿；Windows 冒烟清单与改动前一致；所有平台分支以 `process.platform` 判定，公共纯函数行为不变 |

---

## 2. 用户故事

| # | 用户故事 | 验收要点 |
| --- | --- | --- |
| US1 | 作为一个 **Mac 用户**，我下载 `Win-Box-1.x.y-arm64.dmg` 后双击挂载、把 App 拖进 Applications，就能像装别的 Mac 软件一样完成安装，而 Mac 不会弹出"无法打开/已损坏" | dmg 内置 Applications 快捷方式；签名+公证；未签名时提供"右键→打开"的兜底说明 |
| US2 | 作为一个 **首次启动的 Mac 用户**，我第一次打开应用时，它把数据目录放到 macOS 规范位置（`~/Library/Application Support/Win-Box`），不会往我刚装好的 `.app` 里写东西（否则下次更新、签名校验都会出问题） | 数据目录不含 `.app` 内部路径；`imports/`、缓存、日志同理 |
| US3 | 作为一个 **Mac 用户**，我搜索一部剧并点开播放，能用内置 HTML5 内核正常起播、拖动、切集 | 本地代理 `127.0.0.1` 中继在 macOS 上正常监听；HLS/MP4 起播与拖动通过 |
| US4 | 作为一个 **追求高兼容的 Mac 用户**，我在配置页选择 MPV 内核时，应用能自动找到我用 `brew install mpv` 装的 mpv（找不到则回退随包内置），并把画面嵌进播放器窗口 | 探测顺序：用户覆盖 → 随包内置 → 本机探测；找不到时给出"如何安装 mpv"的人话提示而非静默失败 |
| US5 | 作为一个 **看本地/磁力资源的 Mac 用户**，我粘贴磁力链接后能边下边播；遇到 Chromium 播不了的 MKV/HEVC 时，应用能识别我装的 VLC / IINA / mpv 并接力播放，且能从历史第 N 秒起播 | aria2c 在 macOS 启动成功；外部播放器候选表含 macOS 路径；`--start-time` / `--start` 起播参数生效 |
| US6 | 作为一个 **Mac 用户**，我点红绿灯的"关闭"只关当前窗口（播放器窗口/详情窗口），应用仍在 Dock 常驻；我要退出时按 `Cmd+Q` 或用菜单栏"退出 Win-Box" | 关掉最后一个窗口不退出进程；Dock 图标点击/`activate` 可重新开窗；`Cmd+Q` 走完整清理（停 aria2、停 mpv、停代理） |
| US7 | 作为一个 **已安装的 Mac 用户**，启动时检测到新版本会自动下载 `.dmg`（不再只认 `.exe`）并引导我完成替换安装 | 更新器识别出与本机架构匹配的 dmg 资产；下载后提示"已打开安装包，请拖入 Applications 覆盖" |
| US8 | 作为一个 **同时用 Windows 版的老用户**，我升级到含 macOS 适配的版本后，Windows 上的一切（数据目录、播放器、BT、老板键、更新）与以前完全一样 | Windows 冒烟清单逐项通过，无行为差异 |

---

## 3. 需求池

> 优先级：P0 = 必须有（不做则 macOS 版不可用）；P1 = 应该有（不做则"不像 Mac 应用"或体验明显受损）；P2 = 锦上添花 / 可后置。
> 所有"平台分支"需求默认要求：`process.platform === 'darwin'` 走新分支，其余保持现状，Windows 单测全绿。

### 3.1 P0（Must have）

| # | 需求 | 描述（含代码取证） | 验收标准 | 涉及模块 |
| --- | --- | --- | --- | --- |
| P0-1 | **platform 抽象层** | 新增平台判定与二进制命名的统一出口（如 `src/main/util/platform.ts` / `src/shared/platform.ts`）：`isWin/isMac`、`exeName('mpv')→'mpv.exe'|'mpv'`、`homebrewBins()`、`appBundleRoots()`。现有代码不得散落裸写 `process.platform` | 新增模块有单测；全仓 `process.platform` 判定收敛到该层（或保留但语义明确）；`pnpm typecheck` 通过 | 新增 `src/main/util/platform.ts`；改造点见下表各行 |
| P0-2 | **资源根定位 darwin 分支** | `resolveResources.ts` 现有候选全是 Windows 语义（`app.asar.unpacked` + NSIS portable 的 `7z-out` 回退）；macOS 打包态 `process.resourcesPath` = `<App>/Contents/Resources`，需补 darwin 候选并确保 `7z-out` 分支只在 win32 出现 | macOS 打包后 `resourcesDir()` 命中 `<App>/Contents/Resources/app.asar.unpacked/resources`；`resourcesDirDebug()` 日志列出 darwin 候选 | `src/main/util/resolveResources.ts`、`src/main/util/paths.ts`、测试 `tests/resourcePath.spec.ts` |
| P0-3 | **JRE 存在性校验去 `.exe`** | `index.ts:200` 硬编码 `join(dir,'jvm','jre','bin','java.exe')`；`paths.ts:96` 的 debug 同样；darwin 应为 `jvm/jre/bin/java`（并兼容 `jre/Contents/Home/bin/java`） | macOS 启动日志 `java: OK/缺失` 判定正确；缺失时提示改为中性文案（不再写 `java.exe`） | `src/main/index.ts:197-205`、`src/main/util/paths.ts:93-101` |
| P0-4 | **mpv 内核 darwin 适配** | 三处耦合：① `mpvCore.ts:216-243` `buildMpvArgs` 硬编码 `--gpu-api=d3d11 --gpu-context=d3d11 --d3d11-feature-level=11_0`；② `MpvController.ts:131` IPC 用 Windows 命名管道 `\\.\pipe\...`；③ `MpvController.ts:73` / `mpvCore.ts:278` 内置路径 `resources/mpv/mpv.exe`；④ `MpvController.ts:38-46` `hwndOf()` 取 HWND 传给 `--wid` | darwin 分支：去掉 d3d11 三参、改用 `videotoolbox`/`auto-safe`；IPC 改 unix socket（`/tmp/winbox-mpv-<pid>-<seq>.sock`）；二进制名去 `.exe`；`--wid` 嵌入方案**必须先做可行性验证**（见 5.9 风险项 R1），不可行时 P0 降级为"macOS 仅 HTML5 内核 + MPV 入口隐藏并提示" | `src/main/player/mpvCore.ts`、`src/main/player/MpvController.ts`、`src/shared/player.ts:37`、测试 `tests/mpvCore.spec.ts`、`tests/mpvControllerLifecycle.spec.ts` |
| P0-5 | **ffmpeg/ffprobe 探测** | `HtmlMedia.ts:156/157/197` 硬编码 `resources/ffmpeg/ffprobe.exe`、`ffmpeg.exe`；仓库里 `resources/ffmpeg/` 只有 `README.txt`（Windows 静态构建，`.gitignore` 排除 `*.exe`），所以 macOS 上**本机探测是主路径** | darwin 先探测 `/opt/homebrew/bin`、`/usr/local/bin`、PATH，再回退 `resources/ffmpeg/ffprobe`；两者皆无时错误文案给出 `brew install ffmpeg` 指引 | `src/main/player/HtmlMedia.ts:150-205`、测试 `tests/htmlMedia.spec.ts` |
| P0-6 | **aria2c（BT 引擎）darwin** | `Aria2Sidecar.ts:120` `resources/aria2/aria2c.exe`；`:154` 只在 win32 传 `--stop-with-process`（macOS 无此参数，传了会启动失败） | darwin 不传 `--stop-with-process`，改用 `dispose()` kill + 退出兜底；二进制名去 `.exe`；缺文件时上层已有"未内置 BT 引擎"人话提示保持有效 | `src/main/torrent/Aria2Sidecar.ts:68-160`、`src/main/torrent/torrentPlay.ts:183`、测试 `tests/torrentSidecar.spec.ts` |
| P0-7 | **外部播放器 macOS 探测** | `externalPlayer.ts` 整份是 Windows 路径（`${ProgramFiles}\DAUM\PotPlayer\...`、`VideoLAN\VLC\vlc.exe`、`mpv.net`、`MPC-HC`），macOS 上 `detectPlayers()` 恒返回空 → 磁力/点播外部播放链路全断。另 `launchPlayer()` 直接 `spawn(path)`，macOS 需指向 `.app/Contents/MacOS/<bin>` | darwin 候选至少覆盖：`/Applications/VLC.app/Contents/MacOS/VLC`、`/Applications/IINA.app/Contents/MacOS/IINA`、`/Applications/mpv.app/Contents/MacOS/mpv`、`/opt/homebrew/bin/mpv`、`/usr/local/bin/mpv`、`~/Applications/*`；`seekArgs()` 为 macOS 播放器补充起播参数（VLC `--start-time`、mpv `--start`、IINA 走 mpv 参数）；配置页占位/提示文案改为平台中性 | `src/main/torrent/externalPlayer.ts:24-126`、`src/main/ipc/index.ts:604-651`、`src/renderer/pages/ConfigPage.tsx:154/166/204/1568/1596/1612`、测试 `tests/externalPlayer.spec.ts` |
| P0-8 | **数据目录语义 darwin 化** | `dataDir.ts:43-49` + `dataDirBootstrap.ts` 把 userData 搬到"安装目录/data"；macOS 打包态 `app.getPath('exe')` = `<App>/Contents/MacOS/Win-Box`，写 `<App>/Contents/data` **会破坏签名密封（Code Signing Seal）且常无写权限**。`paths.ts:12-17` 的 `localImportsDir()` 同样基于 `dirname(app.getPath('exe'))` → imports 会落进 `.app` 内部 | darwin：**不搬运**，userData 沿用 `~/Library/Application Support/Win-Box`（electron-builder 默认）；`localImportsDir()` darwin 取 `app.getPath('userData')/imports`；`ensureWritableDir()` 失败时 fallback 语义保持（已有）；`samePath()` 的大小写比较在 macOS 大小写敏感卷上需注明风险 | `src/main/util/dataDir.ts`、`src/main/util/dataDirBootstrap.ts`、`src/main/util/paths.ts:12-17`、测试 `tests/dataDir.spec.ts`、`tests/dataDirBootstrap.spec.ts`、`tests/appCacheDir.spec.ts` |
| P0-9 | **更新器识别 `.dmg`（含架构）** | `shared/update.ts:303 pickSetupAsset` 只 `/\.exe$/i`；`UpdateService.ts:99` 日志写"未找到 .exe 安装包"；`scripts/upload-release.mjs:34` 只挑 `.exe`；`UpdateService.ts:406 launch()` 用 `shell.openPath()` 直接拉起安装包 | darwin 资产选择：优先 `<name>-arm64.dmg`（Apple Silicon）/ `-x64.dmg`（Intel），回退任意 `.dmg`，再回退 `.zip`；`launch()` darwin 分支打开 dmg 后提示"请拖入 Applications 覆盖安装"；上传脚本支持 dmg | `src/shared/update.ts:298-315`、`src/main/update/UpdateService.ts:99/404-410`、`scripts/upload-release.mjs:30-45`、测试 `tests/update.spec.ts` |
| P0-10 | **应用生命周期：窗口全关不退出 + `Cmd+Q`** | `index.ts:266-269` 已是 `if (process.platform !== 'darwin') app.quit()`，但**同一处理里 `proxy.stop()` 对所有平台都执行** → macOS 关完窗口后代理被停、Dock 还活着，再点 Dock 打开的窗口无法播放。另 `index.ts:261-263` 的 `activate` 只建主窗口 | darwin：窗口全关**不停**本地代理（仅 `Cmd+Q`/`will-quit` 停）；`activate` 在无窗口时重建主窗口并恢复可见；`will-quit` 已有清理链（JVM/aria2/mpv/proxy）在 darwin 上同样生效 | `src/main/index.ts:261-308` |
| P0-11 | **macOS 构建配置（electron-builder）** | `package.json` 的 `build` 段只有 `win.icon: build/icon.ico`、`win.target:["nsis"]`、`nsis.*`，`appId` 为 `com.winbox.win`；无 `mac` 段；`build/icons/` 只有 PNG（16/24/32/48/64/128/256），**缺 `.icns`** | 新增 `build.mac`：`icon: build/icon.icns`、`target:["dmg","zip"]`、`category: public.app-category.video`、`hardenedRuntime: true`、`gatekeeperAssess: false`、`entitlements`/`entitlementsInherit` 占位、`darkModeSupport: true`、`artifactName` 含版本+arch；新增脚本 `dist:mac`（`electron-builder --mac`）；从现有 PNG 生成 `build/icon.icns` | `package.json`（`build` 段 + `scripts`）、新增 `build/icon.icns`、`build/entitlements.mac.plist`（占位） |
| P0-12 | **macOS 构建与签名/公证操作文档** | 现有 `scripts/build-release.mjs:37` 硬编码 `--win nsis`；`scripts/pack-*.ps1` 是 PowerShell 打包脚本（Windows-only）；README 的"发布附件"章节只讲 `.exe` | 新增 `docs/macos-build.md`：环境准备（Xcode CLT / Node / pnpm）、依赖二进制如何自备放入 `resources/<tool>/`、`pnpm dist:mac`、Developer ID 签名（`codesign --deep --options runtime`）、`xattr -cr` 去隔离属性、`notarytool` 公证与 stapling 的完整命令与前置条件、常见失败排查（ Gatekeeper / 嵌套二进制未签名 / dmg 资产命名） | 新增 `docs/macos-build.md`；改 `scripts/build-release.mjs`（支持 `--mac`）、`README.md`（发布附件章节补充 dmg） |
| P0-13 | **Windows 零回归护栏** | 所有改动必须可回归 | `pnpm typecheck` 通过、`pnpm test`（Vitest，当前约 1569 项）全绿且**不靠 skip 新增跳过**；Windows 端新增针对"platform 层在 win32 下返回值"的单测（exe 名含 `.exe`、候选路径含 Program Files 等），锁死 Windows 行为 | `tests/` 新增 `tests/platform.spec.ts` 等；CI/本地冒烟清单写入文档 |

### 3.2 P1（Should have）

| # | 需求 | 描述（含代码取证） | 验收标准 | 涉及模块 |
| --- | --- | --- | --- | --- |
| P1-1 | **应用菜单栏（macOS 必需）** | 当前所有窗口 `frame:false` + `autoHideMenuBar:true`，**没有任何菜单** → Mac 用户拿不到 `Cmd+Q`/`Cmd+W`/`Cmd+,`/编辑菜单（复制粘贴） | darwin 注册 `Menu.setApplicationMenu`（app 角色：关于/设置/隐藏/退出；Edit 角色：撤销/重做/剪切/复制/粘贴/全选；Window：最小化/缩放/关闭；Help）；`Cmd+W` 关当前窗口、`Cmd+Q` 退出应用 | 新增 `src/main/menu.ts`（或并入 `src/main/index.ts` 的 darwin 分支） |
| P1-2 | **自绘标题栏 darwin 变体** | `TitleBar.tsx` 已有 `variant='mac'`（左置红黄绿圆点，当前只给 Apple 皮肤用）；默认 `variant='win'` 是 Windows 右侧三钮。`frame:false` 时 macOS 拿不到原生红绿灯 | darwin 下所有窗口的 TitleBar 默认走 `mac` 变体：左侧交通灯、悬停显符号、双击标题栏 = zoom（而非 Windows 的 maximize 语义）、关闭 = 关窗口不退出 | `src/renderer/components/TitleBar.tsx:42-64`、`src/main/index.ts:115-138`、`src/main/player/PlayerWindow.ts:258-284`、`SearchWindow.ts`、`DetailWindow.ts` |
| P1-3 | **Dock 行为** | 无窗口时 Dock 图标点击需能重新开窗（`activate` 已覆盖主窗口，但播放器/详情/搜索窗口需一并考虑）；下载进度/播放态可做 Dock 徽标（可选） | Dock 点击能恢复；`app.dock` 相关 API 不报错；退出时 Dock 图标消失 | `src/main/index.ts:261-263`、`src/main/player/*Window.ts` |
| P1-4 | **macOS 原生全屏** | `PlayerWindow.ts` 的全屏逻辑大量针对"Windows 透明窗 `isFullScreen()` 不可靠"做补偿（`setResizable(false)`、事件旗标 `fullscreenActive`、手动恢复 bounds、1500ms 超时）；macOS 原生全屏（绿钮）走另一套 Space 切换语义 | darwin 分支验证：进入/退出原生全屏后窗口边界正确恢复、播放器控制条可见、mpv 视口同步（`updateViewport` 的 `video-margin-ratio-top`） | `src/main/player/PlayerWindow.ts:107-247`、`src/main/player/MpvController.ts:173-188` |
| P1-5 | **触控板与滚动手感** | 现有滚动/悬停（`hoverDelay.ts`、`HScrollRow`）按鼠标指针设计；macOS 触控板为惯性滚动、无 hover | 横向列表支持触控板两指横滑；惯性滚动不触发误点；悬停类面板（字幕/弹幕/音量）在触控板下保留点击入口（不依赖 hover-only） | `src/renderer/components/HScrollRow.tsx`、`src/renderer/lib/hoverDelay.ts`、`useHoverDelay.ts`、`src/renderer/styles/global.css` |
| P1-6 | **字体渲染与中文字形** | 渲染层字体栈需针对 macOS 校正（`-apple-system` / `PingFang SC` / `SF Pro`），否则中文在 Retina 下偏细/字形不一致 | darwin 下主字体栈加入 `PingFang SC`，数字/时间码用 `SF Mono`；4 套主题（apple/bilibili/douban/netflix）在 macOS 上对比度与字号无明显退化 | `src/renderer/styles/global.css`、`apple.css`、`netflix.css`、`bilibili.css`、`douban.css` |
| P1-7 | **Gatekeeper/首次打开引导** | 未公证或首次从网络下载时 macOS 会拦（"无法打开，因为它来自身份不明的开发者"/"已损坏"） | 应用内「说明」页与 README 增加"首次打开被拦怎么办"（右键→打开 / 系统设置→隐私与安全性→仍要打开）的图文步骤；发布物尽量已公证（G1） | `src/renderer/pages/AboutPage.tsx`、`README.md`、`docs/macos-build.md` |
| P1-8 | **Python 蜘蛛运行时 darwin** | `JarSpiderBridge.ts` 多处 Windows 假设：`python.exe`（`:1154/:1182/:1484/:1632/:1644`）、`Lib/site-packages`（`:1184`）、`PYTHON_EMBED_URLS`（Windows embeddable 包）、`PY_WHEELS` 全部 `win_amd64` / `cp311`（`:1589-1610`）；classpath 用 `;` 拼接（`:449`、`:714`）—— **Unix 必须用 `:`** | darwin：`python3`（内置或本机 `python3`）、site-packages 路径按 `lib/python3.x/site-packages`、wheel 平台标签按 `macosx_*_arm64`/`x86_64`、classpath 分隔符按平台；缺失时 py 源降级为 `PY_UNSUPPORTED` 人话提示（已有语义） | `src/engine/spider/JarSpiderBridge.ts:449/714/1150-1200/1470-1500/1560-1700`、测试 `tests/pythonRuntime.spec.ts`、`tests/pySpider.spec.ts` |
| P1-9 | **JVM 桥 darwin（java 名 + classpath 分隔符）** | `JarSpiderBridge.ts:428 javaExePath()` = `jvm/jre/bin/java.exe`；`:431-441 javaExe()` 的报错探针同样；`:449/:714` classpath `;` | darwin 二进制名 `java`、classpath 用 `:`；`jvmSpawnArgs` 相关单测补 darwin 场景 | `src/engine/spider/JarSpiderBridge.ts:426-460/700-860`、测试 `tests/jvmSpawnArgs.spec.ts`、`tests/jvmLoader.spec.ts`、`tests/jarResources.spec.ts` |
| P1-10 | **打包脚本平台化** | `scripts/build-release.mjs:37` 硬编码 `--win nsis`；`make-incremental.mjs`、`pack-*.ps1` 为 Windows 流程 | `build-release.mjs` 支持 `--mac dmg`（环境变量或 argv 选择平台）；新增 `dist:mac` npm script；Windows 流程零改动 | `scripts/build-release.mjs`、`package.json` |
| P1-11 | **测试平台化** | 现有单测多为 Windows 语义断言：`tests/mpvCore.spec.ts`、`externalPlayer.spec.ts`、`dataDir.spec.ts`、`dataDirBootstrap.spec.ts`、`jailDrive.spec.ts`、`resourcePath.spec.ts`、`update.spec.ts`、`torrentSidecar.spec.ts`、`pythonRuntime.spec.ts` | 关键纯函数以"注入 platform"方式补 darwin 用例（不依赖真实 macOS 机器即可跑）；darwin 断言覆盖：二进制名、IPC socket 路径、dmg 资产选择、候选路径、数据目录不进 `.app` | `tests/` 相关 spec |
| P1-12 | **架构与架构资产命名** | Apple Silicon / Intel 需区分 | dmg 命名含 `-arm64` / `-x64`；更新器（P0-9）按 `process.arch` 选择；文档说明 universal 构建的可选性 | `package.json`（`build.mac.target` + `artifactName`）、`src/shared/update.ts` |
| P1-13 | **内置二进制的签名与隔离属性** | macOS 对 `.app` 内**每个**嵌套可执行文件单独校验；从网络下载的二进制带 `com.apple.quarantine` | 构建流程先 `xattr -cr` 清隔离属性，再用 `codesign --options runtime --deep` 递归签名（含 mpv/ffmpeg/aria2c/java/python）；文档记录 | `docs/macos-build.md`、构建脚本 |

### 3.3 P2（Nice to have，可后置）

| # | 需求 | 描述 | 涉及模块 |
| --- | --- | --- | --- |
| P2-1 | **蜘蛛越界写盘的 macOS 兜底** | `jailDrive.ts` 的 `subst` 虚拟盘是 Windows 专有（`:114` 已对非 win32 返回空串静默降级）。macOS 上 jar 写 `/data/...` 会落到真实根目录（SIP 通常拒绝）→ 蜘蛛可能异常。可选方案：尝试 `unshare`/容器化开销大，建议**保持静默降级**并在日志提示 | `src/engine/util/jailDrive.ts`、测试 `tests/jailDrive.spec.ts` |
| P2-2 | **native-bridge（unidbg）darwin 构建** | `resources/jvm/native-bridge/build.ps1` 产出 Windows DLL；macOS 需 `.dylib` 且 unidbg 在 arm64 的可行性未验证。若不可行，受其影响的壳源在 macOS 上明确不支持并提示 | `resources/jvm/native-bridge/build.ps1`、`tests/nativeBridge.spec.ts` |
| P2-3 | **公证/上架自动化（CI）** | GitHub Actions 上跑 `pnpm dist:mac` + notarytool；需要 secrets（Developer ID 证书、App 专用密码） | 新增 `.github/workflows/`（占位） |
| P2-4 | **Universal 二进制（arm64 + x64 合一）** | 单个 dmg 覆盖两种架构；代价是体积翻倍 | `package.json` `build.mac.target` |
| P2-5 | **macOS 更新体验增强** | 下载 dmg 后自动挂载并引导替换（当前只 `openPath`）；或后续接入 Sparkle/`electron-updater` | `src/main/update/UpdateService.ts`、`src/shared/update.ts` |
| P2-6 | **webbridge 平台标识** | `webhomePreload.ts:137` 注入 `platform: 'win'`（模拟安卓客户端）。macOS 是否改为 `'mac'` 需评估第三方网页源兼容性（改了可能反而不兼容） | `src/main/webbridge/webhomePreload.ts` |
| P2-7 | **Homebrew Cask /  brew 分发** | 提供 `brew install --cask win-box` | 新建 cask 仓库（仓库外） |
| P2-8 | **系统能力增强** | 通知中心（下载完成/更新就绪）、Dock 徽标进度、Touch Bar（已无新机型，可不做）、`open-file`/`open-url` 事件处理（macOS 用这两个而非仅 `second-instance`） | `src/main/index.ts:315-326` |
| P2-9 | **输入法（IME）候选框** | macOS 中文输入法候选框跟随与无边框窗口的兼容性验证 | 渲染层输入框相关组件 |

---

## 4. UI / 交互差异项（macOS 特有）

| # | 项 | 现状（Windows 行为） | macOS 目标行为 | 涉及文件 |
| --- | --- | --- | --- | --- |
| 4.1 | **菜单栏** | 无菜单（`frame:false` + `autoHideMenuBar`） | 必须有应用菜单：关于 / 设置…(`Cmd+,`) / 服务 / 隐藏 / 退出(`Cmd+Q`) + Edit + Window + Help | 新增 `src/main/menu.ts` |
| 4.2 | **`Cmd+W` / `Cmd+Q` 语义** | 无；关闭 = 关窗口即可能退出 | `Cmd+W` = 关当前窗口（播放器窗口关了应用还在）；`Cmd+Q` = 退出并走完整清理 | `src/main/index.ts`、`src/main/menu.ts` |
| 4.3 | **红绿灯 vs 自绘标题栏冲突** | `TitleBar` 默认 Windows 右侧「最小化/最大化/关闭」 | darwin 默认 `variant='mac'`：左置交通灯（关/最小/缩放），双击标题栏 = zoom；不再渲染右侧三钮；播放器窗口的「小窗口/置顶」按钮在 mac 变体下需另找位置（不能挤占交通灯区） | `src/renderer/components/TitleBar.tsx`、`src/renderer/pages/PlayerPage.tsx` |
| 4.4 | **窗口全关 = 不退出** | `index.ts:268` 非 darwin 即 `app.quit()` | darwin 保留进程 + Dock 常驻；`activate` 重建窗口；`proxy.stop()` 不得在窗口全关时调用 | `src/main/index.ts:261-269` |
| 4.5 | **Dock** | 任务栏图标 | Dock 图标点击恢复窗口；可显示下载/播放徽标（P2）；老板键隐藏窗口时 Dock 表现需验证 | `src/main/index.ts`、`src/main/bossKey.ts` |
| 4.6 | **全屏行为** | Windows 最大化/原生全屏 + 手动 bounds 补偿 | macOS 原生全屏（独立 Space）；透明播放器窗 + mpv 嵌入下的进入/退出需单独验证；退出全屏后窗口边界与控制条恢复正确 | `src/main/player/PlayerWindow.ts`、`MpvController.ts:173-188` |
| 4.7 | **触控板** | 鼠标 hover + 滚轮 | 惯性滚动、两指横滑（横向片单）、`hoverDelay` 悬停面板需有点击兜底 | `src/renderer/components/HScrollRow.tsx`、`src/renderer/lib/hoverDelay.ts` |
| 4.8 | **字体渲染** | Windows 字体栈 | 加入 `-apple-system` / `PingFang SC` / `SF Mono`；Retina 下字重与行高复核（4 套主题） | `src/renderer/styles/*.css` |
| 4.9 | **Gatekeeper 首次打开提示** | 无 | 未公证时系统拦截；应用内说明页 + README 给出"右键→打开 / 隐私与安全性→仍要打开"步骤 | `src/renderer/pages/AboutPage.tsx`、`README.md`、`docs/macos-build.md` |
| 4.10 | **窗口外观** | `backgroundMaterial:'mica'`（win32 专有，已条件化） | darwin 可选 `vibrancy`（需评估：播放器窗是透明窗，加 vibrancy 可能影响 mpv 透出）；`backgroundColor` 按 `nativeTheme` 已支持 | `src/main/index.ts:118-131`、`src/main/player/SearchWindow.ts`、`DetailWindow.ts` |
| 4.11 | **圆角修复** | `applyWindowCorner` 用 PowerShell + dwmapi（`:11` 已 win32 守卫） | darwin 直接 no-op（已满足），确认无 PowerShell 调用路径残留 | `src/main/util/windowCorner.ts` |
| 4.12 | **配置页文案平台化** | "播放器 exe 路径"、"PotPlayer / VLC / mpv / MPC-HC"、"mpv.exe 路径覆盖"、"Windows 设置→辅助功能→视觉效果" | darwin 改为"播放器路径 / 应用程序路径"、"VLC / IINA / mpv"，示例路径给 macOS 路径 | `src/renderer/pages/ConfigPage.tsx:149-210/1490/1568/1596/1612/1654` |
| 4.13 | **文件/目录选择对话框** | `dialog` 默认行为 | 确认在 macOS 上默认目录合理（`~/Downloads` / `~/Movies`），网盘转存落盘目录选择可用 | `src/main/ipc/index.ts`（dialog 相关）、`src/main/store/*` |
| 4.14 | **全局快捷键** | `CommandOrControl+Shift+B`（老板键）在 mac 上映射为 `Cmd+Shift+B`，可用 | 确认与系统快捷键（如 `Cmd+Shift+B` 未被占用）不冲突；`globalShortcut` 在 macOS 权限下可用 | `src/main/bossKey.ts:11` |

---

## 5. 非目标（Out of Scope）

本次**明确不做**：

1. **不做 Mac App Store 上架**（沙盒化会破坏本地代理、子进程 spawn、写盘等核心机制，成本远超收益）。
2. **不做 iOS / iPadOS / 移动端版本**。
3. **不重写播放内核**：MPV 与 HTML5 双内核架构保持；不引入新的播放器实现（如 libmpv Node 原生绑定）——除非 P0-4 的 `--wid` 可行性验证失败，此时也只做"MPV 入口降级"而不重写。
4. **不改变 Windows 的任何既有行为**（数据目录、更新、播放器、BT、老板键、UI 布局、文案），不"顺手重构"公共逻辑。
5. **不做数据格式迁移 / 不做跨平台数据同步**（Windows 与 macOS 的配置不互通）。
6. **不重实现 JVM 蜘蛛的逆向能力**：unidbg/native-bridge 若无法在 macOS 构建，只做"该能力不可用"的提示，不另造轮子（P2-2）。
7. **不做 Windows 打包脚本（PowerShell）的删除或重写**：新增 macOS 路径，Windows 流程原样保留。
8. **不做性能优化专项**（首帧、内存、4K 硬解调优），只保证功能可用；Apple Silicon 上 VideoToolbox 硬解能开即可。
9. **不做国际化**（中文本地化之外的语言）。
10. **不改动 `docs/` 之外的既有文档结构**（注：`.gitignore` 已忽略 `docs/`，本目录内容不随源码分发）。

---

## 6. 风险与待用户拍板的问题

### 6.1 风险项（需架构/开发阶段实测）

| # | 风险 | 说明 | 建议 |
| --- | --- | --- | --- |
| R1 | **mpv 在 macOS 上能否 `--wid` 嵌入 Electron 窗口** | Windows 走 `--wid=<HWND>`（mpvCore.ts:232）。macOS（Cocoa/vo=gpu）对 `--wid` 的支持需实测：官方 mpv macOS 构建是否接受 NSView 指针、是否需要 libmpv 渲染接口 | **先做 1 天可行性验证**：支持 → 走 P0-4 完整方案；不支持 → P0-4 降级为"macOS 仅 HTML5 内核，MPV 入口隐藏并说明"，外部播放器接力（P0-7）成为高兼容路径 |
| R2 | **透明播放器窗 + macOS 原生全屏** | `PlayerWindow.ts` 大量 Windows 透明窗补偿逻辑，macOS 全屏走独立 Space，行为不同 | P1-4 实测后调整；必要时 darwin 走简化全屏路径 |
| R3 | **内置依赖二进制的架构与签名** | mpv/ffmpeg/aria2c/java/python 需 macOS 版（arm64/x64），且每个都要签名，否则 Gatekeeper 逐个拦截 | 构建文档强制 `xattr -cr` + `codesign --deep --options runtime`；优先"自动探测本机"（策略 2）降低内置依赖 |
| R4 | **JVM/Python 蜘蛛在 macOS 的可用性** | JRE 需 macOS 版（jlink 裁剪镜像）、Python wheel 需 `macosx_*` 标签、unidbg native bridge 需 `.dylib` | P1-8/P1-9 做；不可用的壳/py 源明确降级提示，不作为 P0 阻塞 |
| R5 | **写入 `.app` 内部导致签名失效** | P0-8 已列为 P0；若漏改，用户首次能跑、更新后必崩 | 单测锁死："darwin 下数据目录/imports 不含 `.app`" |

### 6.2 待确认问题（需用户拍板）

| # | 问题 | 备选方案 | 影响 |
| --- | --- | --- | --- |
| Q1 | **是否有 Apple Developer 账号（付费，¥688/年）用于 Developer ID 签名 + 公证？** | A. 有 → 完整签名+公证（推荐，用户双击即可打开）；B. 没有 → 只做 ad-hoc/自签名，用户需"右键→打开"，文档兜底 | 决定 G1 能否达成、P1-13 工作量 |
| Q2 | **首版 macOS 交付哪些架构？** | A. 仅 arm64（Apple Silicon，覆盖绝大多数在用机型）；B. arm64 + x64 两个 dmg；C. Universal 单包（体积翻倍） | 决定 P1-12 与更新器资产选择逻辑 |
| Q3 | **macOS 上是否必须提供 MPV 内核？** | A. 必须（若 R1 不可行则需评估引入 libmpv 原生绑定的额外成本）；B. 可降级为仅 HTML5 + 外部播放器接力 | 决定 P0-4 的验收口径与工作量 |
| Q4 | **macOS 的数据目录放哪？** | A. `~/Library/Application Support/Win-Box`（macOS 规范，推荐）；B. 沿用"安装目录/data"语义（会写进 `.app`，**不推荐**）；C. 用户可在配置页自选 | 决定 P0-8 实现 |
| Q5 | **内置依赖的兜底范围**：哪些必须随包内置（即使体积变大）？ | 建议：aria2c（BT 刚需，体积小）内置；mpv/ffmpeg/java/python3 只探测本机 + 文档指引 `brew install`；若用户要求"开箱即用"则需自备全部 macOS 二进制 | 决定 dmg 体积与 P0-5/P0-6/P1-8 实现深度 |
| Q6 | **外部播放器候选清单以哪个为准？** | 建议 VLC / IINA / mpv（`/Applications` + Homebrew）；是否要支持 QuickTime、Elmedia、Movist、nPlayer 等？ | P0-7 范围 |
| Q7 | **macOS 版的产品名与 appId 是否沿用？** | 当前 `productName: "Win-Box"`、`appId: com.winbox.win`。macOS 上"Win-Box"这个名字与 `com.winbox.win` 可能引发困惑；是否改名（如 `Win-Box` 不变、`appId` 改 `com.winbox.app`）？**注意：`appId` 变更会影响更新器与数据目录** | 影响 P0-11、P0-9 |
| Q8 | **自动更新在 macOS 上做到哪一步？** | A. 下载 dmg + 打开 + 文字引导手动覆盖（P0 方案，简单可靠）；B. 完整静默替换安装（需提权/额外工具，复杂）；C. macOS 上不做强制更新，仅提示跳转 Release 页 | 决定 P0-9 的 UI 与工作量 |
| Q9 | **是否接受"macOS 上 JVM/py 系部分源不可用"？** | 若 JRE/native bridge/wheel 在 macOS 上无法齐备，部分第三方 jar/py 源会不可用 | 决定 R4 的降级文案与是否列入已知边界 |
| Q10 | **发布节奏**：macOS 版与 Windows 版是否共用同一个版本号与 Release？ | 建议共用版本号、Release 下同时挂 `.exe` 与 `.dmg`（`upload-release.mjs` 需改造） | 影响 P0-9 / P1-10 |

---

## 7. 附：本次改动涉及文件总览（便于架构师拆解）

**主进程**
- `src/main/index.ts`（窗口选项 `:118-138`、JRE 校验 `:197-205`、生命周期 `:261-308`、单实例 `:315-326`）
- `src/main/util/paths.ts`、`resolveResources.ts`、`dataDir.ts`、`dataDirBootstrap.ts`、`windowCorner.ts`
- `src/main/player/mpvCore.ts`、`MpvController.ts`、`HtmlMedia.ts`、`PlayerWindow.ts`、`SearchWindow.ts`、`DetailWindow.ts`
- `src/main/torrent/Aria2Sidecar.ts`、`externalPlayer.ts`、`torrentPlay.ts`
- `src/main/update/UpdateService.ts`
- `src/main/ipc/index.ts`（外部播放器探测 `:604-651`、图标 `:124`）
- `src/main/spider/SpiderHost.ts`（jvmDir/jsLibDir 注入 `:341-362`）、`driveCookieFiles.ts`
- 新增：`src/main/util/platform.ts`、`src/main/menu.ts`

**引擎层**
- `src/engine/spider/JarSpiderBridge.ts`（java 路径 `:426-460`、classpath `:449/:714`、Python `:1140-1700`）
- `src/engine/util/jailDrive.ts`（已 win32 守卫，仅确认）
- `src/engine/config/localPkg.ts:45`（已平台感知，仅确认）
- `src/shared/update.ts:298-315`

**渲染层**
- `src/renderer/components/TitleBar.tsx`、`HScrollRow.tsx`
- `src/renderer/pages/ConfigPage.tsx`、`AboutPage.tsx`
- `src/renderer/lib/hoverDelay.ts`、`useHoverDelay.ts`
- `src/renderer/styles/*.css`

**构建与资源**
- `package.json`（`build.mac` / `scripts`）
- `scripts/build-release.mjs`、`scripts/upload-release.mjs`
- 新增：`build/icon.icns`、`build/entitlements.mac.plist`、`docs/macos-build.md`
- 自备（不入库）：`resources/mpv/mpv`、`resources/ffmpeg/{ffmpeg,ffprobe}`、`resources/aria2/aria2c`、`resources/jvm/jre/bin/java`

**测试**
- `tests/mpvCore.spec.ts`、`mpvControllerLifecycle.spec.ts`、`htmlMedia.spec.ts`、`torrentSidecar.spec.ts`、`externalPlayer.spec.ts`、`dataDir.spec.ts`、`dataDirBootstrap.spec.ts`、`resourcePath.spec.ts`、`update.spec.ts`、`jailDrive.spec.ts`、`pythonRuntime.spec.ts`、`pySpider.spec.ts`、`jvmSpawnArgs.spec.ts`、`jvmLoader.spec.ts`、`appCacheDir.spec.ts`
- 新增：`tests/platform.spec.ts` 及上述各 spec 的 darwin 用例
