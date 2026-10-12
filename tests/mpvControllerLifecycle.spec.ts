import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/util/paths', () => ({ cacheDir: () => '.', resourcesDir: () => '.' }));
vi.mock('../src/main/player/playerSettings', () => ({ playerSettings: { settings: {} } }));
vi.mock('../src/main/player/PlayerWindow', () => ({ playerIsMini: () => false, playerIsFullscreen: () => false }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
// ★ 2026-10-12（T03）：让 `status()` 不必真的找到 mpv.exe 也能走到 spawn（只替换解析链，其余取真实现）。
vi.mock('../src/main/player/mpvCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/player/mpvCore')>();
  return { ...actual, resolveMpvPath: () => ({ path: 'mpv-test-bin', source: 'system' as const }) };
});
import { spawn } from 'node:child_process';
import { MpvController } from '../src/main/player/MpvController';
import { mpvIpcPath } from '../src/shared/platform';

/**
 * ★ 2026-10-12：平台注入走 `process.env.WINBOX_TEST_PLATFORM`（`platformName()` 优先读它）。
 *   `withPlatform()` 在 vitest `vmThreads` 下对「import 即执行」的模块不生效，故统一用 env。
 */
const PLATFORM_ENV = 'WINBOX_TEST_PLATFORM';
const setPlatformEnv = (p?: 'win32' | 'darwin'): void => {
  if (p) process.env[PLATFORM_ENV] = p;
  else delete process.env[PLATFORM_ENV];
};
afterEach(() => {
  setPlatformEnv(undefined);
  delete process.env.WINBOX_MAC_MPV_EMBED;
});

class Proc extends EventEmitter {
  exitCode: number | null = null;
  signalCode = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() { this.killed = true; this.finish(); }
  finish() { this.exitCode = 0; this.emit('exit', 0); }
}
class Sock extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const windowStub = () => Object.assign(new EventEmitter(), {
  isDestroyed: () => false,
  isFullScreen: () => false,
  getContentBounds: () => ({ height: 600 }),
  getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0]),
  webContents: { send: vi.fn(), invalidate: vi.fn() },
});
const make = () => {
  const controller = new MpvController({ i: vi.fn(), w: vi.fn(), e: vi.fn() });
  // ★ 2026-10-12：`MpvStatus` 增 `embeddable`（win32 恒 true）
  vi.spyOn(controller, 'status').mockReturnValue({ available: true, path: 'mpv.exe', source: 'bundled', note: '', embeddable: true });
  const sockets: Sock[] = [];
  vi.spyOn(controller as any, 'connectPipe').mockImplementation(async () => {
    const socket = new Sock(); sockets.push(socket); return socket;
  });
  return { controller, sockets };
};

