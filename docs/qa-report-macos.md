# Win-box macOS 适配 — QA 验收报告（最终）

- **角色**：严过关（Yan）· QA 工程师
- **验证范围**：P0 全部 13 项 + P1-1/-2/-3/-4/-6/-7/-8/-9/-10/-11/-12（P2 未做，不在范围）
- **验证方式**：全量单测基线 + 逐点源码走查（非仅看测试结果）+ 测试充分性复核与补测
- **验证依据**：`docs/prd-macos.md` / `docs/architecture-macos.md` / `docs/macos-build.md`
- **代码状态**：**src/ 已冻结**（team-lead 宣布）。本报告结论基于冻结后的最终代码。
- **验证主机**：Windows（**非 macOS**）。下文「真机验证项」为无法在本机跑通的项，代码分支已就位，**不判失败**。

---

## 一、测试基线（冻结后最终版）

命令（两个 timeout 都抬高，因 `--testTimeout` 只作用于用例体、不作用于 hook；hook 由 `hookTimeout` 管辖）：

```
npx vitest run --testTimeout=20000 --hookTimeout=30000
```

| 指标 | 数值 |
|---|---|
| Test Files | **145 passed \| 2 skipped (147)** |
| Tests | **1860 passed \| 7 skipped (1867)** |
| Failed | **0** |
| Duration | 17.83s / 17.86s（连续两次一致） |

**类型检查**：`npx tsc --noEmit` → **exit 0**（冻结前后各跑一次，均 0）。

**关于「偶发 Test timed out in 5000ms」**：确认为**非回归 flaky**。基线并行跑时偶发 `dataDir.spec.ts` / `jarContentIndex.spec.ts` / `jarResources.spec.ts` 的 **`Hook timed out in 10000ms`**（hook 超时，非断言失败）；每次失败用例**不固定**，**无一条 AssertionError**，单跑必过（已验证 28/28、19/19 全绿）。根因：1864 用例高并发 + 真实磁盘 I/O 争用。抬高 `hookTimeout` 后全量两次稳定 0 failed。**未改 `vitest.config.ts`**（遵守「保留 5s 默认以保持挂起敏感度」的裁定）。

---

## 二、20 条验收点逐条结论

> 全部在代码中逐点打开核对，非依赖测试绿灯。除标注外均为 **✅ 确认通过**。

