---
status: current
scope: 信任域、请求鉴权链、网络存储、敏感数据与权限变更门禁
last-verified: 2026-10-22
sources:
  - packages/pixishelf/proxy.ts
  - packages/pixishelf/lib/auth/better-auth.ts
  - packages/pixishelf/lib/safe-action.ts
  - packages/pixishelf/server/trpc.ts
  - packages/pixishelf/app/api
  - build/docker-compose.deploy.yml
---

# 权限与接口边界

PixiShelf 当前是**单一管理员信任域**。可以创建多个账户，但所有有效会话拥有相同的实例管理能力：`adminProcedure` 直接复用 `authProcedure`，不是额外角色门禁。账户级阅读/偏好隔离不等于多租户权限隔离，不能把账户发给不可信用户。

## 信任边界

![部署与信任边界](../diagrams/operations/deployment-trust-boundaries.svg)

[图源](../diagrams/operations/deployment-trust-boundaries.mmd)。图描述当前 Compose；反向代理是必须正确配置的外部边界，**ImgProxy 当前未签名，也不校验 App Session**。

| 调用者          | 凭证                              | 允许范围与限制                                                      |
| --------------- | --------------------------------- | ------------------------------------------------------------------- |
| 未登录浏览器    | 无                                | 首页跳转、登录、首次初始化；无私有媒体/目录/管理访问                |
| 会话账户        | Better Auth 数据库 Session Cookie | 所有受保护页面和管理能力；账户专属数据仍从 Session 取归属           |
| 扫描调用方      | 独立 `SCAN_WEBHOOK_TOKEN`         | Webhook 健康/认证、目录发现/明确路径扫描及受限 `SYSTEM + SCAN` 状态 |
| scheduler       | 独立 `INTERNAL_JOB_TOKEN`         | tick 健康与到期计划物化；不直接访问数据库                           |
| Worker          | 数据库凭据及媒体挂载              | 队列/领域执行，不应接受公网业务请求                                 |
| ImgProxy 调用方 | 无应用 Session 或 URL 签名        | 端口可达即可能读取允许的本地媒体，须网络或认证代理保护              |
| 主机管理员      | NAS/Docker/PostgreSQL 权限        | 超出应用模型；单独保护配置、备份和存储                              |

两枚服务 Token 与 Better Auth Secret、数据库/外站凭据互不复用。服务 Token 未配置返回 503，错误值返回 401，不得退化为匿名调用。

## 请求保护链

1. 受控 HTTPS 反向代理删除外部 `x-user-session` / `x-pathname`，重写可信 `x-forwarded-for`。
2. Next.js `proxy.ts` 校验 Session。公共路径为 `/`、`/login`、`/api/webhooks/scan`、`/api/internal/scheduler/tick`；按完整路径或 `/` 分隔子路径匹配，不放行相似前缀。`_next/static`、`_next/image`、`favicon.ico` 在 matcher 外。
3. 未认证页面跳转登录并保留目标查询，API 返回 401。有效会话覆盖注入内部上下文头；这些头不是业务授权凭证。
4. tRPC context、敏感 HTTP Route 和 `authActionClient` 重新取得服务端 Session。页面位于 `/admin` 不代替授权。`actionClient` 不自带会话校验。
5. 服务层继续核对账户、资源归属、状态/版本、路径和事务证据；操作者始终取 Session，客户端不能提交权威身份或冻结证据。

| 边界                                    | 当前校验及能力                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 普通页面与 `/admin/*`                   | Session；无额外角色判断                                                                            |
| tRPC `publicProcedure`                  | 本身只做进程内 IP 限流；标准 HTTP transport 仍受代理 Session 保护（包括 `series.list/get`）        |
| tRPC `authProcedure` / `adminProcedure` | 限流 + Session/User；两者目前等权，新增 transport 不能假设代理仍存在                               |
| 登录/初始化 Action                      | 公共入口；登录限流；初始化在表锁后的事务内复核无账户，原子创建账户/凭据/Session，提交后设置 Cookie |
| 上传、替换、章节删除、扫描、迁移 Route  | 代理 + Route 独立 `requireAdminRequest`，再校验资源与文件边界                                      |
| 媒体/manifest 读取                      | 原媒体、Pixiv 图片、章节/关键帧等标准 Route 依赖代理 Session，并使用相应根路径/类型检查            |
| `/api/jobs/events`                      | 独立 Session 门禁；只传脱敏任务摘要/事件，不传 payload、原始错误、URL、路径或租约 token            |
| Webhook 与 scheduler                    | 公共 transport + 各自 Token；GET/HEAD 不执行扫描，POST 才入队/物化                                 |
| 原站跳转                                | 独立 Session + 服务端查询 + provider/HTTPS/主机/端口/凭据/路径/归属校验；忽略 query 目的地         |

