// src/main/util/toolProbe.ts
// ★ 2026-10-12（macOS 适配 P0-2 / G4「依赖可观测」）：**统一的外部依赖探测链**。
//
// 背景：此前每个模块各探各的（mpvCore 探 mpv、HtmlMedia 只看随包 ffmpeg、Aria2Sidecar 只看
// 随包 aria2c），macOS 上仓库里没有随包二进制 → 全线「缺失」且没有一句人话指引。
//
// 探测优先级（全项目恒定，不得为某个工具改顺序）：
//   ① 用户覆盖 override → ② 本机探测 system → ③ 随包内置 bundled → ④ none（+ 人话 hint）
//
// ★★ 「本机优先、内置兜底」是**用户拍板的需求**（2026-10-12，T03 媒体工程师反馈后 team-lead 复核定稿）：
//   用户装了 Homebrew / `/Applications` 的版本就用他装的那份（能自己升级、编解码更全），
//   只有本机找不到才回退到随包二进制。原实现是「内置优先」，与需求相反，已修正。
//   ⚠️ 这不影响 Windows：`platform.ts` 的 `systemToolCandidates()` 第一行就是
//      `if (!isMac(p)) return [];` —— win32 下本机候选恒为空数组，故 ②③ 交换对 win32
//      行为零影响（既有 win32 护栏断言仍逐项成立，见 `tests/toolProbe.spec.ts`）。
//   ⚠️ `mpvCore.resolveMpvPath()` **不走本模块**，它有自己的链且**刻意保持「内置优先」**
//      （win32 上 bundled 与 `Program Files\mpv\mpv.exe` 可能同时存在，重排会改变 Windows
//      既有选择）—— 改本文件时**不要顺手去改 resolveMpvPath**。
//
// 本模块**纯逻辑**：不 import electron、不 import node:fs —— 存在性判定由调用方注入 `exists`，
// 与既有 `resolveMpvPath` / `pickPlayers` / `pickResourceRoot` 同一风格（零成本单测）。
import {
  exeName,
  installHint,
  pathBinDirs,
  platformName,
  systemBinDirs,
  systemToolCandidates,
  type PlatformName,
  type ToolId,
  type ToolProbeResult,
} from '../../shared/platform';

export interface ProbeOptions {
  tool: ToolId;
  /** 用户配置覆盖（绝对路径或可执行名） */
  override?: string;
  /** 随包内置绝对路径（`resources/<dir>/<exe>`）；空 = 不内置 */
  bundled?: string;
  /** 是否允许本机探测（默认 true） */
  allowSystem?: boolean;
  /** 缺省 = 当前真实平台 */
  platform?: PlatformName;
  env?: Record<string, string | undefined>;
  home?: string;
  /** 注入，便于单测（不 import node:fs） */
  exists: (p: string) => boolean;
}

/** 批量探测入参（`exists` 由第二个参数统一提供） */
export type ProbeToolInput = Omit<ProbeOptions, 'exists'> & {
  exists?: (p: string) => boolean;
};

const NONE: ToolProbeResult = { path: '', source: 'none', hint: '' };

/** 安全存在性判定：非法路径（通配符等）一律视为不存在，绝不抛异常 */
function safeExists(exists: (p: string) => boolean, p: string): boolean {
  if (!p) return false;
  try {
    return !!exists(p);
  } catch {
    return false;
  }
}

/** 是否「绝对路径形态」（含分隔符或盘符）；否则视为裸可执行名 */
function looksAbsolute(p: string): boolean {
  return p.includes('/') || p.includes('\\') || /^[A-Za-z]:/.test(p);
}

/** 来源描述（人话；用于配置页/日志展示来源） */
function sourceHint(tool: ToolId, source: 'override' | 'bundled' | 'system', path: string): string {
  if (source === 'override') return `用户指定路径：${path}`;
  if (source === 'bundled') return `随包内置：${path}`;
  return `本机安装：${path}`;
}

/**
 * 探测单个依赖（纯函数）。
 *
 * 顺序（★ 用户拍板：「自动探测优先、内置兜底」）：
 *  ① `override` 非空且存在 → `override`（不存在则**继续往下探**，与既有 `resolveMpvPath` 同口径：
 *     用户填错了不至于直接把功能关死）；
 *     `override` 是裸可执行名（如 `mpv`）→ 在系统 bin / PATH 目录里按名字找；
 *  ② `allowSystem !== false` → `systemToolCandidates()` 逐个探测（让用户装的 Homebrew /
 *     `/Applications` 版本能用上，可自行升级）；
 *  ③ `bundled` 存在 → `bundled`（本机找不到才用随包二进制）；
 *  ④ 全部落空 → `{ path: '', source: 'none', hint: installHint(tool, platform) }`。
 */
export function probeTool(o: ProbeOptions): ToolProbeResult {
  const p = o.platform ?? platformName();
  const exists = o.exists;
  const env = o.env || {};

  // ① 用户覆盖
  const ov = (o.override || '').trim();
  if (ov) {
    if (safeExists(exists, ov)) {
      return { path: ov, source: 'override', hint: sourceHint(o.tool, 'override', ov) };
    }
    if (!looksAbsolute(ov)) {
      // 裸可执行名：在系统 bin + PATH 里找同名可执行文件
      const name = exeName(ov, p);
      const dirs = [...systemBinDirs(p), ...pathBinDirs(env, p)];
      for (const d of dirs) {
        const cand = d ? `${d.replace(/\/+$/, '')}/${name}` : name;
        if (safeExists(exists, cand)) {
          return { path: cand, source: 'override', hint: sourceHint(o.tool, 'override', cand) };
        }
      }
    }
  }

  // ② 本机探测（★ 优先于随包内置 —— 用户装的那份可自行升级、编解码更全）
  if (o.allowSystem !== false) {
    const cands = systemToolCandidates(o.tool, { env, home: o.home }, p);
    for (const c of cands) {
      if (safeExists(exists, c)) {
        return { path: c, source: 'system', hint: sourceHint(o.tool, 'system', c) };
      }
    }
  }

  // ③ 随包内置（本机找不到才回退）
  const bundled = (o.bundled || '').trim();
  if (bundled && safeExists(exists, bundled)) {
    return { path: bundled, source: 'bundled', hint: sourceHint(o.tool, 'bundled', bundled) };
  }

  // ④ none
  return { path: '', source: 'none', hint: installHint(o.tool, p) };
}

/**
 * 批量探测（启动日志打点用）。
 * 返回 `Record<ToolId, ToolProbeResult>`（键 = tool id）；单个 `exists` 统一注入。
 */
export function probeTools(
  list: ProbeToolInput[],
  exists: (p: string) => boolean,
): Record<string, ToolProbeResult> {
  const out: Record<string, ToolProbeResult> = {};
  for (const item of list) {
    const { exists: own, ...rest } = item;
    out[String(item.tool)] = probeTool({ ...rest, exists: own ?? exists } as ProbeOptions);
  }
  return out;
}

/** 便捷构造：`probeTool` 的空结果（供调用方兜底） */
export function probeNone(tool: ToolId, p: PlatformName = platformName()): ToolProbeResult {
  return { ...NONE, hint: installHint(tool, p) };
}
