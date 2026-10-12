import { app } from 'electron';
import { fileLogger } from './logger';

/**
 * ★ 2026-10-13 新增：**重启应用**（主进程唯一的重启实现，两个入口共用）。
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
 * <h3>为什么是 relaunch + quit，不是 exit</h3>
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
export function restartApp(reason: string): void {
  try {
    fileLogger.w(`应用即将重启（${reason}）`);
    app.relaunch();
    setTimeout(() => {
      try {
        app.quit();
      } catch (e) {
        fileLogger.w(`重启时退出失败，改为强制退出：${(e as Error).message}`);
        app.exit(0);
      }
    }, 1500);
  } catch (e) {
    // 重启链路自身失败不应该让调用方（蜘蛛调用路径）崩掉
    fileLogger.w(`重启应用失败（${reason}）：${(e as Error).message}`);
  }
}
