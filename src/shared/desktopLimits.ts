// src/shared/desktopLimits.ts
// ★ 2026-10-13：桌面端「已知能力缺口」的统一文案。
//
// 背景（加固壳 wex 的「Go 多线程服务」）：它由 Android 原生库 `libwexproxy.so` 提供
//   （载荷里的启动命令形如 `su -c chmod … -port 8096 -dns :53 -sign …`）。桌面端两条路都走不通：
//     · native 路：`libwexproxy*.so` 被 **主动跳过装载**（见 resources/jvm/native-bridge/
//       com/winbox/nativebridge/NativeBridge.java 的 payloadLoad 注释 —— 装进 unidbg 会让
//       native 启动挂死，且模拟器全局串行，整只源的单次调用会被拖到 300s 判死）；
//     · 二进制路：`new_go_proxy_wex` 需要 chmod/killall/nohup 加执行权限跑一个 ELF，而源方
//       发布的 `v7/v8/x86/x86_64` **全是 Android ABI，没有 Windows/macOS 产物**。
//   实测影响面只限「Go 代理专属能力」：弹幕聚合（`goDanmu`）与 115 网盘直链签名；
//   网盘直链本身走应用自带的本地代理（`127.0.0.1:9978/proxy`），源照常可用。
//
// 结论：这一条**不修、只说明**。文案放这里由引擎日志与渲染层共用 —— 两边各写一份必然漂移。
// 纯 TS、零依赖：renderer / 引擎均可 import。

/** 渲染层（配置项页面）就地说明。写成「若…有…开关」的句式，对任何加固壳源都成立。 */
export const GO_PROXY_LIMITATION_UI =
  '若配置项里有「Go 多线程服务」开关：桌面端不支持 —— 它需要 Android 原生库 libwexproxy.so 与 root 权限，打开了也不会生效。受影响的是弹幕聚合与 115 网盘直链签名，其余功能不受影响。';

/** 引擎日志：原生载荷被桌面跳过时补发的一条结论性说明（原生日志只有「载荷库跳过」，看不出与开关的关系）。 */
export const GO_PROXY_LIMITATION_LOG =
  '已知限制：桌面端不支持「Go 多线程服务」（其载体 libwexproxy.so 是 Android 原生库，已按桌面策略跳过装载）。受影响的是弹幕聚合与 115 网盘直链签名；网盘直链走应用自带的本地代理，源仍可用。';

/**
 * 「这条原生桥日志是 Go 代理载荷被跳过」的判据。
 * 对应 native-bridge 里那条 `[native-bridge] 载荷库跳过（桌面不适用：Android root/Go 代理）: <path>`
 * —— 用宽容正则（而不是 `includes` 整句），避免上游改一个汉字就失效。
 */
export function isGoProxySkipLine(line: string): boolean {
  return /载荷库跳过[\s\S]*?(wexproxy|go[_-]?proxy|Go 代理)/i.test(line || '');
}
