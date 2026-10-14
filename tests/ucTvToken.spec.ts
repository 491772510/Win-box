// tests/ucTvToken.spec.ts — UC TV Token（非会员 UC 原画）扫码协议单测。
// 守住的根因（见 src/main/net/ucTvToken.ts 头注释）：
//   jar 的 `merge.t0.h.g()` 用 `sha256hex(method + "&" + path + "&" + ts + SECRET)` 作 `x-pan-token`，
//   ts 作 `x-pan-tm`；`/oauth/code` 未确认时返回 errno=11003；兑换返回 data.access_token/refresh_token。
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  UCTV_SECRET,
  UCTV_CLIENT_ID,
  ucTvDeviceId,
  ucTvSign,
  ucTvHeaders,
  ucTvAuthorize,
  ucTvPollCode,
  ucTvExchange,
} from '../src/main/net/ucTvToken';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('ucTvToken — 签名与公参', () => {
  it('x-pan-token = sha256hex(`method&path&ts` + SECRET)（复刻 jar g()）', () => {
    const ts = 1791989096016;
    expect(ucTvSign('GET', '/oauth/authorize', ts)).toBe(sha256(`GET&/oauth/authorize&${ts}${UCTV_SECRET}`));
    // 与方法/路径强相关
    expect(ucTvSign('POST', '/token', ts)).toBe(sha256(`POST&/token&${ts}${UCTV_SECRET}`));
    expect(ucTvSign('GET', '/oauth/code', ts)).not.toBe(ucTvSign('GET', '/oauth/authorize', ts));
  });

  it('请求头含四项公参（x-pan-tm/x-pan-token/x-pan-client-id/content-type）', () => {
    const h = ucTvHeaders('GET', '/oauth/authorize', 1000);
    expect(h['x-pan-tm']).toBe('1000');
    expect(h['x-pan-token']).toBe(ucTvSign('GET', '/oauth/authorize', 1000));
    expect(h['x-pan-client-id']).toBe(UCTV_CLIENT_ID);
    expect(h['content-type']).toBe('text/plain;charset=UTF-8');
    expect(h['User-Agent']).toContain('Android');
  });

  it('设备 ID 缺省 = md5(毫秒字符串)，32 位十六进制（复刻 jar d()）', () => {
    const id = ucTvDeviceId(1791989096016);
    expect(id).toBe(createHash('md5').update('1791989096016', 'utf8').digest('hex'));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('ucTvToken — 三步流程', () => {
  it('取码：带上 req_id/device_id 与公参；返回 PNG data URL 与 query_token', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetcher = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrl = String(url);
      seenHeaders = (init?.headers || {}) as Record<string, string>;
      return jsonResponse({ status: 0, req_id: 'r1', query_token: 'qt-abc', qr_data: 'iVBORw0KGgoAAA\n' });
    }) as unknown as typeof globalThis.fetch;

    const s = await ucTvAuthorize('dev123', fetcher, 5000);
    expect(s.queryToken).toBe('qt-abc');
    expect(s.imageDataUrl).toBe('data:image/png;base64,iVBORw0KGgoAAA'); // 换行已剔除
    expect(s.reqId).toBeTruthy();
    expect(seenUrl).toContain('https://open-api-drive.uc.cn/oauth/authorize?req_id=');
    expect(seenUrl).toContain('device_id=dev123');
    expect(seenUrl).toContain(`client_id=${UCTV_CLIENT_ID}`);
    expect(seenUrl).toContain('auth_type=code');
    expect(seenUrl).toContain('scope=netdisk');
    expect(seenHeaders['x-pan-tm']).toBe('5000');
    expect(seenHeaders['x-pan-token']).toBe(ucTvSign('GET', '/oauth/authorize', 5000));
  });

  it('取码：status!=0 抛错（带 error_info）', async () => {
    const fetcher = (async () => jsonResponse({ status: -1, error_info: '公参缺失' })) as unknown as typeof globalThis.fetch;
    await expect(ucTvAuthorize('d', fetcher)).rejects.toThrow(/公参缺失/);
  });

  it('轮询：errno=11003（未确认）→ wait；status=0+code → ok；过期文案 → expired', async () => {
    const mk = (body: unknown) => (async () => jsonResponse(body)) as unknown as typeof globalThis.fetch;
    expect((await ucTvPollCode('r', 'q', 'd', mk({ status: -1, errno: 11003, error_info: '用户未确认授权' }))).state).toBe('wait');
    const ok = await ucTvPollCode('r', 'q', 'd', mk({ status: 0, code: 'C0DE' }));
    expect(ok).toMatchObject({ state: 'ok', code: 'C0DE' });
    expect((await ucTvPollCode('r', 'q', 'd', mk({ status: -1, errno: 11002, error_info: '二维码已过期，请重新生成' }))).state).toBe('expired');
    expect((await ucTvPollCode('r', 'q', 'd', mk({ status: -1, errno: 999, error_info: '其它异常' }))).state).toBe('error');
  });

  it('轮询：请求头用 /oauth/code 的签名路径，且回传 query_token', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetcher = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrl = String(url);
      seenHeaders = (init?.headers || {}) as Record<string, string>;
      return jsonResponse({ status: -1, errno: 11003 });
    }) as unknown as typeof globalThis.fetch;
    await ucTvPollCode('r1', 'qt-abc', 'dev123', fetcher, 7000);
    expect(seenUrl).toContain('/oauth/code?req_id=r1');
    expect(seenUrl).toContain('query_token=qt-abc');
    expect(seenHeaders['x-pan-token']).toBe(ucTvSign('GET', '/oauth/code', 7000));
  });

  it('兑换：data.access_token/refresh_token 均在 → ok，token = 响应体原文', async () => {
    const body = { code: 200, message: 'OK', data: { status: 0, access_token: 'AT', refresh_token: 'RT', expires_in: 7200 } };
    let seenBody = '';
    const fetcher = (async (_url: string, init?: { body?: string }) => {
      seenBody = String(init?.body || '');
      return jsonResponse(body);
    }) as unknown as typeof globalThis.fetch;
    const r = await ucTvExchange('r1', 'C0DE', 'dev123', fetcher);
    expect(r.ok).toBe(true);
    expect(r.token).toBe(JSON.stringify(body));
    expect(JSON.parse(seenBody)).toMatchObject({ req_id: 'r1', code: 'C0DE', device_id: 'dev123', channel: 'UCTVOFFICIALWEB', platform: 'tv' });
  });

  it('兑换：授权码无效 → 不 ok，带服务端 error_info', async () => {
    const fetcher = (async () =>
      jsonResponse({ code: 200, message: 'OK', data: { status: -1, errno: 11004, error_info: '授权码Code无效', access_token: '', refresh_token: '' } })) as unknown as typeof globalThis.fetch;
    const r = await ucTvExchange('r1', 'bad', 'dev123', fetcher);
    expect(r.ok).toBe(false);
    expect(r.hint).toContain('授权码Code无效');
  });
});
