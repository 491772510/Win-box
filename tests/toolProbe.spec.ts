// tests/toolProbe.spec.ts
// ★ 2026-10-12（macOS 适配 T01）：统一依赖探测链。
//   ★★ 优先级恒定：**用户覆盖 → 本机探测 → 随包内置 → none**（不得为某个工具改顺序）。
//   「本机优先、内置兜底」是**用户拍板的需求**：用户装了 Homebrew / `/Applications` 的版本
//   就用他装的那份，找不到才回退随包二进制。（原实现是「内置优先」，已按需求修正。）
//   `exists` 注入 → 纯逻辑，零 IO，可在任何主机上断言 darwin 行为。
import { describe, it, expect } from 'vitest';
import { probeTool, probeTools, probeNone } from '../src/main/util/toolProbe';

const MAC_ENV = { HOME: '/Users/u', PATH: '/opt/homebrew/bin:/usr/local/bin' };

describe('toolProbe — 探测优先级（覆盖 → 本机 → 内置）', () => {
  it('① 覆盖存在 → override（即便内置/本机也命中）', () => {
    const r = probeTool({
      tool: 'mpv',
      override: '/Users/u/my-mpv',
      bundled: '/built-in/mpv',
      platform: 'darwin',
      env: MAC_ENV,
      exists: () => true,
    });
    expect(r.source).toBe('override');
    expect(r.path).toBe('/Users/u/my-mpv');
    expect(r.hint).toContain('/Users/u/my-mpv');
  });

  it('② 覆盖不存在 → 继续往下探（不因为填错路径就把功能关死），本机没有才落内置', () => {
    const r = probeTool({
      tool: 'mpv',
      override: '/nope/mpv',
      bundled: '/built-in/mpv',
      platform: 'darwin',
      env: MAC_ENV,
      exists: (p) => p === '/built-in/mpv',
    });
    expect(r.source).toBe('bundled');
    expect(r.path).toBe('/built-in/mpv');
  });

  it('③ 内置缺失 → 本机探测（darwin：.app → Homebrew → /usr/local/bin → PATH）', () => {
    const r = probeTool({
      tool: 'mpv',
      bundled: '/built-in/mpv',
      platform: 'darwin',
      env: MAC_ENV,
      home: '/Users/u',
      exists: (p) => p === '/opt/homebrew/bin/mpv',
    });
    expect(r.source).toBe('system');
    expect(r.path).toBe('/opt/homebrew/bin/mpv');
    expect(r.hint).toContain('本机安装');
  });

  it('③ darwin：.app 内二进制优先于 Homebrew（顺序＝优先级）', () => {
    const r = probeTool({
      tool: 'vlc',
      platform: 'darwin',
      env: MAC_ENV,
      home: '/Users/u',
      exists: (p) =>
        p === '/Applications/VLC.app/Contents/MacOS/VLC' || p === '/opt/homebrew/bin/vlc',
    });
    expect(r.path).toBe('/Applications/VLC.app/Contents/MacOS/VLC');
  });

  it('★★ 本机探测优先于随包内置：两者同时存在 → 必须选 system（用户拍板「探测优先、内置兜底」）', () => {
    const r = probeTool({
      tool: 'mpv',
      bundled: '/built-in/mpv',
      platform: 'darwin',
      env: MAC_ENV,
      home: '/Users/u',
      // ★ 系统候选与内置**同时存在**
      exists: (p) => p === '/built-in/mpv' || p === '/opt/homebrew/bin/mpv',
    });
    expect(r.source).toBe('system');
    expect(r.path).toBe('/opt/homebrew/bin/mpv');
    expect(r.hint).toContain('本机安装');
  });

  it('★★ 同上：vlc 的 .app 与随包内置同时存在 → 也必须选 system', () => {
    const r = probeTool({
      tool: 'vlc',
      bundled: '/built-in/vlc',
      platform: 'darwin',
      env: MAC_ENV,
      home: '/Users/u',
      exists: (p) => p === '/built-in/vlc' || p === '/Applications/VLC.app/Contents/MacOS/VLC',
    });
    expect(r.source).toBe('system');
    expect(r.path).toBe('/Applications/VLC.app/Contents/MacOS/VLC');
  });

  it('★★ win32 为何不受影响：本机候选恒为空数组 → 仍落随包内置（零回归）', () => {
    // platform.ts 的 systemToolCandidates() 第一行即 `if (!isMac(p)) return []`
    const r = probeTool({
      tool: 'mpv',
      bundled: 'C:\\App\\resources\\mpv\\mpv.exe',
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      exists: () => true, // 任何路径都「存在」，若 system 非空就会命中 system
    });
    expect(r.source).toBe('bundled');
    expect(r.path).toBe('C:\\App\\resources\\mpv\\mpv.exe');
  });

  it('④ 全落空 → none + 人话 hint（darwin 必含 brew install）', () => {
    const r = probeTool({
      tool: 'ffmpeg',
      platform: 'darwin',
      env: MAC_ENV,
      exists: () => false,
    });
    expect(r.source).toBe('none');
    expect(r.path).toBe('');
    expect(r.hint).toContain('brew install ffmpeg');
  });

  it('allowSystem=false 时只认 override / bundled', () => {
    const r = probeTool({
      tool: 'mpv',
      bundled: '/built-in/mpv',
      allowSystem: false,
      platform: 'darwin',
      env: MAC_ENV,
      exists: (p) => p === '/opt/homebrew/bin/mpv',
    });
    expect(r.source).toBe('none');
  });

  it('裸可执行名作为 override → 在系统 bin / PATH 里解析', () => {
    const r = probeTool({
      tool: 'mpv',
      override: 'mpv',
      platform: 'darwin',
      env: MAC_ENV,
      exists: (p) => p === '/usr/local/bin/mpv',
    });
    expect(r.source).toBe('override');
    expect(r.path).toBe('/usr/local/bin/mpv');
  });

  it('exists 抛异常（非法路径）→ 视为不存在，绝不冒泡', () => {
    const r = probeTool({
      tool: 'mpv',
      platform: 'darwin',
      env: MAC_ENV,
      exists: () => {
        throw new Error('illegal path');
      },
    });
    expect(r.source).toBe('none');
  });

  it('win32：本机候选为空 → 只有 override / bundled 两档（Program Files 系由调用方负责）', () => {
    const r = probeTool({
      tool: 'mpv',
      bundled: 'C:\\App\\resources\\mpv\\mpv.exe',
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      exists: (p) => p === 'C:\\App\\resources\\mpv\\mpv.exe',
    });
    expect(r.source).toBe('bundled');
    const none = probeTool({ tool: 'mpv', platform: 'win32', exists: () => false });
    expect(none.source).toBe('none');
    expect(none.hint).not.toContain('brew');
  });
});

describe('toolProbe — 批量探测', () => {
  it('probeTools 按 tool id 返回，缺失项给 hint', () => {
    const list = [
      { tool: 'mpv' as const, bundled: '/b/mpv', platform: 'darwin' as const },
      { tool: 'ffmpeg' as const, bundled: '/b/ffmpeg', platform: 'darwin' as const },
      { tool: 'aria2c' as const, bundled: '/b/aria2c', platform: 'darwin' as const },
    ];
    const out = probeTools(list, (p) => p === '/b/mpv');
    expect(Object.keys(out).sort()).toEqual(['aria2c', 'ffmpeg', 'mpv']);
    expect(out.mpv.source).toBe('bundled');
    expect(out.ffmpeg.source).toBe('none');
    expect(out.ffmpeg.hint).toContain('brew install ffmpeg');
    expect(out.aria2c.hint).toContain('brew install aria2');
  });

  it('probeNone：直接给 none + hint', () => {
    const r = probeNone('python3', 'darwin');
    expect(r.source).toBe('none');
    expect(r.path).toBe('');
    expect(r.hint).toContain('brew install');
  });
});