| # | 验收点 | 结论 | 证据（file:line） |
|---|---|---|---|
| 1 | win32 `buildMpvArgs` 逐项/顺序不变（含 d3d11 三参数） | ✅ | `src/main/player/mpvCore.ts` `mpvVideoArgs()` win32 返回 `['--hwdec=auto-safe','--vo=gpu','--gpu-api=d3d11','--gpu-context=d3d11','--d3d11-feature-level=11_0']`；`buildMpvArgs` 在 `--keep-open=yes` 后展开；`tests/mpvCore.spec.ts:74-95` 精确数组断言 |
| 2 | `externalPlayer.playerCandidates()` win32 候选逐项不变 | ✅ | `src/main/torrent/externalPlayer.ts` `winCandidates(env)` 13 条（PotPlayer/VLC/mpv.net/MPC-HC 全路径）逐条一致；`tests/externalPlayer.spec.ts:109-132` |
| 3 | `resolveResources` win32 候选逐项不变（含 portable `7z-out` 三层） | ✅ | `src/main/util/resolveResources.ts` `resourceRootCandidates` portable 分支原样保留；`tests/resourcePath.spec.ts:105-122` |
| 4 | `aria2Args` win32 有 `--stop-with-process=<pid>`、darwin 无 | ✅ | `src/main/torrent/Aria2Sidecar.ts` 该参数以 `isWin(platform)` 门控 |
| 5 | `package.json` `build.win`/`nsis`/`appId`/`productName` 逐字节不变 | ✅ | `appId: com.winbox.win`、`productName: Win-Box`、`win.target:["nsis"]`、`nsis` 块未改，仅**新增** `mac` 块 |
| 6 | `build-release.mjs` 无参仍输出 `--win nsis` | ✅ | `scripts/build-release.mjs:21-25` `target = argv.includes('--mac') ? 'mac' : 'win'`；无参 → `['--win','nsis','--publish','never']` |
| 7 | `UPDATE_INSTALL` win32 返回体**不含 `hint` 键**（键缺失，非 `hint:''`） | ✅ | `src/main/ipc/index.ts:698` `return { ok: true, path, ...(r.hint ? { hint: r.hint } : {}) }` — 条件展开；:694 `shouldQuitAfterLaunchingInstaller()` win32=true 提前 `app.quit` |
| 8 | `dataDir`/`dataDirBootstrap` win32 不变；darwin `activate===false` 且不写 `.app` | ✅ | `src/main/util/dataDir.ts` `planDataDir`：`!shouldRelocateUserData(...)` → `{legacy, target: legacy, activate:false}`；`dataDirBootstrap.ts` `if(!plan.activate) return {mode:'dev'...}` |
| 9 | `JarSpiderBridge` 真实 classpath 全站点 darwin 用 `:`；缓存键仍 `;` | ✅ | `cpJoin():485-486 → joinClasspath`；调用站点 `:764`(d2jCp)/`:851`(-cp)/`:1183`(runtimeCp)/`:1187`(loadCp)/`:1495`(runtimeCp)/`:1502`(loadCp)/`:2185`(-Dtvbox.d2j.cp) **全部**走 `cpJoin`；`keyJoin():493` 永久 `parts.join(';')`，调用 `:1175/:1406/:1428/:1479`。（**这正是历史上翻车的 4 处外围站点，已逐一确认无遗漏**） |
| 10 | `mpvCore` darwin 无 d3d11 参数 | ✅ | `mpvVideoArgs` darwin 返回 `['--vo=gpu','--gpu-api=auto','--gpu-context=auto','--hwdec=auto-safe']` |
| 11 | `MpvController` IPC：win32 `\\.\pipe\...`、darwin `.sock`；失败走 `embedFailed` 降级不挂起 | ✅ | `startInternal` 用 `mpvIpcPath({pid,seq,nonce})`；`!isWin()` 时先删陈旧 socket；连接失败置 `embedFailed` 并在非 win 抛中文错误 |
| 12 | `HtmlMedia.resolveFfmpeg` darwin 提示含 `brew install ffmpeg`；win32 仍原文「缺少随包媒体兼容组件」 | ✅ | `src/main/player/HtmlMedia.ts` `resolveFfmpeg` 双分支文案 |
| 13 | `Aria2Sidecar.exePath()` darwin 无 `.exe`；`resolveExe()` 内置/Homebrew 兜底 | ✅ | `exePath(p) → exeName('aria2c',p)`；`resolveExe(p) → probeTool` |
| 14 | `update.pickInstallerAsset` darwin 顺序 `-arch.dmg → 版本 dmg → 任意 dmg → zip → null`；win32 ≡ 原 `pickSetupAsset` | ✅ | `src/shared/update.ts` `pickInstallerAsset` 按平台分发；`pickMacInstaller` 顺序正确；`pickSetupAsset` 委托 win32 别名 |
| 15 | `probeTool()` 顺序 `①override → ②system → ③bundled → ④none`；头注释同步 | ✅ | `src/main/util/toolProbe.ts`：`if(o.allowSystem!==false)` 的 system 在前、bundled 在后；头注释一致。（**次要文档瑕疵**见第六节） |
| 16 | `window-all-closed` darwin **不退出也不停代理**；清理链统一在 `will-quit` | ✅ | `src/main/index.ts` `if(!shouldStopProxyOnLastWindowClosed()) return; proxy.stop(); if(shouldQuitOnLastWindowClosed()) app.quit();`；`activate` 重建窗口 |
| 17 | `src/renderer/**` 无直接读 `process.platform`（走 `isMacRenderer()`/IPC） | ✅ | 全目录检索无直接 `process.platform` 读取；`src/renderer/lib/platform.ts` 经 `client.platform()` IPC 缓存 |
| 18 | `.gitignore` `docs/**` + 三条 `!docs/xxx.md` 白名单生效 | ✅ | 本目录无 `.git`，建临时探针仓库验证：`docs/prd-macos.md`/`architecture-macos.md`/`macos-build.md` = **NOT-IGNORED**；`docs/交付说明.md`/`站点分析.md`/`readme.txt`/`resources/mpv/mpv` = **IGNORED** |
| 19 | 两份 `build/entitlements.mac.plist` 合法且键符合预期 | ✅ | `fast-xml-parser#XMLValidator.validate` → 均为 **VALID XML**；main：4 个 `true` + `audio-input=false`；inherit：5 个 `true` |
| 20 | `scripts/make-icon.mjs` 非 macOS 给出明确中文错误并 exit 1 | ✅ | Windows 实跑 `node scripts/make-icon.mjs` → 中文报错，**EXIT=1**（非静默失败） |

