// src/renderer/lib/platform.ts
// 渲染进程的平台事实缓存：只经 preload IPC 获取，不读取 Vite 环境里的 process.platform。
import { client, type AppPlatformName } from '../api/client';

let cachedPlatform: AppPlatformName | null = null;
let initTask: Promise<void> | null = null;

/**
 * 在 React 挂载前读取并缓存主进程归一化后的平台名。
 *
 * IPC 不可用时保守回退到 win32，确保旧版 preload 或启动异常不会改变既有 Windows UI。
 */
export async function initPlatform(): Promise<void> {
  if (cachedPlatform) return;
  if (initTask) return initTask;
  initTask = client
    .platform()
    .then((result) => {
      const value = result?.platform;
      cachedPlatform = value === 'darwin' || value === 'linux' || value === 'win32' ? value : 'win32';
    })
    .catch(() => {
      cachedPlatform = 'win32';
    })
    .finally(() => {
      initTask = null;
    });
  return initTask;
}

/** 返回已缓存的平台；初始化前以 win32 为安全默认值。 */
export function platform(): AppPlatformName {
  return cachedPlatform ?? 'win32';
}

/** 当前渲染进程是否运行在 macOS。 */
export function isMacRenderer(): boolean {
  return platform() === 'darwin';
}

/** 当前渲染进程是否运行在 Windows。 */
export function isWinRenderer(): boolean {
  return platform() === 'win32';
}

/** 当前渲染进程是否运行在 Linux。 */
export function isLinuxRenderer(): boolean {
  return platform() === 'linux';
}
