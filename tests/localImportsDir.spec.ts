import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';

const app = vi.hoisted(() => ({
  isPackaged: true,
  getPath: vi.fn((kind?: string) => kind === 'userData' ? 'E:\\Users\\u\\AppData\\win-box' : 'E:\\Apps\\Win-Box\\Win-Box.exe'),
  getAppPath: vi.fn(() => 'E:\\Projects\\tvbox-win'),
}));
vi.mock('electron', () => ({ app }));
import { legacyLocalImportsDir, localImportsDir } from '../src/main/util/paths';

const portable = process.env.PORTABLE_EXECUTABLE_DIR;
afterEach(() => {
  app.isPackaged = true;
  if (portable === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
  else process.env.PORTABLE_EXECUTABLE_DIR = portable;
});

describe('local import storage directory', () => {
  it('uses userData/imports so installed files are writable and less likely to be quarantined', () => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    expect(localImportsDir()).toBe(join(app.getPath('userData'), 'imports'));
  });
  it('keeps the old executable-relative path available for migration', () => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    expect(legacyLocalImportsDir()).toBe(join(dirname(app.getPath()), 'imports'));
  });
  it('uses userData for portable imports too', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'E:\\Portable\\Win-Box';
    expect(localImportsDir()).toBe(join(app.getPath('userData'), 'imports'));
    expect(legacyLocalImportsDir()).toBe(join(process.env.PORTABLE_EXECUTABLE_DIR, 'imports'));
  });
  it('uses the project root during development', () => {
    app.isPackaged = false;
    expect(localImportsDir()).toBe(join(app.getPath('userData'), 'imports'));
    expect(legacyLocalImportsDir()).toBe(join(app.getAppPath(), 'imports'));
  });
});
