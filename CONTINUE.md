# 续做清单

## 未完成 / 明确边界

- 三种网盘已用当前扫码凭据完成开发态应用窗口短时视频/音频解码；长时播放、拖动续播、UC/百度切集和安装版仍待验收。不要再次索要凭据或分享样本；已有分享和真实搜索/详情可复用。
- 8 个真实订阅中 7 个可导入（潇洒本地 CBC 解封装已补齐）；肥猫原始响应第 124 行缺少 `ext` 的开引号。小虎斑目标源仍返回空蜘蛛，小米 Wogg 已通过初始化/搜索/详情，壹影视暂无数据；不能宣称全部源稳定。
- 嗷呜 AppV7Fz 三次全新隔离目录冷启动：两次首页/搜索/详情成功，第三次动态原生库装载后在 240 秒窗口内未结束；Luck 三次通过，不能据此消除嗷呜冷启动问题。
- FishGuard 的非阻塞 TCP/socket/epoll 网络就绪及 pvideo 本地代理完整传输仍未验收；当前 unidbg `TcpSocket` 仍是阻塞式 Java Socket，不能仅清除 `SOCK_NONBLOCK` 冒充完成。已有真实 m3u8/FFmpeg 短时播放样本不代表全部网络能力完成。
- 当前版本源码已同步到 GitHub `origin/main`（发布流程修复提交 `816c2d3`）；GitHub Release `release1.21.01` 已公开发布。继续工作时必须保留这些既有改动。

## 已完成验证

- 真实 UC：当前 Cookie 认证成功；分享 `b37622addbf04` 递归发现 32 个文件，精确选中 `QYN-S01TBB-E24.4K(1).mkv`；合并下载接口刷新 Cookie 后 Range 返回 HTTP 206、`video/x-matroska`。独立 MPV 解码约 4 秒成功（仅空输出探针）；随后开发态应用 `player.open → IPC → SpiderHost.play → 本地中继 → HTML5` 真实解码 1920×1080、56 帧，音频计数 54560 bytes，时间推进到 2.15 秒。
- 百度应用窗口真实起播：1920×800、56 帧、音频 56862 bytes；夸克用当前真实搜索/详情两集完成首次/下一集/上一集，均为 1920×1080、56~57 帧，音频计数大于 0。旧夸克第二样本 fid 已不在分享列表，失败记录保留，不盲选替代文件。
- 本轮夸克转存清理已确认 pending=0；修正明确“文件已经删除”（HTTP 400/code 23004）的幂等响应，其它认证/权限/限流错误仍保留重试。清理只使用本隔离 profile 的既有待删 fid。
- 最终源码/JAR 重建后的 UC 应用窗口复测再次通过：1920×1080、53 帧、音频 50960 bytes、时间 2.03 秒（`.tmp/current-drive-ui-uc-final.log`）。资产 SHA/版本/清理计数记录在 `.tmp/current-final-manifest.json`；版本已更新为 1.21.01，正式安装包已生成。
- GitHub Release `release1.21.01` 已公开发布，仅包含 `Win-Box.Setup.1.21.1.exe`；本地与 GitHub 附件 SHA-256 均为 `c488ca24cbb5d34b55b6977fd829d4dfa223808f38f9a8938f40e7edf08c8102`，大小为 221,783,305 bytes。
- 8 个真实订阅导入源数：嗷呜 76、潇洒 106、摸鱼儿 97、饭太硬 48、wex 99、小虎斑 67、小米 43；肥猫因源响应实际语法错误未导入。日志：`.tmp/current-source-audit/*.log`。
- 源级 home/search/detail：摸鱼儿 Wogg/Luck、嗷呜 Wogg/Wobg、wex 花卷/玩偶、饭太硬玩偶/热播、潇洒热播影视/一起影视、小米 Wogg 均有真实结果；小虎斑目标源返回空蜘蛛、小米壹影视暂无数据。已修正探针 search 返回数组和 home.sortClasses 的字段计数。
- 重点测试：27 passed（历史记录）。
- 最新完整 Vitest：153 个测试文件通过，1824 个测试通过；1 个 BT E2E 按环境条件跳过。日志：`.tmp/full-test-current-final.log`。
- TypeScript 类型检查、主进程构建、Renderer 构建均通过。
- Renderer 构建仅有既存的大 chunk warning。
- JVM stubs/native bridge 已使用外部 JDK 重新构建；正式 JAR 审计通过，最终 stubs 268 classes，且不含 `DexNative` shim。Uri 的 `buildUpon()` 同时保留旧 Uri 描述符及 Android Builder 描述符；新旧二进制调用都经过正式 JAR 回归。

## 当前限制

- 系统 PATH 仍没有 `javac`/`jar`；本轮使用 `E:\WorkBuddy\2026-09-04-14-06-50\coil-quote\toolchain\jdk\zulu17.54.21-ca-jdk17.0.13-win_x64` 完成构建。JAR 和 `docs/` 是仓库忽略路径，发布时必须显式携带重建产物；未强制暂存。
- 应用解码计数不等于整集、用户实际听到声音或安装版验收；保留分层证据，不把单元测试和独立播放器探针冒充完整 E2E。

## 建议起点

```powershell
cd E:\WorkBuddy\tvbox2\tvbox-win
git status --short
& .\node_modules\.bin\vitest.CMD run
```
