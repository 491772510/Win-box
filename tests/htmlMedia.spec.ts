import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }));
import { htmlMediaPlan, htmlPlaylist, resolveFfmpeg } from '../src/main/player/HtmlMedia';
import { HtmlMedia } from '../src/main/player/HtmlMedia';
import { createServer } from 'node:http';
import { afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
describe('HTML media codec compatibility', () => {
  const video = { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' };
  const probe = (audio: string, format = 'mov,mp4,m4a,3gp,3g2,mj2', v = video) => ({ format: { duration: '62.25', format_name: format }, streams: [v, { codec_type: 'audio', codec_name: audio }] });
  it('keeps directly supported MP4; converts unsupported audio, container or video', () => {
    expect(htmlMediaPlan(probe('aac'))).toEqual({ duration: 62.25, compatible: true });
    for (const codec of ['ac3', 'eac3', 'dts']) expect(htmlMediaPlan(probe(codec)).compatible).toBe(false);
    expect(htmlMediaPlan(probe('aac', 'matroska,webm')).compatible).toBe(false);
    expect(htmlMediaPlan(probe('aac', 'mp4', { ...video, codec_name: 'hevc' })).compatible).toBe(false);
    expect(htmlMediaPlan(probe('aac', 'mp4', { ...video, pix_fmt: 'yuv420p10le' })).compatible).toBe(false);
  });
  it('playlist covers exact duration and isolates independent timestamps for seeking', () => {
    const list = htmlPlaylist(14.25);
    expect(list).toContain('#EXTINF:2.250,\n2.ts');
    expect(list.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(2);
    const duration = [...list.matchAll(/#EXTINF:([0-9.]+)/g)].reduce((s,m) => s + Number(m[1]), 0);
    expect(duration).toBe(14.25);
    expect(list).toContain('#EXT-X-ENDLIST');
  });
  it('cached input serves overlapping byte ranges without re-fetching blocks', async () => {
    const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    const upstream = vi.fn(async () => new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` } }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', upstream);
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() });
    (media as any).inputs.set('abc', { source: 'http://relay/play', size: 0, expires: Date.now() + 60000, blocks: new Map(), pending: new Map(), controller: new AbortController(), procs: new Set() });
    const server = createServer((req, res) => { void media.handle(new URL(req.url!, 'http://localhost'), req, res); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}/html/abc/source`;
      const response = await originalFetch(base, { headers: { Range: 'bytes=4-9' } });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes 4-9/${bytes.length}`);
      expect(await response.text()).toBe('456789');
      const other = await originalFetch(base, { headers: { Range: 'bytes=8-' } });
      expect(await other.text()).toBe(bytes.subarray(8).toString());
      expect(upstream).toHaveBeenCalledTimes(1);
      const invalid = await originalFetch(base, { headers: { Range: 'bytes=99-' } });
      expect(invalid.status).toBe(416);
    } finally { media.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
});

// ★ 2026-10-12（macOS 适配 T03 §3.9）：ffmpeg / ffprobe 解析链。
//   仓库里 resources/ffmpeg/ 只有一个 README.txt（二进制未入库）→ darwin 必然落到本机探测，
//   文案必须变成 `brew install ffmpeg`；而 **win32 文案必须逐字保持「缺少随包媒体兼容组件」**。
describe('resolveFfmpeg — 用户覆盖 → 随包内置 → Homebrew/PATH（★ 平台化）', () => {
  const ROOT = 'R:\\resources';

  it('★ win32 全部缺失 → 文案逐字保持「缺少随包媒体兼容组件」', () => {
    const bins = resolveFfmpeg({
      resourcesRoot: ROOT,
      platform: 'win32',
      env: { ProgramFiles: 'C:\\PF' },
      exists: () => false,
    });
    expect(bins.missing).toEqual(['ffmpeg', 'ffprobe']);
    expect(bins.ffmpeg).toBe('');
    expect(bins.ffprobe).toBe('');
    expect(bins.hint).toBe('缺少随包媒体兼容组件');
  });

  it('★ darwin 全部缺失 → hint 含 `brew install ffmpeg`（不再是 win32 文案）', () => {
    const bins = resolveFfmpeg({
      resourcesRoot: '/Applications/Win-Box.app/Contents/Resources',
      platform: 'darwin',
      env: { HOME: '/Users/u' },
      exists: () => false,
    });
    expect(bins.missing).toEqual(['ffmpeg', 'ffprobe']);
    expect(bins.hint).toContain('brew install ffmpeg');
    expect(bins.hint).not.toBe('缺少随包媒体兼容组件');
  });

  it('win32 随包内置存在 → 用内置（路径带 .exe），无 hint', () => {
    const ffmpeg = `${ROOT}\\ffmpeg\\ffmpeg.exe`;
    const ffprobe = `${ROOT}\\ffmpeg\\ffprobe.exe`;
    const bins = resolveFfmpeg({
      resourcesRoot: ROOT,
      platform: 'win32',
      env: {},
      exists: (p) => p === ffmpeg || p === ffprobe,
    });
    expect(bins.ffmpeg).toBe(ffmpeg);
    expect(bins.ffprobe).toBe(ffprobe);
    expect(bins.missing).toEqual([]);
    expect(bins.hint).toBe('');
  });

  it('★ darwin 随包缺失 → 落到 Homebrew（探测顺序：/opt/homebrew/bin → /usr/local/bin → /usr/bin）', () => {
    const bins = resolveFfmpeg({
      resourcesRoot: '/res',
      platform: 'darwin',
      env: {},
      exists: (p) => p === '/opt/homebrew/bin/ffmpeg' || p === '/opt/homebrew/bin/ffprobe',
    });
    expect(bins.ffmpeg).toBe('/opt/homebrew/bin/ffmpeg');
    expect(bins.ffprobe).toBe('/opt/homebrew/bin/ffprobe');
    expect(bins.missing).toEqual([]);

    const intel = resolveFfmpeg({
      resourcesRoot: '/res',
      platform: 'darwin',
      env: { PATH: '/usr/local/bin:/usr/bin' },
      exists: (p) => p === '/usr/local/bin/ffprobe',
    });
    expect(intel.ffprobe).toBe('/usr/local/bin/ffprobe');
    expect(intel.ffmpeg).toBe('');
    expect(intel.missing).toEqual(['ffmpeg']);
    expect(intel.hint).toContain('brew install ffmpeg');
  });

  it('用户覆盖优先于随包内置（按工具名分别覆盖）', () => {
    const bins = resolveFfmpeg({
      resourcesRoot: ROOT,
      platform: 'win32',
      override: { ffmpeg: 'D:\\tools\\ffmpeg.exe' },
      env: {},
      exists: (p) => p === 'D:\\tools\\ffmpeg.exe' || p === `${ROOT}\\ffmpeg\\ffprobe.exe`,
    });
    expect(bins.ffmpeg).toBe('D:\\tools\\ffmpeg.exe');
    expect(bins.ffprobe).toBe(`${ROOT}\\ffmpeg\\ffprobe.exe`);
    expect(bins.missing).toEqual([]);
  });

  it('darwin 的候选（随包内置 + 系统）都不带 .exe（写死 .exe 会让内置在 macOS 永远探不到）', () => {
    const seen: string[] = [];
    const bins = resolveFfmpeg({
      resourcesRoot: '/res',
      platform: 'darwin',
      env: {},
      exists: (p) => {
        seen.push(p);
        return /[\\/]ffmpeg$/.test(p) || /[\\/]ffprobe$/.test(p);
      },
    });
    expect(bins.ffmpeg).not.toBe('');
    expect(bins.ffprobe).not.toBe('');
    expect(bins.ffmpeg.endsWith('.exe')).toBe(false);
    expect(bins.ffprobe.endsWith('.exe')).toBe(false);
    expect(seen.some((p) => p.endsWith('.exe'))).toBe(false);
  });
});
