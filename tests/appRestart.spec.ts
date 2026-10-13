// tests/appRestart.spec.ts
// ★ 2026-10-13 事故回归护栏（两条根因，缺一不可）：
//
// 【根因 1】开发模式**绝不能**走 `app.relaunch()`。
//   `npm run dev` 由 `concurrently -k` 驱动（vite + build-main --watch + electron）。
//   `-k` 的语义是「任一命令退出就杀掉其余命令」：electron 一退出，vite 立刻被杀；
//   而 relaunch 只按 `process.argv.slice(1)`（即 `electron .`）拉起新实例、不重建 vite，
//   新实例 `loadURL('http://localhost:5173')` 连不上 → 白屏。
//
// 【根因 2】进程级重启时，`will-quit` **绝不能异步挂起**。
//   `app.relaunch()` 会立刻 spawn 一个 `--type=relauncher` 子进程（真机取证：
//   PID 15984，父进程 = 旧主进程，命令行 `electron.exe --type=relauncher --- electron.exe .`），
//   它必须等本进程**真正退出**才拉起新实例。而 will-quit 里为了让「播完即删」多一次重试机会，
//   会 `preventDefault()` 挂一个最多 8s 的 Promise.race —— 退出流程卡住 → 旧进程不退、
//   relauncher 死等 → 用户观感「窗口关掉了，应用却再也没起来」。
//
// 事故当日 wex 网页配置中心「WebDAV 还原」走的就是这条链：配置其实已恢复落盘
// （`NewWexFnw_preferences.xml` 有写入、源列表 99 条也都在），但用户看到的是
// 「关了 + 没起来」，于是误以为配置丢了。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    relaunch: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    getPath: () => 'C:/winbox-fake-userdata',
  },
  logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() },
}));

// logger 顶层会 mkdirSync(logsDir())，不 mock 会真的建目录
vi.mock('electron', () => ({ app: m.app }));
vi.mock('../src/main/util/logger', () => ({ fileLogger: m.logger }));

import {
  resetRestartSuppression,
  restartApp,
  setSoftRestartHandler,
  shouldDeferQuitCleanup,
} from '../src/main/util/appRestart';

const logged = (): string => m.logger.w.mock.calls.map((c) => String(c[0])).join('\n');

// ⚠️ 用例顺序有意义：`restartRequested` 是模块级单例，一旦置位不会回退。
//    凡是不希望它置位的用例（软重启 / 默认值）必须排在进程级重启用例之前。
//    （20s 抑制窗由 beforeEach 里的 resetRestartSuppression 复位，不受此约束。）
describe('restartApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.app.isPackaged = false;
    resetRestartSuppression();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- 以下用例不会置位 restartRequested ----

  it('默认（普通退出）：允许 will-quit 异步挂起，保住「播完即删」的重试机会', () => {
    expect(shouldDeferQuitCleanup()).toBe(true);
  });

  it('开发模式：走软重启，绝不 relaunch / quit（relaunch 在 concurrently -k 下起不来）', () => {
    vi.useFakeTimers();
    const soft = vi.fn();
    setSoftRestartHandler(soft);

    restartApp('测试：源侧恢复配置');

    expect(soft).toHaveBeenCalledTimes(1);
    expect(m.app.relaunch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(m.app.quit).not.toHaveBeenCalled();
    // 软重启不退出进程 → 不该关掉异步清理
    expect(shouldDeferQuitCleanup()).toBe(true);
    // 日志要把「为什么不真重启」说清楚，避免下一次又被当成 bug
    expect(logged()).toContain('重启引擎');
  });

  it('20s 抑制窗：两条触发路径（源侧信令 + 宿主观测）同时打进来也只重启一次', () => {
    const soft = vi.fn();
    setSoftRestartHandler(soft);

    restartApp('测试：源侧 stderr 信令');
    restartApp('测试：宿主侧本地代理观测');
    restartApp('测试：又一次观测');

    expect(soft, '两次触发必须合并成一次重启').toHaveBeenCalledTimes(1);
    expect(logged()).toContain('被抑制');
    // 抑制的是「重复触发」，不能顺带把「重启过」这个事实也抹掉
    expect(shouldDeferQuitCleanup(), 'dev 软重启本就不置位').toBe(true);
  });

  // ---- 以下用例会置位 restartRequested，必须排在最后 ----

  it('软重启抛错：回退进程级重启，而不是什么都不做', () => {
    vi.useFakeTimers();
    setSoftRestartHandler(() => {
      throw new Error('软重启炸了');
    });

    restartApp('测试：软重启失败');

    expect(m.app.relaunch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(m.app.quit).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('回退');
  });

  it('进程级重启：必须关掉 will-quit 的异步挂起，否则 relauncher 永远等不到退出', () => {
    vi.useFakeTimers();
    const soft = vi.fn();
    setSoftRestartHandler(soft);
    m.app.isPackaged = true;

    restartApp('测试：打包环境');

    expect(m.app.relaunch).toHaveBeenCalledTimes(1);
    expect(soft, '打包模式不该走软重启').not.toHaveBeenCalled();
    // ★ 事故根因 2 的护栏：这一条为 true 就等于「重启后应用起不来」
    expect(shouldDeferQuitCleanup()).toBe(false);
    // 仍要留出把 HTTP 响应送出去的时间，不能立刻 quit
    expect(m.app.quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(m.app.quit).toHaveBeenCalledTimes(1);
  });

  it('quit 抛错：强制 exit(0)，不留既不退出也不重启的僵局', () => {
    vi.useFakeTimers();
    m.app.isPackaged = true;
    m.app.quit.mockImplementationOnce(() => {
      throw new Error('quit failed');
    });

    restartApp('测试：quit 失败');

    vi.advanceTimersByTime(1500);
    expect(m.app.exit).toHaveBeenCalledWith(0);
  });
});
