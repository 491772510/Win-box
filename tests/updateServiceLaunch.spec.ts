// tests/updateServiceLaunch.spec.ts
// ★ 2026-10-12（macOS 适配 T04 / P0-9 · 由 QA 补充）：`UpdateService.launch()` 的**平台分支**。
//
// 为什么需要这个文件：资产挑选（`pickInstallerAsset`）在 `tests/update.spec.ts` 已覆盖，
// 但「**拉起安装包之后**该给用户什么提示 / 退不退出」这一步（P0-9 的收尾，也是
// `src/main/ipc/index.ts` 的 `UPDATE_INSTALL` handler 依据）此前**没有直接单测**。
// 本文件把 `launch()` 的返回值钉死：
//   · win32  → `{ ok: true, hint: '' }`（既有行为，渲染层不追加任何提示）；
//   · darwin → `hint` 非空且含「拖入应用程序」引导（dmg 需用户手动覆盖安装）；
//   · 失败   → `{ ok: false, error }`，绝不抛异常。
//
// 隔离策略：只关心 launch 的平台分支 → mock 掉 electron（shell.openPath）与主进程重量级依赖
// （util/paths、net/proxy），避免把真实磁盘/网络/electron 运行时拖进来。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTest } from '../src/shared/platform';
import type { Logger } from '../src/shared/types';

const mocks = vi.hoisted(() => ({
  /** 模拟 electron `shell.openPath`：返回 '' 表示成功，非空字符串表示系统错误 */
  openPath: vi.fn<(p: string) => Promise<string>>(async () => ''),
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '1.20.10', getPath: () => '/tmp/winbox-ud' },
  shell: { openPath: (p: string) => mocks.openPath(p) },
}));

// 隔离主进程重量级依赖（本用例不触及，但模块求值会 import）
vi.mock('../src/main/util/paths', () => ({
  cacheDir: () => '/tmp/winbox-cache',
  resourcesDir: () => '/tmp/winbox-res',
  userDataDir: () => '/tmp/winbox-ud',
  localImportsDir: () => '/tmp/winbox-ud/imports',
  logsDir: () => '/tmp/winbox-ud/logs',
}));
vi.mock('../src/main/net/proxy', () => ({
  dispatchChain: () => [undefined],
}));

import { UpdateService } from '../src/main/update/UpdateService';

/** 记录器只要求 i/w/e；本用例不校验日志内容 */
const nullLogger = { i: () => undefined, w: () => undefined, e: () => undefined } as unknown as Logger;

afterEach(() => {
  // ★ 注入是进程级全局（env + 模块变量）→ 用完必须还原，避免污染并行 spec
  setPlatformForTest(null);
});

describe('UpdateService.launch — 平台化（P0-9 收尾）', () => {
  beforeEach(() => {
    mocks.openPath.mockReset();
    mocks.openPath.mockResolvedValue('');
  });

  it('★ win32：返回 { ok:true, hint:"" }（既有行为，渲染层不追加提示）', async () => {
    setPlatformForTest('win32');
    const r = await new UpdateService(nullLogger).launch('C:\\Users\\u\\Downloads\\Win-Box Setup 1.20.10.exe');
    expect(r).toEqual({ ok: true, hint: '' });
    // 确实调用了系统打开（路径原样透传）
    expect(mocks.openPath).toHaveBeenCalledWith('C:\\Users\\u\\Downloads\\Win-Box Setup 1.20.10.exe');
  });

  it('★ darwin：hint 非空，且提示用户「拖入应用程序」覆盖安装', async () => {
    setPlatformForTest('darwin');
    const r = await new UpdateService(nullLogger).launch('/Users/u/Downloads/Win-Box-1.20.10-arm64.dmg');
    expect(r.ok).toBe(true);
    expect(typeof r.hint).toBe('string');
    expect(r.hint && r.hint.length).toBeGreaterThan(0);
    expect(String(r.hint)).toContain('应用程序');
    expect(String(r.hint)).toContain('.dmg');
  });

  it('openPath 报错 → { ok:false, error }（不抛异常，让上层能上屏）', async () => {
    setPlatformForTest('win32');
    mocks.openPath.mockResolvedValue('无法打开文件');
    const r = await new UpdateService(nullLogger).launch('C:\\nope\\x.exe');
    expect(r).toEqual({ ok: false, error: '无法打开文件' });
  });
});
