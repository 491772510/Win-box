// tests/spiderRestore.spec.ts
// 「源侧恢复配置」判据的纯函数护栏（shared/spiderRestore.ts —— 不依赖 Electron / 网络）。
//
// ★ 2026-10-13 背景：wex 配置中心「WebDAV 还原」成功后本该自动重启，但它自己排的
//   3 秒 `Handler.post` 经常来不及执行 —— 承载它的 JVM 在还原完成后就死了
//   （真机三次还原只成功一次，另两次 `19970 ECONNREFUSED`）。
//   遂改由宿主在本地代理侧观测还原应答兜底触发重启。
//
//   ⚠ 这两条判据是**安全边界**：判宽了，用户正看着剧就被无故重启；
//     判窄了，又回到「还原完没反应、以为配置丢了」。改之前先想清楚落在哪一边。
import { describe, expect, it } from 'vitest';
import {
  isSpiderRestoreResponse,
  RESTORE_RESTART_DELAY_MS,
  SPIDER_RESTORE_ACTIONS,
  spiderRestoreActionOf,
} from '../src/shared/spiderRestore';

describe('spiderRestoreActionOf', () => {
  it('只认 `do=pan` 下的已登记动作', () => {
    expect(spiderRestoreActionOf('?do=pan&action=runWebDavRecover')).toBe('runWebDavRecover');
    expect(SPIDER_RESTORE_ACTIONS.has('runWebDavRecover')).toBe(true);
  });

  it('也接受已构造好的 URLSearchParams（调用方两种都可能有）', () => {
    expect(spiderRestoreActionOf(new URLSearchParams({ do: 'pan', action: 'runWebDavRecover' }))).toBe('runWebDavRecover');
  });

  it('非 pan 入口、未登记动作、空值一律返回空串（绝不误报）', () => {
    expect(spiderRestoreActionOf('?do=proxy&action=runWebDavRecover')).toBe('');
    expect(spiderRestoreActionOf('?do=pan&action=config')).toBe('');
    expect(spiderRestoreActionOf('?do=pan')).toBe('');
    expect(spiderRestoreActionOf('')).toBe('');
    expect(spiderRestoreActionOf(null)).toBe('');
    expect(spiderRestoreActionOf(undefined)).toBe('');
  });

  it('动作名带空白也认（查询串里偶发 %20/空格），但空动作不认', () => {
    expect(spiderRestoreActionOf('?do=pan&action=%20runWebDavRecover%20')).toBe('runWebDavRecover');
    expect(spiderRestoreActionOf('?do=pan&action=%20%20')).toBe('');
  });
});

describe('isSpiderRestoreResponse', () => {
  it('必须动作命中**且** 2xx —— 还原失败不能触发重启', () => {
    expect(isSpiderRestoreResponse('?do=pan&action=runWebDavRecover', 200)).toBe(true);
    expect(isSpiderRestoreResponse('?do=pan&action=runWebDavRecover', 204)).toBe(true);
    expect(isSpiderRestoreResponse('?do=pan&action=runWebDavRecover', 500)).toBe(false);
    expect(isSpiderRestoreResponse('?do=pan&action=runWebDavRecover', 302)).toBe(false);
    expect(isSpiderRestoreResponse('?do=pan&action=config', 200)).toBe(false);
  });
});

describe('RESTORE_RESTART_DELAY_MS', () => {
  it('留出把「恢复成功」应答送回浏览器的时间，又不能久到让用户以为没反应', () => {
    // 与 wex 自己的 3 秒节奏对齐；低于 2s 会截断应答体（用户看到「还原失败」）
    expect(RESTORE_RESTART_DELAY_MS).toBeGreaterThanOrEqual(2000);
    expect(RESTORE_RESTART_DELAY_MS).toBeLessThanOrEqual(10_000);
  });
});