beforeEach(() => vi.clearAllMocks());
describe('mpv lifecycle', () => {
  it('a stop cancels a start still waiting in the queue', async () => {
    const { controller } = make();
    const pending = controller.start(windowStub() as any, { url: 'a.mp4' });
    controller.stop();
    await pending;
    expect(spawn).not.toHaveBeenCalled();
  });
  it('only the latest concurrent start spawns', async () => {
    const { controller, sockets } = make();
    const proc = new Proc(); vi.mocked(spawn).mockReturnValue(proc as any);
    const win = windowStub();
    await Promise.all([controller.start(win as any, { url: 'old.mp4' }), controller.start(win as any, { url: 'new.mp4', volume: .6 })]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(sockets[0].write.mock.calls.flat().join('')).toContain('new.mp4');
    expect(sockets[0].write.mock.calls.flat().join('')).not.toContain('old.mp4');
    proc.finish(); controller.stop();
  });
  it('waits for the old process to release its HWND and ignores its late messages', async () => {
    const { controller, sockets } = make();
    const oldProc = new Proc(), newProc = new Proc();
    vi.mocked(spawn).mockReturnValueOnce(oldProc as any).mockReturnValueOnce(newProc as any);
    const win = windowStub();
    await controller.start(win as any, { url: 'old.mp4' });
    const next = controller.start(win as any, { url: 'new.mp4', paused: true });
    await tick();
    expect(spawn).toHaveBeenCalledTimes(1);
    oldProc.finish();
    await next;
    expect(spawn).toHaveBeenCalledTimes(2);
    sockets[0].emit('data', Buffer.from('{"event":"property-change","name":"time-pos","data":99}\n'));
    expect((controller as any).state.time).toBeNull();
    const lines = sockets[1].write.mock.calls.flat().join('');
    expect(lines).toContain('"mute","no"');
    expect(lines).toContain('"pause","yes"');
    newProc.finish(); controller.stop();
    expect(win.listenerCount('resize')).toBe(0);
  });
});

// ★ 2026-10-12（macOS 适配 T03 §3.8）：IPC 端点平台化 + 嵌入降级（风险 R1）。
describe('mpv lifecycle · 平台化 IPC 端点与嵌入降级', () => {
  const log = () => ({ i: vi.fn(), w: vi.fn(), e: vi.fn() });

  it('★ IPC 端点：win32 `\\\\.\\pipe\\…` / darwin `….sock`（spawn 实参逐项核对）', async () => {
    const win = windowStub();
    const proc = new Proc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    setPlatformEnv('darwin');
    const macArgs = mpvIpcPath({ pid: process.pid, seq: 1, nonce: 'n' }, 'darwin');
    expect(macArgs.endsWith('.sock')).toBe(true);
    expect(macArgs.includes('\\\\.\\pipe\\')).toBe(false);

    const mac = new MpvController(log());
    vi.spyOn(mac as any, 'connectPipe').mockImplementation(async () => new Sock());
    await mac.start(win as any, { url: 'mac.mkv' });
    const spawnedMac = [...(vi.mocked(spawn).mock.calls.at(-1)![1] as readonly string[])];
    const macEndpoint = spawnedMac.find((a) => a.startsWith('--input-ipc-server='))!;
    expect(macEndpoint.endsWith('.sock')).toBe(true);
    expect(macEndpoint).not.toContain('\\\\.\\pipe\\');
    // darwin 无任何 d3d11
    expect(spawnedMac.some((a) => /d3d11/i.test(a))).toBe(false);
    mac.stop();

    vi.clearAllMocks();
    setPlatformEnv('win32');
    vi.mocked(spawn).mockReturnValue(new Proc() as any);
    const winPipe = mpvIpcPath({ pid: process.pid, seq: 1, nonce: 'n' }, 'win32');
    expect(winPipe.startsWith('\\\\.\\pipe\\')).toBe(true);
    const winCtl = new MpvController(log());
    vi.spyOn(winCtl as any, 'connectPipe').mockImplementation(async () => new Sock());
    await winCtl.start(win as any, { url: 'win.mkv' });
    const spawnedWin = [...(vi.mocked(spawn).mock.calls.at(-1)![1] as readonly string[])];
    const winEndpoint = spawnedWin.find((a) => a.startsWith('--input-ipc-server='))!;
    expect(winEndpoint.startsWith('--input-ipc-server=\\\\.\\pipe\\winbox-mpv-')).toBe(true);
    expect(spawnedWin).toContain('--gpu-api=d3d11'); // win32 行为不变
    winCtl.stop();
  });

  it('★ status().embeddable：darwin 默认 true、WINBOX_MAC_MPV_EMBED=0 → false；win32 恒 true', () => {
    const controller = new MpvController(log());

    setPlatformEnv('darwin');
    delete process.env.WINBOX_MAC_MPV_EMBED;
    expect(controller.status().embeddable).toBe(true);

    process.env.WINBOX_MAC_MPV_EMBED = '0';
    expect(controller.status().embeddable).toBe(false);
    expect(controller.status().note).toContain('HTML5'); // 降级要给人话提示

    setPlatformEnv('win32');
    expect(controller.status().embeddable).toBe(true); // win32 关不掉
  });

  it('★ darwin：IPC 连接超时 → embedFailed 置位并自动降级（embeddable 转 false），报错是中文人话', async () => {
    setPlatformEnv('darwin');
    const controller = new MpvController(log());
    vi.mocked(spawn).mockReturnValue(new Proc() as any);
    vi.spyOn(controller as any, 'connectPipe').mockRejectedValue(new Error('mpv 通信管道连接超时（进程可能启动失败）'));

    await expect(controller.start(windowStub() as any, { url: 'a.mkv' })).rejects.toThrow(/无法嵌入播放窗口/);
    expect((controller as any).embedFailed).toBe(true);
    expect(controller.status().embeddable).toBe(false);
    expect(controller.status().available).toBe(true); // 进程本身是好的 → 不能因为嵌入失败就整体不可用
  });
});