媒体 HTTP 路由禁止读取隐藏目录中的恢复证据（包括 `.pixishelf-upload-recovery`）：URL 解码和路径归一化后的每个路径段均检查隐藏前缀，解析后的实际根内路径再次检查，防止编码分隔符或可见符号链接别名绕过。恢复操作的账户和原 operationId 校验仍由服务层执行。

精确接口参数由 Zod 和路由代码维护。扫描/迁移错误 envelope 及 Webhook 例外见[HTTP 响应契约](./http-response-contract.md)，外部调用见[扫描 Webhook](../../packages/pixishelf/docs/webhook-features.md)。

2026-10-31 局部核验：MP4 优化的候选查询、预览和提交均使用 `adminProcedure`，操作者来自 Session。客户端只提交固定的视频／作品 ID、预览时最近任务 ID 与状态，服务端逐项复核当前归属、活动作品、MP4 类型及任务状态；已有活动任务复用，失效或状态变化目标跳过。作品范围只收窄已有管理权限，不构成新的授权方式。未新增公共路由、令牌或媒体挂载，具体批量与中断边界见[MP4 无损播放优化](../features/mp4-streaming-optimization.md)。

作品评分和喜欢筛选使用 Session 账户，`expectedUserId` 只作账户切换一致性校验。评分读取／赋值及喜欢条件的列表、卡片与沉浸 feed 缺失或错账户参数时拒绝；客户端不能指定任意账户评分或喜欢集合。详情滑杆与沉浸爱心共用鉴权评分赋值入口，不存在可绕过评分阈值的布尔点赞写入。服务在作品锁和事务内复核活动、未删除状态；前端缓存及迟到响应按账户隔离。见[作品评分与喜欢](../features/artwork-rating.md)与[作品搜索与我的喜欢](../features/artwork-search-and-favorites.md)。

单图 `mediaMark.getMany/likedMediaIds/set/list/remove` 使用同样的 Session 与 `expectedUserId` 保护，但操作独立媒体标记，不写作品评分。`likedMediaIds` 只读取当前会话账户在指定活动作品下的喜欢记录，返回当前逻辑媒体 ID，不返回其他账户状态或媒体详情。设置必须核对媒体属于当前活动作品、逻辑媒体身份及写入状态；失效条目只能按会话账户移除指定状态。原媒体写入开始、成功失效与标记设置按相同作品锁排序，避免把标记写到正在替换的内容。见[单图书签与喜欢](../features/media-marks.md)。

同艺术家重复检测的 `artworkDedup` 接口要求 Session 与 `expectedUserId` 一致；检测结果属于共享管理事实，`requestedBy` 仅为审计身份。运行控制核对业务版本与幂等键，通用后台任务入口不能绕过检测领域限制或提升优先级。返回信息不含其他账户私人整理内容、绝对媒体路径、根身份、原始哈希和执行租约；开发分支行为见[重复检测](../features/artwork-deduplication.md)。

去重的删除范围解析与预览使用 `adminProcedure`，普通批量预览、提交、进度、停止和重试也使用相同管理员入口，并核对 `expectedUserId` 与任务请求账户。待删目标、保留方、普通文件范围与稳定 operationId 由服务端保存；提交不能增加作品或范围外文件。任务中心通用创建、继续、重试、暂停、取消及优先级控制不能绕过批量确认。旧专用 PREPARE/DELETE 及来源解除入口停用，历史只读；既有来源标记不清除，新流程不创建去重来源 hold/tombstone。具体范围见[作品去重](../features/artwork-deduplication.md)。

共享任务 DTO 对批量删除只返回轮次、作品数量与确认/停止状态等最小摘要，不返回确认清单、文件选择、完整报告或发起账户的整理/阅读信息；任务事件也不透传私有数据。完整详情仅由核对任务所属账户后的批量详情接口提供。

