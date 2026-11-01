---
status: historical
scope: 播放副本任务期间主机失联的取证、资源限制补丁及本地验证
last-verified: 2026-11-01
sources:
  - packages/pixishelf-worker/src/preflight.ts
  - packages/pixishelf-worker/src/worker-application.ts
  - packages/pixishelf-worker/src/config.ts
  - packages/pixishelf-job-executors/src/video-playback/media-process.ts
  - build/docker-compose.deploy.yml
---

# 播放副本任务期间主机失联

## 环境与结论

用户 fnOS 笔记本，硬件截图显示 i5-4210M（2 核 4 线程）、12 GB 内存。事故前发布为 `v0.55.13`，本地源码基线为 `ce6863a6`；本轮已核对生产 Worker 镜像 ID（见下文），尚未核验它与源码提交的映射及 App 配套镜像，不能用 `latest` 证明版本身份。

**根因未确认。** 用户报告整机无法 ping、随后疑似关机，再次开机后恢复访问。已确认任务执行中断和重启后部分 Worker 启动自检失败；这些结果不能单独证明 OOM、过热、供电或存储故障。

11-01 排查开始时用户确认 Worker 已停止。助手通过 DBX 对生产数据库及可访问的主机状态文件做只读检查；用户在管理员终端补充系统日志、执行受限二进制诊断，并最终设置资源限制、启动现有 Worker（见下文）。本轮没有人工提交转码、直接修改生产数据库或部署新镜像；Worker 恢复后会按原业务规则消费队列。

## 任务与时间线

时间均为北京时间。证据来自生产任务/事件查询及用户提供的 Worker 日志。

| 时间              | 证据                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| 10-31 23:09:29    | 手动提交任务 `cmvwjei8p0001s66s9pz1hq6w`，尝试上限 1                                          |
| 23:09:30          | Worker 领取 `BACKGROUND_WRITER` 任务                                                          |
| 23:09:31          | 开始探测源视频                                                                                |
| 23:09:33          | 进入编码阶段                                                                                  |
| 23:12:15          | 最后一条进度事件：37%                                                                         |
| 23:28:21          | 租约回收，任务转为 `FAILED`，错误为 `WORKER_LEASE_EXPIRED`                                    |
| 23:37:09–23:37:20 | 一次启动在 `ffprobe -version` 自检失败后退出，尚未激活任务调度器                              |
| 23:37:26–23:38:35 | 更晚一次 Worker 存在记录，最终为 `STOPPING`，`lastError` 为空；仅据此不能判定该次是否通过自检 |

11-01 任务仍为 `FAILED`、尝试 1/1。终态记录的 `heartbeatAt` 已在租约回收时更新为 23:28:21，不能将该值解释为原编码进程当时仍存活。

源视频仅查询已有数据库元数据，未重新读取或解码原片：大小 1,139,850,665 字节，时长 440.433333 秒，H.264，30 fps，有音频；宽高均为 0，分辨率未知。对应 `MediaVideoPlayback` 发布记录不存在；这不等于没有残留临时文件，也不构成原片完整性验证。

## 当前主机快照

11-01 约 11:03–11:07 的 DBX SFTP 只读采样：

- uptime 约 42,236 秒，本次启动已持续约 11 小时 44 分钟。
- loadavg 为 `0.43 0.52 0.55`。
- `MemAvailable` 为 6,033,096 KiB（约 5.75 GiB）；4 GiB swap 几乎未使用。
- 内存 PSI 的 avg10/60/300 均为 0；I/O PSI 的 some avg10 为 0.18%。
- `x86_pkg_temp` 当前采样为 58°C。

这些当前快照不能反推事故之前的温度、内存或 I/O 状态，不构成整机稳定性验收。

## 用户补充的系统记录

