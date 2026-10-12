// tests/platform.spec.ts
// ★ 2026-10-12（macOS 适配 T01）：`src/shared/platform.ts` 的 **win32 / darwin 双向**断言。
//
// 这是整个 macOS 适配的地基：平台真源一旦漂，上层（资源根 / 数据目录 / mpv IPC / 探测链）
// 全跟着漂。所有新增用例**显式传 platform**，保证在任何主机上结果确定。
//
// 同时锁死 Windows 零回归：win32 的每一项都等于「改动前写死的行为」。
import { describe, it, expect, afterEach } from 'vitest';
import {
  appBundleBinary,
  appBundleRoots,
  archTag,
  classpathSep,
  dmgArtifactName,
  envPathSep,
  exeName,
  hasPortableLayout,
  homebrewBinDirs,
  installHint,
  isLinux,
  isMac,
  isWin,
  javaExeName,
  joinClasspath,
  mpvEmbedSupported,
  mpvIpcPath,
  packagedResourcesRel,
  pathBinDirs,
  platformName,
  pythonExeName,
  setArchForTest,
  setPlatformForTest,
  shouldQuitAfterLaunchingInstaller,
  shouldQuitOnLastWindowClosed,
  shouldRelocateUserData,
  shouldStopProxyOnLastWindowClosed,
  spawnOptions,
  systemBinDirs,
  systemToolCandidates,
  withArch,
  withPlatform,
  type PlatformName,
} from '../src/shared/platform';

afterEach(() => {
  // ★ 注入是全局的（挂 globalThis），用完必须还原，避免污染同进程的其它 spec
  setPlatformForTest(null);
  setArchForTest(null);
});

