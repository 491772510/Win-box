// tests/playResume.spec.ts
// ★ 2026-10-13 回归（用户报）：「用 MPV 内核播放，时间直接跳到最后」。
//
// 根因：HTML5 内核的续播有「贴尾 5 秒不跳」的闸门，MPV 内核没有 —— 而 MPV 的续播点是**加载前**
//   通过 `--start=<秒>` 下发的（buildMpvArgs），那一刻拿不到真实时长，无从判断续播点是否已贴到片尾。
//   结果：上一集看到 44:50（总长 45:00）后再点开，mpv 真的从 44:50 起播，播 10 秒就 EOF，
//   画面停在末帧 —— 观感就是「一打开时间就跳到最后」。
//
// 修法：`playTime` 之外**再记一份时长 `playDur`**，起播前用 `resumeStart()` 统一裁定；
//   首次播放（无历史时长）由 VideoPlayer 的运行时兜底补刀。两个内核共用同一口径。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  uiMem,
  setPlayTime,
  setPlayDur,
  resumeStart,
  saveUiMemory,
  loadUiMemory,
  clearUiMemory,
  RESUME_MIN_SEC,
  RESUME_TAIL_GUARD,
} from '../src/renderer/lib/uiMemory';

/** 测试环境是 node（无 jsdom）→ 最小 localStorage 桩（与 uiHistoryTombstone.spec.ts 同款） */
const memStore = new Map<string, string>();
beforeAll(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
    setItem: (k: string, v: string) => void memStore.set(k, String(v)),
    removeItem: (k: string) => void memStore.delete(k),
    clear: () => memStore.clear(),
  };
});

beforeEach(() => {
  memStore.clear();
  uiMem.playTime.clear();
  uiMem.playDur.clear();
  uiMem.history.clear();
});

afterEach(() => {
  clearUiMemory();
  memStore.clear();
});

describe('resumeStart — 续播点裁定（两内核共用口径）', () => {
  it('片头几秒 / 0 / 负数 / NaN → 不跳（从头播）', () => {
    expect(resumeStart(0, 2700)).toBe(0);
    expect(resumeStart(2, 2700)).toBe(0);
    expect(resumeStart(RESUME_MIN_SEC, 2700)).toBe(0);
    expect(resumeStart(-30, 2700)).toBe(0);
    expect(resumeStart(Number.NaN, 2700)).toBe(0);
    expect(resumeStart(undefined, 2700)).toBe(0);
  });

  it('正常续播点 → 原样返回（取整）', () => {
    expect(resumeStart(600, 2700)).toBe(600);
    expect(resumeStart(600.7, 2700)).toBe(600);
  });

  it(`★ 贴到片尾 ${RESUME_TAIL_GUARD} 秒内 → 视为已看完，从头播（改前会跳到 44:56 播 4 秒即 EOF）`, () => {
    expect(resumeStart(2696, 2700)).toBe(0); // 距结尾 4s
    expect(resumeStart(2695, 2700)).toBe(0); // 恰好 = dur - GUARD
    expect(resumeStart(2690, 2700)).toBe(2690); // 距结尾 10s → 仍按续播处理（与 HTML5 内核同口径）
  });

  it('★ 完整看完（进度 == 总长）→ 下次从头播（改前必然跳到末帧）', () => {
    expect(resumeStart(2700, 2700)).toBe(0);
    expect(resumeStart(2699, 2700)).toBe(0);
  });

  it('续播点超过总时长（换源后片子变短）→ 从头播', () => {
    expect(resumeStart(5000, 2700)).toBe(0);
  });

  it('未知时长（首次播放 / 直播）→ 保守放行，交给运行时兜底', () => {
    expect(resumeStart(600, 0)).toBe(600);
    expect(resumeStart(600, undefined)).toBe(600);
    expect(resumeStart(600, Number.NaN)).toBe(600);
  });
});

describe('playDur — 时长记忆（起播前判定贴尾的依据）', () => {
  it('只记有效时长（0 / 负 / NaN / 空 url 一律忽略）', () => {
    setPlayDur('u', 2700);
    expect(uiMem.playDur.get('u')).toBe(2700);
    setPlayDur('u', 0);
    expect(uiMem.playDur.get('u')).toBe(2700); // 不被 0 覆盖
    setPlayDur('u', -1);
    expect(uiMem.playDur.get('u')).toBe(2700);
    setPlayDur('u', Number.NaN);
    expect(uiMem.playDur.get('u')).toBe(2700);
    setPlayDur('', 123);
    expect(uiMem.playDur.has('')).toBe(false);
  });

  it('与 playTime 一起跨落盘往返（重启后仍能判贴尾）', () => {
    setPlayTime('http://x/1.m3u8', 2696);
    setPlayDur('http://x/1.m3u8', 2700);
    saveUiMemory();

    uiMem.playTime.clear();
    uiMem.playDur.clear();
    loadUiMemory();

    expect(uiMem.playDur.get('http://x/1.m3u8')).toBe(2700);
    expect(resumeStart(uiMem.playTime.get('http://x/1.m3u8'), uiMem.playDur.get('http://x/1.m3u8'))).toBe(0);
  });

  it('★ 端到端：看到片尾 → 存盘 → 下次起播裁定为 0（改前 = 2690）', () => {
    const url = 'http://x/ep12.m3u8';
    // 播放中：进度推进到 2696s，时长 2700s（两边都会实时入账）
    setPlayTime(url, 2696);
    setPlayDur(url, 2700);
    saveUiMemory();

    // 下次打开（模拟重启：内存清空后从盘上恢复）
    uiMem.playTime.clear();
    uiMem.playDur.clear();
    loadUiMemory();

    const saved = uiMem.playTime.get(url) || 0;
    const startAt = resumeStart(saved, uiMem.playDur.get(url) || 0);
    expect(startAt).toBe(0);
  });

  it('端到端：看到中段 → 下次起播回到中段（续播仍然可用）', () => {
    const url = 'http://x/ep12.m3u8';
    setPlayTime(url, 900);
    setPlayDur(url, 2700);
    saveUiMemory();

    uiMem.playTime.clear();
    uiMem.playDur.clear();
    loadUiMemory();

    expect(resumeStart(uiMem.playTime.get(url), uiMem.playDur.get(url))).toBe(900);
  });
});