- `journalctl --list-boots` 只显示当前 boot，首条为 10-31 23:21:42；查询事故时间窗返回 `No entries`。这只能说明可访问 journal 未保留该时间窗，不能排除事故期间出现过异常。
- 实际 Worker 容器名为 `pixivshelf-worker-1`，用户提供的 `docker ps -a` 显示 `Exited (0)`，镜像标签为 `dockernamehu/pixishelf-worker:latest`。最近一次正常退出不能证明最初事故也正常退出。
- `/var/log/kern.log` 仍保留开机前的记录，`kern.log.1` 不存在；`syslog` 也存在。因此后续改查事故时间窗的文本日志。
- 关键词查询主要命中 `[trim-mounts-hash]` 打印的 `thermal_throttle` 目录名和开机初始化信息，未从所贴片段得到事故期 OOM 或热关机证据。
- 23:21:46 的 `Invalid critical threshold (-274000)` 是开机时 ACPI 阈值有效性检查的提示，不能当作测得的温度或热关机事件。含 `drm panic` 的输出为功能注册信息，也不代表已经发生 kernel panic。
- 用户提供实际容器 inspect：`memory=0 memorySwap=0 nanoCPUs=0 cpuQuota=0 cpuPeriod=0`，确认未设置内存上限或 CPU 配额；当前 `oomKilled=false exitCode=0 restartCount=1` 只描述最近状态，不能排除最初事故中的 OOM。
- 实际镜像 ID 为 `sha256:4be8c0f0484d6cad55ccbf62660a39053d995d6a52b57dc8205b2c56d419bc33`；这是本地镜像身份，不等同于仓库 manifest digest。
- `kern.log` 在 23:05–23:20 没有匹配输出。同期 `syslog` 在普通 grep 下提示 `binary file matches`，因此当次输出不完整，待以文本模式复查。
- 已显示的 syslog 中，23:09:30 有飞牛 NFS 客户端连接远端共享失败、重连及使用已列入黑名单目标的记录；与任务领取相近，仅是待关联线索，尚不能确认该挂载与原片的关系或因果。主机挂载表确认存在飞牛的 FUSE NFS 挂载。
- 随后实际容器挂载与主机挂载表交叉核对：原媒体、派生媒体、Pixiv data 三个 bind 源均位于同一个 `fuse.mount.trim_nfs` 挂载。已确认视频读写经过飞牛 NFS/FUSE 链路；该具体挂载对应的远端 export 与上述重连目标仍需进一步关联。
- 文本模式重读 syslog 并过滤重复模板信息后，所贴事故窗口最后一条为 23:11:52 的 NetworkManager 无线接口扫描状态切换，仍无直接关机记录；不能把该扫描输出认定为主用网络掉线。
- `last -x` 将事故前未登出的会话标为 `crash`；本次开机的 `fsck.fat` 报告 `/dev/sdb1` dirty bit，并自动清除。主机挂载表确认该设备为 `/boot/efi` 的 vfat 分区，不是视频所在的 NFS 共享。日志另有 FAT 主备启动扇区字节差异，fsck 当时未自动修改该差异；本轮没有执行修复。
- Docker Root Dir 为 `/vol1/docker`、驱动 `overlay2`；`/vol1` 位于本机 mapper 设备的 btrfs 文件系统。Docker 镜像所在存储与媒体所在 FUSE/NFS 挂载不同。
- 用户确认机器为长期合盖且配置为不休眠的笔记本，事故前未观察到明显供电、温度或风扇异常。没有获得事故前休眠或电源按键事件证据。

用户执行同一镜像的受限二进制诊断：临时容器无网络、无生产挂载，rootfs 只读，CPU 配额 1、内存 512 MiB、禁用 swap，覆盖入口运行 Node `execFile`，顺序读取 FFprobe/FFmpeg 版本，每次超时 10 秒并输出原始 code/signal/killed 与耗时。原 Worker 未启动。结果为 Node `v20.20.2`、架构 `x64`；FFprobe `8.0.1` 用时 2,502 ms，FFmpeg `8.0.1` 用时 57 ms，均 code=0、signal=null、killed=false。仅证明该镜像的两个二进制当前能运行；不证明真实媒体读写/转码安全，不能确认昨晚自检失败的具体原因。

当前主机默认路由及局域网路由均使用 `enp8s0`，无线路由未出现。这是当前状态，不能作为事故时刻的网络状态证明。

生产再次查询 `VIDEO_PLAYBACK_GENERATION` 的 `PENDING`、`RUNNING`、`RETRY_WAIT` 状态，返回 0 行；这只确认查询时没有这些活动转码任务，不限制未来用户提交。

用户在 Worker 停止状态执行 `docker update --cpus=1 --memory=2g --memory-swap=2g pixivshelf-worker-1`，随后 inspect 确认为 `status=exited nanoCPUs=1000000000 memory=2147483648 memorySwap=2147483648`。限制已保存，原 Worker 此时尚未启动。恢复前再次查询未过 deadline 的 `PENDING`、`RETRY_WAIT`、`RUNNING` 任务，返回 0 行；这是当时队列快照，不限制后续新增任务。

11-01 13:08 用户恢复现有 Worker，贴回启动日志及 Docker stats：13:08:37 开始自检，13:08:41 三个执行通道启动，出现 `worker.preflight_completed` 与 `worker.dispatch_ready`，整个启动自检约 4.2 秒。stats 单次采样为 CPU 4.50%、内存 64.11 MiB / 2 GiB、15 PIDs。随后 DBX 只读查询确认该次 Worker 为 `READY`、心跳已更新到 13:09:38、`lastError=null`。这证明启动和心跳恢复，不是持续负载、定时任务完成或转码稳定性验收。

文档本轮验证：`pnpm docs:check` 通过；默认图示检查因本机缺少 bundled Chromium 未运行，改用已安装 Chrome 的 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过（34 个图源、23 个内嵌 Mermaid）。未更改图源。

## 实现缺口及待核验项

