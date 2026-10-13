// tests/localImportsDir.spec.ts
// ★ 2026-10-12（macOS 适配 T01）：本 spec 必须**显式钉死平台**。
//   原因：`process.env.WINBOX_TEST_PLATFORM` 是**进程级全局**的测试注入通道，
//   并行跑的其它 spec 文件可能在某一刻写入 'darwin' → 不钉死就会随机失败。
//   钉死后：与主机平台、与并行注入都无关（真机 macOS 上跑也应当过）。
//
// ★ 2026-10-13（合并上游 1.21.2）：`localImportsDir()` 已改为**两平台统一 userData**
//   （Windows 的安装目录也可能只读 / 被安全软件隔离 .py）。旧位置降级为
//   `legacyLocalImportsDir()`，仅用于迁移。darwin 那条断言仍然保留 —— 它钉死的是
//   「绝不回到 exe 所在目录」这条 macOS 硬约束。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';

const app = vi.hoisted(() => ({
  isPackaged: true,
  getPath: vi.fn((kind?: string) => kind === 'userData' ? 'E:\\Users\\u\\AppData\\win-box' : 'E:\\Apps\\Win-Box\\Win-Box.exe'),
  getAppPath: vi.fn(() => 'E:\\Projects\\tvbox-win'),
}));
vi.mock('electron', () => ({ app }));
import { legacyLocalImportsDir, localImportsDir } from '../src/main/util/paths';
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
  it('uses userData/imports so installed files are writable and less likely to be quarantined', () => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    expect(onWin()).toBe(join(app.getPath('userData'), 'imports'));
  });
  it('keeps the old executable-relative path available for migration', () => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    expect(legacyLocalImportsDir()).toBe(join(dirname(app.getPath()), 'imports'));
  });
  it('uses userData for portable imports too', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'E:\\Portable\\Win-Box';
    expect(onWin()).toBe(join(app.getPath('userData'), 'imports'));
    expect(legacyLocalImportsDir()).toBe(join(process.env.PORTABLE_EXECUTABLE_DIR, 'imports'));
  });
  it('uses the project root during development', () => {
    app.isPackaged = false;
    expect(onWin()).toBe(join(app.getPath('userData'), 'imports'));
    expect(legacyLocalImportsDir()).toBe(join(app.getAppPath(), 'imports'));
  });

  // ★ 2026-10-12（macOS 适配 P0-8）：darwin 下绝不能落回 exe 所在目录（= `.app` 内部，
  //   往里写会破坏签名密封）。两平台如今统一走 userData，这里钉死 darwin 防止回归。
  it('★ darwin：绝不落在 .app 内部，一律 userData/imports', () => {
    const dir = withPlatform('darwin', () => localImportsDir());
    // 关键是**不再取 exe 所在目录**（= .app 内部）
    expect(dir).toBe(join(app.getPath('userData'), 'imports'));
    expect(dir).not.toBe(join(dirname(app.getPath()), 'imports'));
  });
});
