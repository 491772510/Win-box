import { app } from 'electron';
import { fileLogger } from './logger';

/**
 * ★ 2026-10-13：**重启应用**（主进程唯一的重启实现，两个入口共用）。
 *
 * <h3>为什么单独一个模块</h3>
 * 两个触发源都要用它，而它们分处不同的依赖方向：
 * <ul>
 *   <li><b>源侧自动重启</b>（加固壳 wex 网页配置中心「恢复配置后自动重启」）：
 *       `stubs-src/android/content/Context.startActivity` 打 stderr 信令 →
 *       `JarSpiderBridge.noteBridgeLog` → `EngineHost.requestAppRestart` →
 *       `SpiderHost.onAppRestartRequest`（由 `main/index.ts` 注入本函数）。
 *       —— `SpiderHost` 刻意不 import electron（保可测试性），所以实现放在这里。</li>
 *   <li><b>渲染层一键重启</b>（配置页「导入设置备份」还原后）：`IPC.APP_RESTART` → 本函数。</li>
 * </ul>
 * 放在 `main/index.ts` 里会被 `main/ipc/index.ts` 反向 import 成环，故独立成模块。
 *
 * <h3>★ 为什么开发模式不走进程级重启（2026-10-13 真机事故）</h3>
 * `npm run dev` 由 **`concurrently -k`** 驱动（vite + build-main --watch + electron）。
 * `-k` 的语义是「任一命令退出就杀掉其余命令」——electron 一退出，vite 立刻被杀。
 * 而 `app.relaunch()` 只是按 `process.argv.slice(1)`（即 `electron .`）拉起一个新实例，
 * **它不会把 vite 一起重建**，新实例 `loadURL('http://localhost:5173')` 连不上，
 * 表现为「窗口关掉了、但再也没起来」。事故日志止于「应用即将重启」这一行，
 * 新实例连一行日志都没来得及写。
 *
 * 故开发模式改走**软重启**（见 `setSoftRestartHandler`）：终止全部蜘蛛 JVM +
 * 重载界面，不退出进程。源侧恢复的配置写在沙箱文件里，下一次调用会重新拉起 JVM 并重读，
 * 与真重启等效；打包模式语义一字不变。
 *
 * <h3>为什么打包模式是 relaunch + quit，不是 exit</h3>
 * `app.exit()` **跳过** `will-quit`：那一步负责终止全部蜘蛛 JVM、停本地代理、停 aria2c
 * sidecar、清夸克待删队列、并把历史/进度写盘（见 main/index.ts 的 will-quit）。
 * 跳过它 → 重启后可能留下孤儿 JVM / aria2c 进程，或丢最后一段观看历史。
 * `app.quit()` 会走完整清理链路（且渲染层的 beforeunload 刷盘也会被触发）。
 * `app.relaunch()` 是「当前实例退出后拉起新实例」，因此不会与单实例锁打架。
 *
 * <h3>为什么要等 1.5s</h3>
 * 源侧重启的瞬间，蜘蛛 JVM 可能正在写「恢复成功」的 HTTP 响应体；立刻退出会让浏览器
 * 拿到半截响应（用户以为失败）。留一点时间把结果送出去，与既有
 * `IPC.UPDATE_INSTALL` 拉起安装包后的 1.5s 节奏一致。
 */

/** 软重启（不退出进程）的实现，由 `main/index.ts` 注入 —— 本模块不反向依赖 host / BrowserWindow。 */
let softRestartHandler: (() => void) | null = null;

export function setSoftRestartHandler(fn: () => void): void {
  softRestartHandler = fn;
}