去重成员封面 `GET /api/artwork-dedup/cover/:artworkId` 独立核验 Session 与 expectedUserId，并按当前活动、未删除及非维护 COPY 声明的作品可见性读取第一登记图片或已有视频封面。DTO仅返回作品ID路由，不暴露原路径；隐藏目录和解析后隐藏路径均拒绝，响应为 private/no-store、Vary Cookie，不重定向原媒体、不现场重编码。

2026-10-31 局部核验：视频播放副本管理使用 `adminProcedure`；`/api/v1/media/[image-id]/playback` 及其 `source` 路由独立检查 Session，复核当前活动作品、非维护 COPY、源写入门禁与真实根内文件。副本 generation 固定对应一个文件，失效拒绝而非 Range 期间换源；响应 private/no-store、Vary Cookie，不返回绝对路径，不经 ImgProxy。详见[视频播放副本](../features/video-playback.md)。

## 移动客户端接口

2026-10-28 局部核验：`/api/mobile/v1` 是 Android 验证版新增的独立 transport。只有精确 `POST /api/mobile/v1/session` 公开登录；GET、DELETE 及其他子路由均由 proxy 和 Route 双重验证。相似前缀不豁免网页鉴权。

移动认证实例启用 Better Auth `bearer({ requireSignature: true })`，共用已有 Session 存储与 Secret；默认网页实例不启用 Bearer。请求只传 Authorization、User-Agent 和可信代理重写的 X-Forwarded-For，忽略客户端 Cookie 与身份头，禁止 Cookie cache。签名 Token 只出现在登录 JSON 和后续 Authorization，不能放 URL；同源 ID 媒体接口不重定向，避免 Token 转发到 ImgProxy 或第三方。此实例分离是 transport 边界，不是新的租户或权限模型。

读取与写入按 Session 确定账户；`expectedUserId` 只是并发前置条件。路由复核账户、媒体版本、活动状态及现有领域规则。只读原件仍检查登记路径、隐藏目录、真实根内路径、符号链接与文件类型；视频 Range 读取也不跳过鉴权。预览只在内存压缩，不写原件或派生存储。图库封面与选图复用同一媒体 ID 路由的 `thumbnail` 变体，最长边 512px；仍校验账户、媒体版本、作品可见性和路径，不新增公开封面入口。响应采用 private/no-store、Vary Authorization、no-referrer；业务错误仅返回受控 code，不返回路径、上游错误或凭据。proxy 层拒绝也可能使用现有通用错误格式，客户端按 HTTP 状态处理。

Flutter 默认仅接受可信 HTTPS 根地址，API 请求拒绝重定向；原生播放器只接收本实例媒体 ID 路由，服务器不发重定向。Token 存在 Android 安全存储，关闭系统备份；内存媒体缓存随账户销毁。位置信息存本地偏好，不保存密码或离线媒体。没有新增 Cookie/CORS 放行、公开文件目录、服务端监听端口或 Compose 挂载。反向代理需保留 Authorization 与 Range；已有实例应按部署流程先运行含移动接口的服务版本，再连接 APK。

