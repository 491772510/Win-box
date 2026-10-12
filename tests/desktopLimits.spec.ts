// tests/desktopLimits.spec.ts
// ★ 2026-10-13：桌面端「已知能力缺口」文案 + Go 代理载荷跳过判据。
//
// 这一组只测「说清楚」这条链路：native-bridge 摊平成一行的日志能不能被认出来，
// 以及识别后补发的说明里必须带上用户能对上号的关键词（Go 多线程服务 / 弹幕 / 115）。
// 一旦上游改了 native-bridge 的日志措辞，这里会先红 —— 免得提示悄悄失效。
import { describe, expect, it } from 'vitest';
import {
  GO_PROXY_LIMITATION_LOG,
  GO_PROXY_LIMITATION_UI,
  isGoProxySkipLine,
} from '../src/shared/desktopLimits';

describe('isGoProxySkipLine', () => {
  it('识别 native-bridge 实际输出的那条跳过日志（含完整路径）', () => {
    const line =
      '[native-bridge] 载荷库跳过（桌面不适用：Android root/Go 代理）: ' +
      'C:\\Users\\x\\AppData\\Roaming\\winbox\\spider\\tmp\\libwexproxy.so';
    expect(isGoProxySkipLine(line)).toBe(true);
  });

  it('大小写与写法变体都能命中（wexproxy / go_proxy / goproxy / Go 代理）', () => {
    expect(isGoProxySkipLine('[native-bridge] 载荷库跳过 … libWexProxy.so')).toBe(true);
    expect(isGoProxySkipLine('[native-bridge] 载荷库跳过 … libgo_proxy_arm64.so')).toBe(true);
    expect(isGoProxySkipLine('[native-bridge] 载荷库跳过 … goproxy')).toBe(true);
    expect(isGoProxySkipLine('[native-bridge] 载荷库跳过（桌面不适用：Android root/Go 代理）')).toBe(true);
  });

  it('其它载荷的跳过/装载日志不会被误判', () => {
    expect(isGoProxySkipLine('[native-bridge] 载荷库装载失败（其 native 调用将不可用）: libdecjni.so')).toBe(false);
    expect(isGoProxySkipLine('[native-bridge] 载荷库跳过（桌面不适用）: libLoadNiMa.so')).toBe(false);
    expect(isGoProxySkipLine('[native-bridge] payload ready: libdecjni.so')).toBe(false);
    expect(isGoProxySkipLine('')).toBe(false);
  });

  it('空值/非法值不抛异常（桩产出的行可能被截断）', () => {
    expect(isGoProxySkipLine(undefined as unknown as string)).toBe(false);
    expect(isGoProxySkipLine(null as unknown as string)).toBe(false);
  });
});

describe('Go 代理限制文案', () => {
  it('日志文案点明「Go 多线程服务」并交代影响面', () => {
    expect(GO_PROXY_LIMITATION_LOG).toContain('Go 多线程服务');
    expect(GO_PROXY_LIMITATION_LOG).toContain('libwexproxy.so');
    expect(GO_PROXY_LIMITATION_LOG).toContain('弹幕');
    expect(GO_PROXY_LIMITATION_LOG).toContain('115');
  });

  it('界面文案强调「打开了也不会生效」，且承诺其余功能不受影响', () => {
    expect(GO_PROXY_LIMITATION_UI).toContain('Go 多线程服务');
    expect(GO_PROXY_LIMITATION_UI).toContain('不会生效');
    expect(GO_PROXY_LIMITATION_UI).toContain('其余功能不受影响');
  });
});
