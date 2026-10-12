// tests/menu.spec.ts
// ★ 2026-10-12（macOS 适配 T02 / P1-1）：macOS 应用菜单。
//   两条硬约束：
//   ① **非 darwin 一律 no-op**（Windows 完全无感 —— 全应用零菜单的现状必须保持不变）；
//   ② darwin 必须注册 App / 编辑 / 窗口 / 帮助 四组，且 Cmd+Q / Cmd+W / Cmd+, 三个
//      关键 role 都在（否则 Mac 上拿不到退出/关窗/设置）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTest, withPlatform } from '../src/shared/platform';

const menu = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  buildFromTemplate: vi.fn((t: unknown) => ({ __template: t })),
}));

vi.mock('electron', () => ({
  Menu: {
    setApplicationMenu: (...a: unknown[]) => menu.setApplicationMenu(...(a as [])),
    buildFromTemplate: (t: unknown) => menu.buildFromTemplate(t),
  },
  shell: { openExternal: vi.fn() },
  app: { getVersion: () => '1.20.10', getName: () => 'Win-Box' },
}));

import { buildAppMenu, installApplicationMenu } from '../src/main/menu';

afterEach(() => {
  menu.setApplicationMenu.mockClear();
  menu.buildFromTemplate.mockClear();
  setPlatformForTest(null);
});

/** 把菜单模板摊平成「label / role / accelerator」清单，便于断言 */
interface FlatItem {
  label?: string;
  role?: string;
  accelerator?: string;
  submenu?: FlatItem[];
}
function flatten(items: FlatItem[]): FlatItem[] {
  const out: FlatItem[] = [];
  for (const it of items) {
    out.push(it);
    if (Array.isArray(it.submenu)) out.push(...flatten(it.submenu as FlatItem[]));
  }
  return out;
}

describe('menu — 非 darwin 必须 no-op（Windows 零影响）', () => {
  it('win32：installApplicationMenu 返回 false 且不碰 Menu.setApplicationMenu', () => {
    const ok = withPlatform('win32', () => installApplicationMenu());
    expect(ok).toBe(false);
    expect(menu.setApplicationMenu).not.toHaveBeenCalled();
    expect(menu.buildFromTemplate).not.toHaveBeenCalled();
  });

  it('win32：buildAppMenu 返回空模板', () => {
    expect(withPlatform('win32', () => buildAppMenu())).toEqual([]);
    expect(buildAppMenu({}, 'win32')).toEqual([]);
    expect(buildAppMenu({}, 'linux')).toEqual([]);
  });
});

describe('menu — darwin 四组 role 菜单', () => {
  it('注册 App / 编辑 / 窗口 / 帮助 四组', () => {
    const t = buildAppMenu({}, 'darwin');
    expect(t.length).toBe(4);
    expect(t.map((x) => x.label)).toEqual(['Win-Box', '编辑', '窗口', '帮助']);
  });

  it('★ Cmd+Q 退出 / Cmd+W 关窗 / Cmd+, 设置 三个关键入口齐全', () => {
    const flat = flatten(buildAppMenu({ onPreferences: () => undefined }, 'darwin') as FlatItem[]);
    const roles = flat.map((x) => x.role);
    expect(roles).toContain('quit'); // Cmd+Q
    expect(roles).toContain('close'); // Cmd+W
    const prefs = flat.find((x) => x.label === '设置…');
    expect(prefs).toBeTruthy();
    expect(prefs?.accelerator).toBe('CmdOrCtrl+,');
  });

  it('编辑组含撤销/重做/剪切/拷贝/粘贴/全选', () => {
    const flat = flatten(buildAppMenu({}, 'darwin') as FlatItem[]);
    const roles = flat.map((x) => x.role);
    for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(roles).toContain(r);
    }
  });

  it('窗口组含最小化/缩放/前置全部窗口', () => {
    const flat = flatten(buildAppMenu({}, 'darwin') as FlatItem[]);
    const roles = flat.map((x) => x.role);
    for (const r of ['minimize', 'zoom', 'front']) expect(roles).toContain(r);
  });

  it('installApplicationMenu 在 darwin 下真正调用 setApplicationMenu', () => {
    const ok = withPlatform('darwin', () => installApplicationMenu());
    expect(ok).toBe(true);
    expect(menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });

  it('未传 onPreferences 时不注册「设置…」（不暴露点了没反应的菜单项）', () => {
    const flat = flatten(buildAppMenu({}, 'darwin') as FlatItem[]);
    expect(flat.some((x) => x.label === '设置…')).toBe(false);
  });

  it('onAbout / onPreferences 回调被挂上且可触发', () => {
    const about = vi.fn();
    const prefs = vi.fn();
    const flat = flatten(buildAppMenu({ onAbout: about, onPreferences: prefs }, 'darwin') as FlatItem[]);
    const aboutItem = flat.find((x) => x.role === 'about');
    const prefsItem = flat.find((x) => x.label === '设置…');
    (aboutItem as unknown as { click: () => void }).click();
    (prefsItem as unknown as { click: () => void }).click();
    expect(about).toHaveBeenCalledTimes(1);
    expect(prefs).toHaveBeenCalledTimes(1);
  });

  it('版本号展示来自入参或 app.getVersion()', () => {
    const flat = flatten(buildAppMenu({ version: '9.9.9' }, 'darwin') as FlatItem[]);
    expect(flat.some((x) => x.label === '版本 9.9.9')).toBe(true);
  });
});