**20/20 全部确认通过。**

---

## 三、冻结后两处新改动核查（team-lead 指定）

### (a) `Cmd+,` 直达配置页（渲染层新增约 5 行）

- `src/shared/ipc-channels.ts:130` `UI_GOTO_SETTINGS: 'ui:gotoSettings'` ✅
- `src/main/preload.ts:84-88` `config.onGotoSettings(cb)`：`ipcRenderer.on(UI_GOTO_SETTINGS, l)` 并 **return 退订函数** ✅
- `src/renderer/api/client.ts:109` 类型补 `onGotoSettings: (cb)=>()=>void`；`:328` 导出包装**直接透传** preload 退订函数 ✅
- `src/renderer/App.tsx:316-322` `useEffect`：`if (loc.pathname==='/player' || isDetailWindow() || isSearchWindow()) return;`（**显式排除**播放器窗与详情/搜索子窗）→ `client.onGotoSettings(()=>nav('/config'))`，cleanup 即退订 ✅
- **覆盖率**：`tests/preloadApiContract.spec.ts` 会扫描渲染层所有 `window.api.X.Y` 引用并比对 preload 分组 —— 新增的 `window.api.config.onGotoSettings` 受该**契约测试**保护（挂错组/漏挂会红）。但 **App.tsx 的 React 行为本身无单测**（该文件在测试里仅被 `detailEpisodeIntent.spec.ts` 以**文本扫描**方式引用，无渲染级用例）。**如实标注：此为结构性/契约级覆盖，非行为级覆盖。**

### (b) `src/main/index.ts` `onPreferences`（darwin-only 真 bug 修复）

- `:279` `if (!mainWindow || mainWindow.isDestroyed()) createWindow();` —— **锚定 `mainWindow`**，仅缺失/已销毁才重建 ✅
- `:281-283` 只向 `mainWindow` 发 `IPC.UI_GOTO_SETTINGS`（不再是 `getAllWindows()` 广播）✅
- `:287-289` 只对 `mainWindow` `restore()/show()/focus()` ✅
- **对 Windows 零暴露面**：`installApplicationMenu()` 在非 darwin 内部直接 no-op（`src/main/menu.ts`），`onPreferences` 永不触发 ✅

### ⚠️ 次要观察（LOW，非阻塞，真机/darwin-only）

**首按竞争**：`createWindow()` 在 `:151` 同步赋值 `mainWindow`，但渲染层要到 React 挂载后才订阅 `UI_GOTO_SETTINGS`。`onPreferences` 在 `createWindow()` 返回后**同步** `webContents.send()`（`:283`），此时新窗渲染层尚未订阅 → **「主窗已关 → 首次按 Cmd+,」** 这一序列下，窗口会重建并前置，但**当次不跳配置页**（再按一次即正常跳转）。
- 属 **macOS-only 边界序列**，**非回归**（旧逻辑同样存在该竞态），且窗口重建+前置本身已是可见反馈。
- 因 src 已冻结、影响极低，**建议降级为「已知遗留」，不要求当场修复**。

---

## 四、测试充分性评估与补充用例

### 已覆盖 darwin 分支的关键 spec（抽检确认）
`tests/platform.spec.ts`（平台层单点）、`toolProbe.spec.ts`（①→②→③→④）、`resourcePath.spec.ts`（资源根双平台）、`externalPlayer.spec.ts`（win13/darwin 候选）、`dataDir*.spec.ts`（不迁移）、`mpvCore.spec.ts`（d3d11 有无）、`jvmSpawnArgs.spec.ts`（classpath `:`/`;`）、`pythonRuntime.spec.ts`（`python3`）、`update.spec.ts`（资源挑选顺序）、`preloadApiContract.spec.ts`（前后端 API 契约）。