- 发布基线仅在输出侧设置 FFmpeg `-threads 2`，未显式限制输入解码和滤镜线程。串行任务通道不等同于单任务 CPU/内存限制。
- 事故时仓库生产 Compose 与实际 Worker 均未配置 CPU/内存硬上限；本轮用户已给现有容器保存限制，补丁已更新仓库 Compose，生产实际 Compose 尚未同步。
- 自检默认超时 10 秒，失败包装只保留错误文本，没有记录原始退出码、信号和 `killed`。11.6 秒的启动耗时与超时可能性相符，但不足以确认。
- 本地补丁限制探测/解码/滤镜/编码线程，并保留启动自检的子进程诊断；现有生产容器尚未部署该代码。保守资源预算与本地验证不能替代生产真实任务验收，不能宣称事故根因已修复。

现有证据支持上次运行没有正常收尾，但不足以区分先卡死后按电源、供电中断、热保护、OOM 或存储/内核故障。`crash` 和 EFI dirty bit 是结果证据，不是根因定位；未找到相关错误不代表排除了上述可能。

当前已保存 CPU 配额 1、内存 2 GiB、memory+swap 合计 2 GiB，Worker 启动自检与队列消费能力已恢复。此预算是该主机的保守初始方案，可能让其他任务变慢或因超预算失败，不是性能验收；容器限制也不覆盖宿主机外部 FUSE 服务。仍需同步到实际 Compose，以免重建丢失。

真实大视频转码、原片完整性、临时副本回收和 NFS 读写压力均未验证；线程限制尚未上线，不能据版本检查成功恢复大视频试跑。

原始生产查询、SFTP 返回及用户日志保留在本次诊断对话；未另行导出完整系统日志，未创建或宣称存在生产备份。恢复和更新遵循[备份恢复基线](../../operations/backup-and-recovery.md)。

## 资源限制补丁与本地验证

补丁基于 `ce6863a6`（`v0.55.13`），目标版本为 `v0.55.14`：播放副本的探测、解码、滤镜及编码线程分别设为 1；开发和生产 Compose 默认给整个 Worker 分配 1 CPU、2 GiB 内存且禁用 swap；启动自检错误保留耗时、超时值、退出码、信号及 `killed`。没有数据库迁移、码率档位、任务类型或播放器行为变更。

验证于 2026-11-01 在本地 macOS 工作区执行。PostgreSQL 使用 Docker Desktop 中专门创建的 PostgreSQL 15 临时容器，绑定动态 localhost 端口，测试库为 `pixishelf_resource_patch` 与 `pixishelf_resource_playback`；没有使用生产数据库或媒体。两个空库均应用现有 136 条正式 migration。本补丁没有新增 migration，因此没有单独重复历史数据升级实验。

| 检查                            | 结果与范围                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker 依赖链 typecheck         | 五个包通过；最终诊断代码调整后再次通过 Worker typecheck                                                                                                                                 |
| Worker 依赖链 build             | 全部通过；仍有未修改的去重模块 `import.meta` / CJS 打包警告，未在本补丁扩展处理                                                                                                         |
| Worker 依赖链 PostgreSQL 测试   | 使用 `CI=true`、临时 `DATABASE_URL` 且不设置 `QUEUE_KERNEL_TEST_DATABASE_URL`，执行 `pnpm --filter @pixishelf/worker... run test --no-file-parallelism`；1,901 通过、591 按环境条件跳过 |
| 播放副本真实转码                | 聚焦测试 14 通过；横屏、有声、竖屏无声、小尺寸 60 fps、HDR 拒绝及原片哈希保持通过；数据库链中的发布测试另有 9 项通过，包含真实 FFmpeg 执行器流程                                        |
| 自检诊断                        | 5 项通过，覆盖非零退出、信号终止、可执行文件缺失，以及日志和 Worker 状态截断后仍保留诊断                                                                                                |
| 主应用 lint / typecheck / build | 全部通过；build 使用提升权限执行，数据库指向临时测试库                                                                                                                                  |
| 主应用 test                     | 首次全量 3,647 通过、372 跳过，5 项因沙箱不允许本地监听／tsx IPC 失败；提升权限重跑这两个文件，35 项全部通过                                                                            |
| Compose 解析                    | 开发、生产模板的默认 1 CPU / 2 GiB 及覆盖为 0.5 CPU / 1 GiB 均通过；memory 和 memory+swap 相同                                                                                          |

首次将所有旧 PostgreSQL fixture 一起启用时，遇到并行文件共享数据库造成的锁冲突，另有专用去重 fixture 拒绝动态端口／库名。没有改写其安全白名单或放宽断言；随后按 CI 的数据库环境选择并串行运行文件，得到上表结果。跳过的专用 fixture 不计为已验证。

原始本地输出位于执行机器的 `/tmp/pixishelf-resource-*.log`，包括 `worker-chain-postgres`、`worker-chain-unit`、`ffmpeg-focus`、`preflight-final`、`typecheck`、`app-lint`、`app-typecheck`、`app-test`、`app-retry`、`app-build` 和 `worker-build`；这些临时日志未作为长期附件归档，摘要记录在此。

本地验证不包含新的生产镜像构建、部署或重建；生产 NFS/FUSE 链路、持续温度／负载、大视频重试和其他定时任务在预算内的表现仍待验收。实际 NAS Compose 必须保存资源配置后再重建容器，不能依赖本轮的 `docker update` 跨容器继承。
