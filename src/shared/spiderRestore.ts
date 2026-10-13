// src/shared/spiderRestore.ts — 源侧「恢复配置后需重启」的**宿主侧判据**（纯函数，可单测）。
//
// ★ 2026-10-13 为什么要宿主侧兜底（真机取证）：
//   加固壳 wex 的配置中心在「备份与还原 → WebDAV还原」成功后，会自己排一个
//   **3 秒后**的 `Handler.post(重启)`，再由 `Context.startActivity` 打 stderr 信令
//   `[winbox] app-restart-request` 通知宿主。链路本身已打通且验证通过。
//
//   但它**不可靠**：承载配置中心的那个 JVM 常常在还原完成后**立刻死掉**
//   （观测：还原应答之后 `127.0.0.1:19970` 直接 ECONNREFUSED 刷屏），
//   3 秒的 post 根本来不及执行。同一台机同一份代码，三次还原只有一次收到信令：
//     09:34:56 还原 → 09:34:59.795 信令到达（+3.007s）→ 重启成功
//     09:35:36 还原 → 无信令，紧接 19970 ECONNREFUSED
//     09:48:53 还原 → 无信令，配置中心瘫约 3 分钟
//
//   本地代理（`127.0.0.1:9978/proxy`）是这条链路的**必经之处**，宿主观测到的时刻
//   不依赖任何 JVM 存活 —— 由它兜底触发，重启就从「看运气」变成确定行为。
//   源侧信令保持不动（先到的那个生效，另一路被 appRestart 的抑制窗挡掉）。

/**
 * 会写沙箱配置、且**必须重启才生效**的源侧动作（观测自真机日志 `?do=pan&action=…`）。
 *
 * ⚠ 只登记「实测确认」的动作：误报会让用户正在浏览时被无故重启。
 * 新增前请先在日志里确认该 action 的应答确实代表「配置已恢复」。
 */
export const SPIDER_RESTORE_ACTIONS: ReadonlySet<string> = new Set(['runWebDavRecover']);

/**
 * 观测到还原后延迟多久再重启。
 * 与 wex 自己的 3 秒节奏对齐：先让「恢复成功」的 HTTP 应答完整送回浏览器，
 * 否则用户会看到「还原失败」（响应被重启截断）。
 */
export const RESTORE_RESTART_DELAY_MS = 3_500;

/**
 * 从查询串里取出「需要重启的源侧动作」名；不是则返回 ''。
 * 可传 `?do=pan&action=…` 或已构造好的 URLSearchParams。
 */
export function spiderRestoreActionOf(search: URLSearchParams | string | null | undefined): string {
  try {
    if (!search) return '';
    const sp = typeof search === 'string' ? new URLSearchParams(search) : search;
    if (sp.get('do') !== 'pan') return '';
    const action = String(sp.get('action') || '').trim();
    return SPIDER_RESTORE_ACTIONS.has(action) ? action : '';
  } catch {
    // 判据解析失败绝不能影响转发
    return '';
  }
}

/** 该响应是否代表「源侧刚恢复完配置」：动作命中 + 2xx。 */
export function isSpiderRestoreResponse(
  search: URLSearchParams | string | null | undefined,
  status: number,
): boolean {
  return !!spiderRestoreActionOf(search) && status >= 200 && status < 300;
}