### 我补充的用例（QA 边界内，冻结不限制测试文件）
- **新增** `tests/updateServiceLaunch.spec.ts`（3 个用例），补齐此前**空缺**的 `UpdateService.launch()` 平台分支覆盖：
  1. win32 → `{ok:true, hint:''}`
  2. darwin → `hint` 非空且含「应用程序」与 `.dmg`（拖拽引导）
  3. `shell.openPath` 报错 → `{ok:false, error}`
  - 写法：`vi.hoisted` mock `shell.openPath`、`vi.mock` 隔离 `electron`/`paths`/`proxy`；`afterEach(() => setPlatformForTest(null))` 清理，**显式 pin 平台**，杜绝跨 spec 污染。
  - 结果：单跑 3/3 通过；并入全量后基线由 1864 → 1867（+3）。

### 结论
darwin 关键分支覆盖**充分**；唯一显式缺口为 **App.tsx 的 `Cmd+,` 交互行为**（渲染级），已由契约测试部分兜底并在第三节如实标注。

---

## 五、智能路由判定

| 发现 | 判定 | 路由 |
|---|---|---|
| 20 条验收点 | 全部确认通过 | — |
| 全量测试 0 failed（两次一致） | 通过 | **Send To: NoOne（成功）** |
| `docs/macos-build.md` §2.2 探测顺序与代码不一致（文档旧序） | 文档瑕疵，非代码缺陷 | 记录为遗留（文档），**不改代码** |
| `onPreferences` 首按竞争（darwin-only） | 极低影响、非回归 | **降级为「已知遗留」**，不解冻 |
| App.tsx `Cmd+,` 交互无渲染级单测 | 覆盖率缺口（非缺陷） | 记录，契约测试部分兜底 |

**未发现需要返工给工程师的源码缺陷（0 条源码 bug）。** 本轮不计入「源码 bug → Engineer」路由。

---

## 六、遗留问题清单

### 真机验证项（Windows 主机无法执行，代码分支已就位，**不判失败**）
1. `pnpm dist:mac` 真实 dmg 构建 / 公证 / 签名
2. mpv `--wid` NSView 嵌入（风险 R1；已备 `WINBOX_MAC_MPV_EMBED=0` 开关 + `embedFailed` 自动降级）
3. 透明窗口 + 原生全屏
4. Dock 行为（关主窗不退出、`activate` 重建）
5. TitleBar mac 变体版式
6. Retina 字体渲染
7. Gatekeeper 首次打开 / 公证分发
8. `Cmd+W` / `Cmd+Q` / `Cmd+,` 实机手感
9. macOS 上 JVM / Python 蜘蛛端到端

### 已知遗留（本机可判定，非阻塞）
- **L1（文档）**：`docs/macos-build.md` §2.2 把探测顺序写成「② 随包内置 ③ 本机探测」，与实际代码（② system ③ bundled）**相反**。代码正确、文档待同步。
- **L2（darwin-only 边界）**：`onPreferences` 首按 `Cmd+,`（主窗已关时）当次不跳配置页（见第三节 ⚠️）。
- **L3（覆盖率）**：App.tsx `Cmd+,` 交互无渲染级单测（契约测试部分覆盖）。

### 浮点说明
- 本目录**非 git 工作副本**（无 `.git`），未执行任何 git 操作；`.gitignore` 例外经临时探针仓库验证。

---

## 七、结论

> **可以交付。**

- P0 全部 13 项 + P1 指定 11 项 **逐点走查确认通过**；
- 冻结后全量 **0 failed**（连续两次一致），`tsc` **exit 0**；
- 未发现任何需返工的**源码缺陷**；
- 遗留项均为「真机验证项」或「极低影响已知项」，**不构成交付阻塞**。

**建议**：交付 macOS 产物前，在**真实 Mac 上**执行第六节真机项清单做最后一道物理确认；其中 mpv `--wid` 嵌入（R1）需重点观察，必要时走 `WINBOX_MAC_MPV_EMBED=0` 降级路径。

---

*报告人：严过关（Yan）· QA 工程师 ｜ 本报告为冻结版本最终结论，未修改任何 src/ 代码。*
