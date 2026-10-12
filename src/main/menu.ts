// src/main/menu.ts
// ★ 2026-10-12（macOS 适配 P1-1）：macOS 应用菜单。
//
// 背景：本应用所有窗口都是 `frame:false` + `autoHideMenuBar:true` —— **全应用零菜单**。
// 在 Windows 上无感（标题栏自己画、Ctrl+C/V 由系统处理），但在 macOS 上意味着：
//   - 没有「退出 Win-Box」（Cmd+Q 无响应）；
//   - 没有「关闭窗口」（Cmd+W 无响应）；
//   - 没有「设置…」（Cmd+, 无响应）；
//   - 没有「编辑」菜单（复制/粘贴/全选拿不到，剪贴板操作全靠系统快捷键碰运气）。
//
// 设计：
//   - 全部用 Electron 内置 `role`（不自己实现行为，行为由系统/Chromium 提供，最稳）；
//   - **非 darwin 一律 no-op**（`installApplicationMenu` 直接 return），Windows 零影响；
//   - 「关于 / 设置」通过回调注入（发 IPC 让渲染层跳页），不在此处依赖任何窗口模块。

import { Menu, shell, app, type MenuItemConstructorOptions } from 'electron';
import { isMac, platformName, type PlatformName } from '../shared/platform';
import { UPDATE_RELEASES_PAGE } from '../shared/update';

export interface AppMenuOptions {
  /** 菜单里展示的版本号（缺省取 `app.getVersion()`） */
  version?: string;
  /** 「关于 Win-Box」（App 菜单第一项）→ 打开说明页 */
  onAbout?: () => void;
  /** 「设置…」（Cmd+,）→ 打开配置页 */
  onPreferences?: () => void;
}

/**
 * 构造 darwin 应用菜单模板（纯函数：不碰 Electron 运行时，便于单测）。
 * 非 darwin 返回 []（调用方 `installApplicationMenu` 会直接 no-op）。
 */
export function buildAppMenu(o: AppMenuOptions = {}, p: PlatformName = platformName()): MenuItemConstructorOptions[] {
  if (!isMac(p)) return [];

  const version = (o.version || '').trim() || safeAppVersion();
  const productName = safeAppName();
  const about = o.onAbout;
  const prefs = o.onPreferences;

  const appMenu: MenuItemConstructorOptions = {
    label: productName,
    submenu: [
      {
        label: `关于 ${productName}`,
        role: 'about',
        // ★ role:'about' 在 darwin 上由系统绘制面板；这里额外挂 click 让「说明页」也能被打开
        ...(about ? { click: () => about() } : {}),
      },
      { type: 'separator' },
      ...(version ? [{ label: `版本 ${version}`, enabled: false } as MenuItemConstructorOptions, { type: 'separator' } as MenuItemConstructorOptions] : []),
      { label: '服务', role: 'services' },
      { type: 'separator' },
      { label: `隐藏 ${productName}`, role: 'hide' },
      { label: '隐藏其他', role: 'hideOthers' },
      { label: '显示全部', role: 'unhide' },
      { type: 'separator' },
      { label: `退出 ${productName}`, role: 'quit' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '拷贝', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
      { label: '删除', role: 'delete' },
      { label: '全选', role: 'selectAll' },
      ...(prefs
        ? [
            { type: 'separator' } as MenuItemConstructorOptions,
            // ★ 不用 `role:'preferences'`（该 role 在本版 Electron 的类型定义与运行时行为
            //   都不稳定，且我们要自己发 IPC 让渲染层跳配置页）→ 直接用 click + 快捷键。
            {
              label: '设置…',
              accelerator: 'CmdOrCtrl+,',
              click: () => prefs(),
            } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '窗口',
    submenu: [
      { label: '最小化', role: 'minimize' },
      { label: '缩放', role: 'zoom' },
      { type: 'separator' },
      { label: '关闭窗口', role: 'close' },
      { type: 'separator' },
      { label: '前置全部窗口', role: 'front' },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: '帮助',
    submenu: [
      {
        label: '最新版本与更新说明',
        click: () => {
          void shell.openExternal(UPDATE_RELEASES_PAGE);
        },
      },
    ],
  };

  return [appMenu, editMenu, windowMenu, helpMenu];
}

function safeAppVersion(): string {
  try {
    return app?.getVersion?.() || '';
  } catch {
    return '';
  }
}

function safeAppName(): string {
  try {
    return app?.getName?.() || 'Win-Box';
  } catch {
    return 'Win-Box';
  }
}

/**
 * 安装应用菜单。**非 darwin 直接 return（no-op）** —— Windows 完全无感。
 * 失败（极早期调用 / Menu 不可用）一律吞掉：菜单缺失不该影响启动。
 */
export function installApplicationMenu(o: AppMenuOptions = {}): boolean {
  if (!isMac()) return false;
  try {
    const template = buildAppMenu(o);
    if (!template.length) return false;
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return true;
  } catch {
    return false;
  }
}
