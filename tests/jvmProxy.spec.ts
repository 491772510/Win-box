// JVM 媒体中继：实际端口、Range/HEAD 透传与分享会话隔离（仅本机 HTTP）。
//
// ★ 末组用例覆盖 2026-10-13 的「源侧恢复配置 → 宿主侧兜底重启」判据：
//   承载配置中心的 JVM 常常在还原后立刻死掉，源侧自己排的 3 秒 Handler.post 来不及发信令
//   （真机三次还原只成功一次）。本中继在**拿到还原应答的那一刻**就观测到了，
//   不依赖 JVM 之后是否存活 —— 这是重启从「看运气」变成确定行为的关键。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP || '.', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { RESTORE_RESTART_DELAY_MS } from '../src/shared/spiderRestore';
import { LocalProxyServer } from '../src/main/server/LocalProxyServer';

let upstream: Server;
let proxy: LocalProxyServer;
let base: string;
let port: number;
const requests: Array<{ url: string; method: string; range?: string }> = [];
const pin = vi.fn();
const warn = vi.fn();
/** 模拟的「源侧 JVM」应答状态（用于还原成功/失败两种分支） */
let upstreamStatus = 200;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    requests.push({ url: req.url || '', method: req.method || '', range: req.headers.range });
    res.writeHead(req.headers.range ? 206 : upstreamStatus, {
      'Content-Type': 'video/mp4', 'Content-Length': '1',
      'Content-Range': 'bytes 0-0/100', 'Accept-Ranges': 'bytes',
    });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from([1]));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('missing upstream port');
  port = address.port;
  proxy = new LocalProxyServer({ i: () => {}, w: warn, e: () => {} });
  proxy.onSpiderProxy = pin;
  await proxy.start(0);
  const server = (proxy as unknown as { server: Server }).server;
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('missing proxy port');
  base = `http://127.0.0.1:${bound.port}`;
});

afterAll(async () => {
  proxy?.stop();
  if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe('/proxy/<actualJvmPort>', () => {
  it('指定实际端口并透传 Range/响应范围，同时钉住 JVM', async () => {
    const response = await fetch(`${base}/proxy/${port}?do=pan&site=baidu&fileId=812960976845060`, {
      headers: { Range: 'bytes=0-0' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-0/100');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1]));
    expect(requests.at(-1)).toMatchObject({ url: '/proxy?do=pan&site=baidu&fileId=812960976845060', range: 'bytes=0-0' });
    expect(pin).toHaveBeenCalledWith(port);
  });

  it('HEAD 透传到 JVM，不把媒体正文传回来', async () => {
    const response = await fetch(`${base}/proxy/${port}?do=pan`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(requests.at(-1)?.method).toBe('HEAD');
  });

  it('分享会话接口不能经过公共媒体中继，不触达 JVM', async () => {
    const count = requests.length;
    const response = await fetch(`${base}/proxy/${port}?do=winbox-baidu-context&fileId=812960976845060`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await response.text();
    expect(requests).toHaveLength(count);
  });
});

describe('/proxy/<port>?do=pan&action=… 的「恢复配置」观测', () => {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  /** 打一次自解链请求（命中同一条转发路径） */
  const hit = async (query: string): Promise<number> => {
    const res = await fetch(`${base}/proxy/${port}?${query}`);
    const s = res.status;
    await res.arrayBuffer();
    return s;
  };

  it('还原成功（2xx）：即使 JVM 之后立刻死掉，宿主也已经观测到 → 触发重启', async () => {
    upstreamStatus = 200;
    warn.mockClear();
    const restored = vi.fn();
    proxy.onSpiderConfigRestored = restored;

    const status = await hit('do=pan&action=runWebDavRecover&path=/winbox.json');
    expect(status).toBe(200);
    // ★ 关键：观测点必须在拿到应答的那一刻就落定，不能等转发完成
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('观测到源侧还原成功');

    // 延迟是为了让「恢复成功」的应答体完整送回浏览器，否则用户会误以为还原失败
    expect(restored, '不该在应答送达之前就重启').not.toHaveBeenCalled();
    await wait(RESTORE_RESTART_DELAY_MS + 400);
    expect(restored).toHaveBeenCalledTimes(1);
    expect(String(restored.mock.calls[0][0])).toContain('runWebDavRecover');
  }, 20_000);

  it('还原失败（非 2xx）：不触发重启，并说明原因', async () => {
    upstreamStatus = 500;
    warn.mockClear();
    const restored = vi.fn();
    proxy.onSpiderConfigRestored = restored;

    await hit('do=pan&action=runWebDavRecover&path=/broken.json');
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('未成功');
    expect(logged).toContain('500');

    await wait(RESTORE_RESTART_DELAY_MS + 400);
    expect(restored).not.toHaveBeenCalled();
    upstreamStatus = 200;
  }, 20_000);

  it('普通自解链动作（如 action=config）：不误伤，绝不重启', async () => {
    warn.mockClear();
    const restored = vi.fn();
    proxy.onSpiderConfigRestored = restored;

    await hit('do=pan&action=config');
    await wait(600);

    expect(restored, '误报会让用户正在浏览时被无故重启').not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('还原');
  });
});