describe('platform — 判定与注入', () => {
  it('三态判定（显式传参，跨主机确定）', () => {
    expect(isWin('win32')).toBe(true);
    expect(isWin('darwin')).toBe(false);
    expect(isMac('darwin')).toBe(true);
    expect(isMac('win32')).toBe(false);
    expect(isLinux('linux')).toBe(true);
    expect(isLinux('darwin')).toBe(false);
  });

  it('platformName() 归一到三态（其余平台归 linux）', () => {
    const p = platformName();
    expect(['win32', 'darwin', 'linux']).toContain(p);
  });

  it('setPlatformForTest / withPlatform 可注入，withPlatform 自动还原', () => {
    setPlatformForTest('darwin');
    expect(isMac()).toBe(true);
    setPlatformForTest(null);
    expect(isMac()).toBe(platformName() === 'darwin');

    const before = platformName();
    const inner = withPlatform('darwin', () => platformName());
    expect(inner).toBe('darwin');
    expect(platformName()).toBe(before);
  });

  it('withPlatform 在回调抛异常时同样还原（finally 语义）', () => {
    const before = platformName();
    expect(() =>
      withPlatform('darwin', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(platformName()).toBe(before);
  });

  it('archTag：arm64/x64 直出，未知架构为 ""', () => {
    expect(archTag('arm64')).toBe('arm64');
    expect(archTag('x64')).toBe('x64');
    expect(archTag('ia32')).toBe('');
    expect(archTag('unknown')).toBe('');
    expect(withArch('arm64', () => archTag())).toBe('arm64');
  });
});

describe('platform — 可执行文件名与分隔符（win32 / darwin 双向）', () => {
  it('exeName：win32 补 .exe，darwin 不带；已带后缀时各自原样/剥离', () => {
    expect(exeName('mpv', 'win32')).toBe('mpv.exe');
    expect(exeName('mpv', 'darwin')).toBe('mpv');
    expect(exeName('mpv.exe', 'win32')).toBe('mpv.exe'); // 已带 → 原样
    expect(exeName('mpv.exe', 'darwin')).toBe('mpv'); // mac 上没有 .exe → 剥离
    expect(exeName('MPV.EXE', 'win32')).toBe('MPV.EXE'); // 大小写不敏感
    expect(exeName('', 'win32')).toBe('');
  });

  it('javaExeName / pythonExeName', () => {
    expect(javaExeName('win32')).toBe('java.exe');
    expect(javaExeName('darwin')).toBe('java');
    expect(pythonExeName('win32')).toBe('python.exe');
    expect(pythonExeName('darwin')).toBe('python3'); // ★ macOS 没有 python（只有 python3）
  });

  it('classpathSep：win32 ";" / darwin ":"（★ JVM 在 Unix 上必须用 :）', () => {
    expect(classpathSep('win32')).toBe(';');
    expect(classpathSep('darwin')).toBe(':');
    expect(joinClasspath(['a.jar', 'b.jar'], 'win32')).toBe('a.jar;b.jar');
    expect(joinClasspath(['a.jar', 'b.jar'], 'darwin')).toBe('a.jar:b.jar');
    expect(joinClasspath(['a.jar', '', '  ', 'b.jar'], 'darwin')).toBe('a.jar:b.jar'); // 空片段过滤
  });

  it('envPathSep：win32 ";" / darwin ":"', () => {
    expect(envPathSep('win32')).toBe(';');
    expect(envPathSep('darwin')).toBe(':');
    expect(pathBinDirs({ PATH: '/usr/bin:/opt/homebrew/bin' }, 'darwin')).toEqual([
      '/usr/bin',
      '/opt/homebrew/bin',
    ]);
    expect(pathBinDirs({ Path: 'C:\\bin;C:\\other' }, 'win32')).toEqual(['C:\\bin', 'C:\\other']);
    expect(pathBinDirs({}, 'darwin')).toEqual([]);
    expect(pathBinDirs({ PATH: '/a:/a:/b' }, 'darwin')).toEqual(['/a', '/b']); // 去重
  });
});

describe('platform — 目录约定（darwin 有、win32 空）', () => {
  it('homebrewBinDirs / systemBinDirs', () => {
    expect(homebrewBinDirs('darwin')).toContain('/opt/homebrew/bin');
    expect(homebrewBinDirs('darwin')).toContain('/usr/local/bin');
    expect(homebrewBinDirs('win32')).toEqual([]);
    expect(systemBinDirs('darwin')).toContain('/usr/bin');
    expect(systemBinDirs('win32')).toEqual([]);
  });

  it('appBundleRoots：/Applications + ~/Applications；win32 为空', () => {
    expect(appBundleRoots('/Users/u', 'darwin')).toEqual(['/Applications', '/Users/u/Applications']);
    expect(appBundleRoots('', 'darwin')).toEqual(['/Applications']);
    expect(appBundleRoots('/Users/u', 'win32')).toEqual([]);
  });

  it('appBundleBinary：<root>/X.app/Contents/MacOS/<bin>', () => {
    expect(appBundleBinary('/Applications', 'VLC', 'VLC', 'darwin')).toBe(
      '/Applications/VLC.app/Contents/MacOS/VLC',
    );
    expect(appBundleBinary('/Users/u/Applications', 'IINA.app', undefined, 'darwin')).toBe(
      '/Users/u/Applications/IINA.app/Contents/MacOS/IINA',
    );
    expect(appBundleBinary('/Applications', 'mpv', 'mpv', 'win32')).toBe(''); // 非 darwin
  });

  it('packagedResourcesRel：darwin = ../Resources；win32 为空', () => {
    expect(packagedResourcesRel('darwin')).toEqual(['..', 'Resources']);
    expect(packagedResourcesRel('win32')).toEqual([]);
  });
});

describe('platform — 子进程与 mpv IPC', () => {
  it('spawnOptions：win32 windowsHide=true，darwin false', () => {
    expect(spawnOptions('win32')).toEqual({ windowsHide: true });
    expect(spawnOptions('darwin')).toEqual({ windowsHide: false });
  });

  it('mpvIpcPath：win32 命名管道 / darwin unix socket', () => {
    const win = mpvIpcPath({ pid: 1234, seq: 2, nonce: 'abc' }, 'win32');
    expect(win.startsWith('\\\\.\\pipe\\')).toBe(true);
    expect(win).toBe('\\\\.\\pipe\\winbox-mpv-1234-2-abc');
    expect(win.includes('.sock')).toBe(false);

    const mac = mpvIpcPath({ pid: 1234, seq: 2, nonce: 'abc', tmpDir: '/tmp/wb' }, 'darwin');
    expect(mac.startsWith('/')).toBe(true);
    expect(mac.endsWith('.sock')).toBe(true);
    expect(mac).toBe('/tmp/wb/winbox-mpv-1234-2-abc.sock');

    // nonce 缺省时省略该段（与既有 MpvController 形态一致）
    expect(mpvIpcPath({ pid: 1, seq: 0 }, 'win32')).toBe('\\\\.\\pipe\\winbox-mpv-1-0');
    expect(mpvIpcPath({ pid: 1, seq: 0, tmpDir: '/t' }, 'darwin')).toBe('/t/winbox-mpv-1-0.sock');
  });

  it('mpvEmbedSupported（风险 R1 总闸）：win32 恒真；darwin 可用环境变量关', () => {
    expect(mpvEmbedSupported({}, 'win32')).toBe(true);
    expect(mpvEmbedSupported({ WINBOX_MAC_MPV_EMBED: '0' }, 'win32')).toBe(true); // win32 不受影响
    expect(mpvEmbedSupported({}, 'darwin')).toBe(true);
    expect(mpvEmbedSupported({ WINBOX_MAC_MPV_EMBED: '0' }, 'darwin')).toBe(false);
    expect(mpvEmbedSupported({ WINBOX_MAC_MPV_EMBED: 'false' }, 'darwin')).toBe(false);
    expect(mpvEmbedSupported({ WINBOX_MAC_MPV_EMBED: '1' }, 'darwin')).toBe(true);
  });
});

describe('platform — 数据目录语义（★ 绝不写进 .app）', () => {
  it('shouldRelocateUserData：win32 true（现状），darwin false', () => {
    expect(shouldRelocateUserData('win32')).toBe(true);
    expect(shouldRelocateUserData('darwin')).toBe(false);
    expect(shouldRelocateUserData('linux')).toBe(false);
  });

  it('hasPortableLayout：仅 win32（7z-out 是 NSIS portable 专有）', () => {
    expect(hasPortableLayout('win32')).toBe(true);
    expect(hasPortableLayout('darwin')).toBe(false);
  });
});

describe('platform — 窗口生命周期语义（★ macOS 关窗不退出、不停代理）', () => {
  it('shouldQuitOnLastWindowClosed：win32 true（现状），darwin false（常驻 Dock）', () => {
    expect(shouldQuitOnLastWindowClosed('win32')).toBe(true);
    expect(shouldQuitOnLastWindowClosed('darwin')).toBe(false);
  });

  it('★ shouldStopProxyOnLastWindowClosed：darwin false（关窗后保留代理，重开能接着播）', () => {
    expect(shouldStopProxyOnLastWindowClosed('win32')).toBe(true);
    expect(shouldStopProxyOnLastWindowClosed('darwin')).toBe(false);
  });

  it('两者在 win32 上都为 true（既有行为：stop + quit 连用）', () => {
    expect(shouldStopProxyOnLastWindowClosed('win32') && shouldQuitOnLastWindowClosed('win32')).toBe(
      true,
    );
  });
});

describe('platform — 更新安装后的退出语义（★ darwin 不能退）', () => {
  it('★ win32 true：NSIS 覆盖安装需要独占安装目录（既有行为，一字不动）', () => {
    expect(shouldQuitAfterLaunchingInstaller('win32')).toBe(true);
  });

  it('★ darwin false：dmg 挂载后要用户手动拖拽覆盖，退出会吞掉引导提示', () => {
    expect(shouldQuitAfterLaunchingInstaller('darwin')).toBe(false);
  });
});

describe('platform — 依赖探测候选与提示（darwin）', () => {
  it('darwin：mpv 候选含 .app / Homebrew / PATH；vlc、iina 含 .app', () => {
    const ctx = { home: '/Users/u', env: { PATH: '/custom/bin' } };
    const mpv = systemToolCandidates('mpv', ctx, 'darwin');
    expect(mpv).toContain('/Applications/mpv.app/Contents/MacOS/mpv');
    expect(mpv).toContain('/Users/u/Applications/mpv.app/Contents/MacOS/mpv');
    expect(mpv).toContain('/opt/homebrew/bin/mpv');
    expect(mpv).toContain('/usr/local/bin/mpv');
    expect(mpv).toContain('/custom/bin/mpv');

    const vlc = systemToolCandidates('vlc', ctx, 'darwin');
    expect(vlc).toContain('/Applications/VLC.app/Contents/MacOS/VLC');
    expect(systemToolCandidates('iina', ctx, 'darwin')).toContain(
      '/Applications/IINA.app/Contents/MacOS/IINA',
    );
  });

  it('darwin：java / python3 走平台正确可执行名（无 .exe）', () => {
    const cands = systemToolCandidates('java', { home: '/Users/u' }, 'darwin');
    expect(cands).toContain('/opt/homebrew/bin/java');
    expect(cands.some((p) => p.endsWith('.exe'))).toBe(false);
    const py = systemToolCandidates('python3', { home: '/Users/u' }, 'darwin');
    expect(py).toContain('/opt/homebrew/bin/python3');
    expect(py).toContain('/usr/bin/python3');
  });

  it('win32：本机候选为空（Program Files 系由调用方既有逻辑负责）', () => {
    expect(systemToolCandidates('mpv', { home: 'C:\\Users\\u' }, 'win32')).toEqual([]);
  });

  it('installHint：darwin 必含 brew install；win32 不含 brew', () => {
    const macMpv = installHint('mpv', 'darwin');
    expect(macMpv).toContain('brew install mpv');
    expect(installHint('ffmpeg', 'darwin')).toContain('brew install ffmpeg');
    expect(installHint('aria2c', 'darwin')).toContain('brew install aria2');
    expect(installHint('python3', 'darwin')).toContain('brew install');
    const winMpv = installHint('mpv', 'win32');
    expect(winMpv).not.toContain('brew');
    expect(winMpv.length).toBeGreaterThan(0);
    expect(installHint('vlc', 'darwin')).toContain('brew install --cask vlc');
    expect(installHint('iina', 'win32')).toContain('macOS');
  });
});

describe('platform — 发布资产命名（T04 用）', () => {
  it('dmgArtifactName：<product>-<version>[-<arch>].dmg', () => {
    expect(dmgArtifactName('Win-Box', '1.20.10', 'arm64')).toBe('Win-Box-1.20.10-arm64.dmg');
    expect(dmgArtifactName('Win-Box', '1.20.10', 'x64')).toBe('Win-Box-1.20.10-x64.dmg');
    expect(dmgArtifactName('Win-Box', '1.20.10', '')).toBe('Win-Box-1.20.10.dmg');
  });
});

describe('platform — 本机（真实平台）自洽性', () => {
  it('缺省参数与显式传当前平台结果一致（零回归前提）', () => {
    const p: PlatformName = platformName();
    expect(exeName('mpv')).toBe(exeName('mpv', p));
    expect(javaExeName()).toBe(javaExeName(p));
    expect(classpathSep()).toBe(classpathSep(p));
    expect(shouldRelocateUserData()).toBe(shouldRelocateUserData(p));
    expect(mpvEmbedSupported({})).toBe(mpvEmbedSupported({}, p));
  });
});