/**
 * ★ 2026-10-13 事故第二条根因：**进程级重启时，绝不能在 `will-quit` 里异步挂起**。
 *
 * `app.relaunch()` 的真实机制不是「退出后由 Electron 拉起」，而是**立刻** spawn 一个
 * `--type=relauncher` 的中间进程（真机取证：PID 15984，父进程 = 旧主进程，命令行
 * `electron.exe --type=relauncher --- electron.exe .`）。relauncher 的唯一职责是
 * **轮询等待父进程真正退出**，然后再拉起新实例。
 *
 * 于是：只要本进程退出流程没走完，relauncher 就一直等 → 新实例永远不起来。
 * 而 `main/index.ts` 的 `will-quit` 为了给「播完即删」一次重试机会，会先
 * `event.preventDefault()` 挂一个最多 8s 的 `Promise.race`；重启路径下这个异步挂起
 * 让退出流程没能走完，**旧进程不退、relauncher 死等**，用户观感就是
 * 「窗口关掉了，应用却再也没起来」。
 *
 * 故：重启场景跳过那段异步等待，让 `will-quit` 一气呵成地跑完同步清理。
 * 代价只是放弃一次夸克「播完即删」的重试（下次启动仍会重试，见 quarkDeletePending）。
 */
let restartRequested = false;

/** 当前退出是否由「进程级重启」触发 */
export function isRestartRequested(): boolean {
  return restartRequested;
}

/**
 * 退出清理是否允许**异步挂起**（`will-quit` 里 preventDefault 等 I/O）。
 * 重启场景必须返回 false，详见上方注释。
 */
export function shouldDeferQuitCleanup(): boolean {
  return !restartRequested;
}

/**
 * ★ 2026-10-13：重启抑制窗（毫秒）。
 *
 * 「源侧恢复配置」现在有**两条**触发路径：
 *   ① 加固壳自己的 `Handler.post(3s)` → stderr 信令 → `SpiderHost.onAppRestartRequest`
 *   ② 宿主从本地代理观测到还原应答 → `LocalProxyServer.onSpiderConfigRestored`
 * 两条都能触发时不仅会重复重启，还会出现「第二条在重启中途又打进来」的乱序。
 * 取 20s：覆盖 wex 的 3s post + 宿主的 3.5s 延迟，且远小于一次重启的耗时。
 */
const RESTART_SUPPRESS_MS = 20_000;
let lastRestartAt = 0;

/** 仅供测试：把抑制窗状态复位 */
export function resetRestartSuppression(): void {
  lastRestartAt = 0;
}

export function restartApp(reason: string): void {
  try {
    const since = Date.now() - lastRestartAt;
    if (lastRestartAt > 0 && since >= 0 && since < RESTART_SUPPRESS_MS) {
      fileLogger.w(`重启请求被抑制（${RESTART_SUPPRESS_MS / 1000}s 内已触发过，本次来源：${reason}）`);
      return;
    }
    lastRestartAt = Date.now();
    fileLogger.w(`应用即将重启（${reason}）`);
    if (!app.isPackaged && softRestartHandler) {
      fileLogger.w(
        '开发模式：以「重启引擎 + 重载界面」代替进程重启 ' +
          '（dev 由 concurrently -k 驱动，relaunch 起来的新实例连不上已被杀掉的 vite）',
      );
      try {
        softRestartHandler();
        return;
      } catch (e) {
        fileLogger.w(`软重启失败，回退进程级重启：${(e as Error).message}`);
      }
    }
    relaunchProcess();
  } catch (e) {
    // 重启链路自身失败不应该让调用方（蜘蛛调用路径）崩掉
    fileLogger.w(`重启应用失败（${reason}）：${(e as Error).message}`);
  }
}

/** 真·进程级重启：退出后由 Electron 的 relauncher 拉起新实例（仅打包模式使用）。 */
function relaunchProcess(): void {
  // 必须在 relaunch 之前置位：`will-quit` 会在随后的退出流程里读它
  restartRequested = true;
  app.relaunch();
  setTimeout(() => {
    try {
      app.quit();
    } catch (e) {
      fileLogger.w(`重启时退出失败，改为强制退出：${(e as Error).message}`);
      app.exit(0);
    }
  }, 1500);
}