本地 USB 联调的唯一 HTTP 例外是 Debug／Profile 构建且显式编译 `PIXISHELF_USB_DEV=true`，仅允许 `http://127.0.0.1:5430`，通过 ADB reverse 连接宿主机 F5 服务。Profile 用于优化编译后的真机性能核验；未启用开关的 Debug／Profile 和所有 Release 均不启用此例外，Release 即使传入开关也拒绝 HTTP。地址校验也覆盖安全存储恢复的会话。拒绝局域网 HTTP、其他端口、路径、URL 凭据及 query/hash，仍需正常账户登录。Android 明文例外资源只位于 `src/debug` 与 `src/profile`，仅针对 `127.0.0.1`，不扩大系统证书信任、不关闭 TLS 校验；这不是远程或局域网部署方案。机制参考 [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config)，操作见 [Flutter 包说明](../../packages/pixishelf-app/README.md#usb-本地联调)。

登录限流复用已有每 IP 5 次窗口，移动已登录请求额外按账户限流；这些仍是单进程内存限制。失效会话需重新登录；退出尝试撤销 Session，离线退出无法证明远端已撤销。契约与产品范围见[移动规格](../features/android-app.md)。

移动详情和作者邻作只映射展示字段，不返回原文件路径、来源快照或管理 DTO。外部来源由现有来源服务或有效数字 Pixiv 身份校验后返回 HTTPS URL，App 仅在用户点击时交给外部浏览器，不附带 Bearer。单图标记和手动已读复用现有账户／资源／维护状态门禁；手动已读只接受 ALL 或单媒体目标及当前 mediaRevision，不提供重置访问事实的接口。堆叠组由服务端共享算法生成，阅读上报仍由领域服务核验组指纹。视频导航只返回已登记章节和仍匹配原视频的已发布关键帧时间点；读取章节时复核当前媒体版本、活动状态、维护 COPY 声明、登记根内路径及真实目标，限制清单大小。不暴露派生文件路径，也不在浏览时触发生成任务。

## 服务网络和存储矩阵

| 组件       | 网络                            | 数据库        | 原媒体             | 派生媒体 | Pixiv data |
| ---------- | ------------------------------- | ------------- | ------------------ | -------- | ---------- |
| App        | 默认宿主机 5430                 | 读写/启动迁移 | 默认 ro，可显式 rw | rw       | ro         |
| Worker     | 3011 仅容器网络；健康端点无认证 | 读写          | rw                 | rw       | rw         |
| scheduler  | 只调用 App                      | 无            | 无                 | 无       | 无         |
| PostgreSQL | 默认宿主机 5432，Compose 无 TLS | 本体          | 无                 | 无       | 无         |
| ImgProxy   | 默认宿主机 5431                 | 无            | ro                 | ro       | 无         |

ImgProxy 仅允许 `local:///media/` 和 `local:///derived-media/`，Compose 没有签名 Key/Salt；难猜路径不构成授权。它与 PostgreSQL 的宿主机端口必须限制在受信网络或等效保护路径。不要把私有原媒体放进 matcher 排除的静态目录。

三个 Worker lane 共用同一数据库凭据与读写挂载，属于调度/capability 边界，不是操作系统权限隔离。解析 Executor 不写媒体，下载仅写隔离的 generation staging；发布/回收/恢复/清理在 writer lane 进行；所有文件操作仍须校验根目录、符号链接与文件类型。App 默认 ro 与部分上传/替换写入口存在部署配置差异，需显式允许写挂载才能执行，不能误称默认只读覆盖所有部署。

出站代理优先级为 `ARCHIVE_HTTPS_PROXY > HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy`。专用值显式为空强制直连；仅未设置时遵循 `NO_PROXY/no_proxy`。只接受无凭据、路径、query/hash 的 HTTP(S) 代理，失败不自动直连。

该代理覆盖归档/来源扫描及 Worker 的 Pixiv 资料、图片、metadata、标签封面和缺少有效快照时的系列请求，不影响浏览器远程图片/脚本、本地任务或内部服务。Pixiv 用逐请求 dispatcher，由代理解析 CONNECT 目标 DNS；每跳仍校验 HTTPS、443、无凭据及精确域名（API `www.pixiv.net`、图片 `i.pximg.net`）。不能称为本地 DNS 钉扎；归档自身的 DNS/SSRF/fake-IP 防护继续保留。

## 敏感数据与领域差异

默认对任务 payload、结果、事件、错误和日志脱敏，不记录 Cookie、Authorization、完整 locator/token 或 URL 敏感路径。tRPC 只隐藏 INTERNAL_SERVER_ERROR 的消息/stack，已知业务错误按入口契约公开；不能据此声称全站错误都已脱敏。

| 能力                             | 额外边界与权威说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阅读、reader/mediaPage、快捷筛选 | `expectedUserId` 仅验证账户未切换，真实归属来自 Session；媒体版本、作品/组指纹及资源归属由服务端核验。手动已读不接受次数/时间；预设保留键（含艺术家子空间）不能走通用设置绕过；预设按账户＋作用域隔离，艺术家预设不可加入全局导航。评分筛选 `ratingLevels`、阅读筛选 `readingStatuses`（含旧 `readingStatus`）只读取当前 Session 账户；非空阅读集合即使三项全选，也必须提供匹配的 `expectedUserId`。旧单值兼容不改变归属。`excludeArtistIds` 和 `scopeArtistId` 是查询／浏览上下文，不授予额外访问权限。见[阅读](../features/artwork-reading.md)、[快捷筛选](../features/artwork-quick-filters.md) |
| 堆叠阅读                         | 真实观察 + 服务端分组指纹/归属；客户端不能把预加载当 VIEW，过期或跨作品证据拒绝整批。见[堆叠浏览](../features/artwork-summary.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 删除、归档恢复、创作者整理/合并  | 管理语义门禁 + 服务端计划/状态/路径/资源校验；客户端不得扩大选择或伪造操作者。见[作品删除](../features/artwork-deletion.md)、[回收站](../features/archive-trash.md)、[创作者](../features/creator-relations.md)、[合并](../features/artist-merge.md)                                                                                                                                                                                                                                                                                                                                               |
| 发现来源与标题规则               | 读取认证、变更管理门禁；冻结条件和上传者范围，名称/UID 失败不能扩大查询；不接受任意站点表达式、证据 URL 或内部游标。见[标题规则](../features/archive-title-rules.md)、[收件箱](../features/archive-intake.md)                                                                                                                                                                                                                                                                                                                                                                                      |
| 批量扫描/失败收件删除            | 服务端重查父子/来源归属与活动状态；幂等键绑定操作者和规范化输入，通用 enqueue/retry 不能绕过领域入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 诊断报告                         | adminProcedure + 报告属于请求任务；写入/读取都脱敏，到期隐藏证据，即使物理清理未完成；SSE 只传摘要。见[诊断](../features/background-job-diagnostics.md)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Pixiv metadata/同步报告          | 不通过静态或 `/api/pixiv-data` 下载；管理请求只给 ID/前后标识，由服务端构造路径并校验任务、身份、类型、大小和符号链接                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 根身份维护                       | Worker 内受控命令、数据库确认/指纹/writer 锁；UUID 不替代路径校验。见[根身份](../features/pixiv-root-identity.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

完整 URL 的受保护例外必须保持局部：

- 收件详情可向已认证会话返回 `submittedUrl/canonicalUrl`，供核对提交；不放开日志、事件或错误中的 locator。
- `archive.listTaskItems` 可在管理员主动排错时返回完整图片页/最近下载 URL（可能含签名 query），不保存 Cookie/Authorization；仅安全 HTTP(S) 导航，禁止 Referrer，不自动请求。不得扩散到列表/SSE/诊断。
- 任务、目录和作品来源跳转从服务器读取 canonical URL，作品引用还须属于 ACTIVE、未删除作品；响应 `private, no-store`、`no-referrer`，不接受客户端目的 URL、不访问远端、不泄漏错误中的 locator。旧站内原站预览已退役；见[来源导航](../features/source-preview.md)。
- 发现列表缩略图仅返回校验后 HTTPS、允许主机/子域、无凭据/非标准端口的 URL，去 query/hash；浏览器按需懒加载且 no-referrer。完整目录 canonical token 不返回列表。

2026-10-29 局部核验：部分归档的 `archive.getCoverage` 使用会话读取，`archive.completeArtwork` 使用管理 mutation。客户端只提交作品 ID、期望修订 ID 和幂等键，来源地址、文件路径、哈希及补全基线由服务器冻结并复核；页脚原站入口复用已有受保护作品来源跳转。没有新增公开路由或远端阅读器，详见[部分归档规格](../features/archive-partial-coverage.md)。

归档媒体诊断只允许校验过的 MIME、长度、前 32 字节十六进制头、SHA-1 和完整性标记，不收集任意响应正文。E-Hentai 换节点只解析固定 loadfail 中有界 nl，不执行网页脚本或接受任意目标 URL。

## 隐私与浏览器媒体

去重对照复用 `/api/artwork-dedup/cover/[artwork-id]`，可选 `imageId` 必须为正整数并真实属于该作品；不带此参数仍按封面行为。Session、`expectedUserId`、作品可见性与媒体根/路径校验不变，响应继续 `private, no-store`、`no-referrer`。对照接口只提供受保护同源媒体引用与序号；相似关系不是访问或删除授权。疑似版本与部分重复的单对删除还必须绑定人工保留选择、内容损失声明及双方冻结快照，分别使用协议 3、协议 4；不能复用旧确认、混批或进入批量推荐。

2026-10-24 局部核验：艺术家管理与关键词来源表单提供浏览器直达的 E-Hentai 标题搜索外链。目的地址固定为 `https://e-hentai.org/`，仅将共享查询契约构造的标题／上传者表达式编码到 `f_search`，不接受任意主机或目的 URL，不附加站内凭据或画廊 token。链接在新标签页打开，使用 `noopener noreferrer` 和 `no-referrer`；服务端不代理该搜索，也不放开任何公共路由。此搜索导航与上文数据库保存的画廊 locator 跳转是不同入口。

新增 `archiveSearch.appendDefaultCreators` 继续使用管理 procedure 和服务端事务校验；只能向仍存在且规则版本一致的标题来源追加有效艺术家／社团，不接受客户端提供的完整旧绑定集合或操作者身份。既有绑定与停用状态保留，详情见[来源发现](../features/archive-discovery.md#从艺术家管理查找和关联来源)。

`entry=direct` / `entry=privacy` 只选择同源浏览器视觉模式，不是登录、成年或账户授权。偏好可同步其他标签，不改变数据加载、导出/复制或阅读记账；服务端首屏遮蔽和 blocker 用于避免闪现。旧账户 `media_privacy_mode` 不再有效。见[浏览器隐私](../features/browser-privacy.md)。

WebP Worker/WASM 与输入使用版本化同源地址和 `credentials: same-origin`，代码资源仍受 Session 代理；CSP `worker-src 'self'`，没有跨源解码器或新公开路由。资源 manifest 缓存只存校验后的资源版本及账户 ID，不含凭据/媒体；账户切换清空并取消旧请求。

预览压缩输入池仅在内存、按账户/作品/弹窗作用域隔离，关闭/pagehide/已知会话失效清除。命中不发请求，故不能自行发现客户端未知的远端撤权或未更新版本的文件替换；首次/未命中仍经过鉴权。内存预算、协议和生命周期以[播放器架构](../architecture/webp-player.md)为准。

## 凭据与剩余风险

- Better Auth Cookie 默认 7 天到期、每日更新、Cookie Cache 5 分钟；实际 `Secure/HttpOnly/SameSite` 必须在生产 HTTPS 下核验，`useSecureCookies` 受 URL、生产模式和 Trusted Origins 组合影响。
- Trusted Origins 只列真实入口，不使用宽泛来源；`JWT_SECRET/JWT_TTL`、`INIT_ADMIN_*` 是遗留模板变量，不是当前会话/初始化机制。
- IP 限流是单进程内存状态，重启清空、多实例不共享；不替代鉴权或可信网络身份。
- 现有回归未穷举所有接口；动态领域错误仍需审查，logger 不承诺识别无字段标签的任意秘密文本。
- 曾暴露外站凭据的轮换与 Git 历史清理仍需独立证据；只登记类型、日期和负责人，不记录秘密值。

## 权限回归与变更门禁

新增公共前缀/matcher、HTTP/Action/tRPC transport、procedure 边界、账户/角色、Token/Cookie/信任头、端口/挂载或服务外部调用方时，同步更新本文和权限测试。

最小回归包含无凭证、错误/有效凭证、缺配置、跨账户/跨资源、路径穿透、限流、脱敏；高风险入口断言未授权时数据库/文件零写入。现有入口测试包括 `proxy.test.ts`、`auth-boundary.test.ts`、媒体 Route 的 `route-auth.test.ts`、`protected-actions.test.ts` 和 scheduler Route 测试。

### 错误传输与生产 Next.js 回归

`tests/integration/security-next.test.ts` 在临时环境构建真实 Next.js 生产框架与实际代理/Route/tRPC/logger，使用合成会话及业务 I/O，验证 HTTP 和 stdout/stderr 不泄漏合成秘密。它不读取应用环境、生产数据库或收藏目录，不验证真实 Better Auth 签名/过期、Cookie、反向代理及全部业务页面。注入限流决策的单测也不验证真实限流窗口。

具体命令与环境要求见[测试策略](../development/testing-strategy.md)。真实浏览器登录、Cookie 和代理配置仍是[发布门禁](../operations/deployment.md)，不能用 mock 或临时框架测试替代。
