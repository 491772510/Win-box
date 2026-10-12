// tests/localImportsDir.spec.ts
// ★ 2026-10-12（macOS 适配 T01）：本 spec 必须**显式钉死平台**。
//   原因：`localImportsDir()` 现在按平台分支（darwin → `userData/imports`；
//   win32 → 安装目录/便携目录/开发态三种），而 `platformName()` 会读
//   `process.env.WINBOX_TEST_PLATFORM`（测试注入通道）。这个 env 是**进程级全局**，
//   并行跑的其它 spec 文件可能在某一刻写入 'darwin' → 不钉死就会随机失败。
//   钉死后：与主机平台、与并行注入都无关（真机 macOS 上跑也应当过）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';

const app = vi.hoisted(() => ({
  isPackaged: true,
  getPath: vi.fn(() => 'E:\\Apps\\Win-Box\\Win-Box.exe'),
  getAppPath: vi.fn(() => 'E:\\Projects\\tvbox-win'),
}));
vi.mock('electron', () => ({ app }));
import { localImportsDir } from '../src/main/util/paths';
import { withPlatform } from '../src/shared/platform';

const portable = process.env.PORTABLE_EXECUTABLE_DIR;
afterEach(() => {
  app.isPackaged = true;
  if (portable === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
  else process.env.PORTABLE_EXECUTABLE_DIR = portable;
});

/** 统一在 win32 语义下断言（本 spec 测的是 Windows 三态布局） */
const onWin = (): string => withPlatform('win32', () => localImportsDir());

describe('local import storage directory', () => {
  it('uses imports beside the installed executable, not userData', () => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    expect(onWin()).toBe(join(dirname(app.getPath()), 'imports'));
  });
  it('uses the original portable application directory', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'E:\\Portable\\Win-Box';
    expect(onWin()).toBe(join(process.env.PORTABLE_EXECUTABLE_DIR, 'imports'));
  });
  it('uses the project root during development', () => {
    app.isPackaged = false;
    expect(onWin()).toBe(join(app.getAppPath(), 'imports'));
  });

  it('★ darwin：绝不落在 .app 内部，一律 userData/imports', () => {
    const dir = withPlatform('darwin', () => localImportsDir());
    // 本 spec 的 electron mock 里 getPath 对任意 name（含 'userData'）都返回同一个路径，
    // 所以这里等价于 join(userData, 'imports')，关键是**不再取 exe 所在目录**
    expect(dir).toBe(join(app.getPath(), 'imports'));
    expect(dir).not.toBe(join(dirname(app.getPath()), 'imports'));
  });
});
