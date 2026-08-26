---
status: current
scope: PixiShelf 当前调用者、页面、HTTP、tRPC、Server Action、服务网络和存储权限边界
last-verified: 2026-08-26
sources:
  - packages/pixishelf/proxy.ts
  - packages/pixishelf/lib/auth/
  - packages/pixishelf/server/trpc.ts
  - packages/pixishelf/server/routers/
  - packages/pixishelf/app/api/
  - packages/pixishelf/actions/
  - build/docker-compose.dev.yml
  - build/docker-compose.deploy.yml
  - build/.env.example
---

# PixiShelf 权限与接口边界

本文回答“谁可以调用什么、在哪一层校验、调用后能修改什么，以及当前仍有哪些权限风险”。它描述当前代码与部署基线，不是未来 RBAC 设计，也不承诺对第三方提供稳定开放 API。

精确路由、procedure、环境变量和挂载仍以代码、Compose 与 `.env.example` 为准。新增或改变接口时，不能只更新本表而不更新执行层校验和测试。

## 结论

当前权限模型是**单一信任域**：

- 有效 Better Auth 会话可以进入全部普通页面和管理页面；
- `adminProcedure` 当前直接等于 `authProcedure`，只表达“这是敏感管理接口”，没有额外角色判断；
- 系统可以创建多个账户，但所有已登录账户拥有同等实例管理员能力；“单用户部署”指没有多租户和权限隔离，不代表数据库只能存在一个账户；
- scheduler 和扫描 Webhook 不使用浏览器会话，分别使用不同的 Bearer Token；
- Worker、PostgreSQL、ImgProxy 等服务依赖 Compose 网络、端口暴露和文件挂载形成基础设施边界；
- 当前不能把任一账户交给不可信用户，也不能把 App、PostgreSQL 或 ImgProxy 直接暴露到不可信网络后仍声称存在完整权限隔离。

## 调用者与凭证

| 调用者          | 当前凭证                                     | 允许范围                                                                       | 不允许假设                                                                               |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 未登录浏览器    | 无                                           | `/`、`/login`；登录和首次初始化 Server Action                                  | 不能读取目录、媒体或管理数据                                                             |
| 会话账户        | Better Auth Session Cookie                   | 所有受保护页面、HTTP API 和绝大多数 tRPC/Server Action                         | 账户之间没有只读、编辑、管理之分                                                         |
| 扫描调用方      | `Authorization: Bearer <SCAN_WEBHOOK_TOKEN>` | `/api/webhooks/scan` 的健康/认证检查、目录发现、明确列表扫描和对应任务状态查询 | 该 Token 不能读取其他后台任务、创建全目录强制刷新，也不能调用 scheduler 或浏览器会话接口 |
| scheduler       | `Authorization: Bearer <INTERNAL_JOB_TOKEN>` | `/api/internal/scheduler/tick` 的健康检查和计划物化                            | scheduler 不直接访问数据库或执行领域任务                                                 |
| 通用 Worker     | `DATABASE_URL` 与读写文件挂载                | 领取任务、更新领域/任务数据、修改原媒体与派生媒体                              | 没有用户会话，也不应接受公网业务请求                                                     |
| ImgProxy 调用方 | 当前无 URL 签名或应用会话校验                | 处理允许的本地原媒体和派生媒体路径                                             | 端口可达不等于经过 PixiShelf 登录授权                                                    |
| 实例管理员      | 主机/NAS/Docker/PostgreSQL 凭据              | 部署、备份、恢复、配置、网络和存储                                             | 主机权限超出应用权限模型，必须单独保护                                                   |

`SCAN_WEBHOOK_TOKEN` 与 `INTERNAL_JOB_TOKEN` 必须使用不同的长随机值，不能复用 Better Auth、数据库或外部来源凭据。

## 请求保护链

```text
浏览器 / 外部调用方
  └── 受控反向代理与 HTTPS
        └── Next.js proxy.ts
              ├── 公共路径放行
              ├── 其他页面/API校验 Better Auth Session
              └── 注入 x-user-session / x-pathname
                    ├── 页面或 HTTP Route
                    ├── tRPC procedure 复核
                    └── Server Action 复核（仅 authActionClient）
```

### Next.js 代理层

`packages/pixishelf/proxy.ts` 当前只把以下路径列为无需会话的公共路径：

- `/`；
- `/login`；
- `/api/webhooks/scan`；
- `/api/internal/scheduler/tick`。

前两项用于跳转、登录和首次初始化；后两项必须在 Route 内继续校验各自 Bearer Token。除 `_next/static`、`_next/image` 和 `favicon.ico` 外，其他页面和 API 在代理层校验 Session：

- 未登录页面请求重定向到 `/login?redirect=...`；
- 未登录 API 请求返回 `401`；
- 已登录请求由代理覆盖写入 `x-user-session` 和 `x-pathname`，Root Layout 用它们初始化用户状态。

反向代理必须清除来自外部客户端的 `x-user-session` 和 `x-pathname`，只允许 PixiShelf 自己注入。`x-forwarded-for` 只有在 App 仅接受可信反向代理流量时才能作为限流身份；直接暴露 App 时客户端可以伪造该头。

### tRPC 过程层

| 过程              | 实际校验                     | 当前含义                                 |
| ----------------- | ---------------------------- | ---------------------------------------- |
| `publicProcedure` | 仅进程内 IP 限流             | procedure 本身不要求 Session             |
| `authProcedure`   | IP 限流 + Session/User 存在  | 任一有效账户                             |
| `adminProcedure`  | 当前直接复用 `authProcedure` | 敏感管理接口的语义标记，不是额外角色门禁 |

`/api/trpc/*` 在传输层仍受 `proxy.ts` 保护，因此当前 `series.list` 和 `series.get` 虽使用 `publicProcedure`，通过标准 HTTP 入口访问时仍需要 Session。如果以后增加绕过 Next.js 代理的新 transport 或服务端直接调用，不能继续假设这两个 procedure 会自动鉴权。

### Server Action 层

`authActionClient` 会重新读取 Better Auth Session 并提供 `userId`；普通 `actionClient` 不做会话校验。页面是否在 `/admin` 下不是 Server Action 的授权替代品。

## 页面矩阵

| 路径                                                     | 代理层       | 页面内额外角色校验                     | 当前结果                                 |
| -------------------------------------------------------- | ------------ | -------------------------------------- | ---------------------------------------- |
| `/`                                                      | 公共         | 无                                     | 立即跳转 `/dashboard`，后者需要 Session  |
| `/login`                                                 | 公共         | 已有 Session 时代理重定向 `/dashboard` | 登录；无账户时显示首次初始化             |
| `/dashboard`、作品、艺术家、标签、系列、viewer、settings | Session      | 无                                     | 任一有效账户可浏览和使用对应操作         |
| `/admin/*`                                               | Session      | Admin Layout 无角色判断                | 任一有效账户可进入全部管理页面           |
| `/admin/scan-history/[id]/source-audit`                  | Session      | 写操作由 `adminProcedure` 复核         | 查看核对；管理员可提交选定来源同步       |
| `/admin/archive/inbox`                                   | Session      | 写操作由 `adminProcedure` 复核         | 持久添加、解析控制、重试、取消与批量入队 |
| `/admin/archive`                                         | Session      | 写操作由 `adminProcedure` 复核         | 归档任务查询、单项及当前页批量控制       |
| `/change-password`                                       | Session      | `authActionClient` 复核 Session        | 只能修改当前会话账户密码                 |
| `_next/static`、`_next/image`、`favicon.ico`             | matcher 排除 | 由 Next.js/静态服务器处理              | 不应包含私有原媒体文件                   |

## HTTP Route 矩阵

“Session（代理）”表示 Route 文件本身没有独立会话中间件，安全性依赖 `proxy.ts` 始终执行；“Session（双层）”表示 Route 内还会通过 Better Auth 再次验证。

| 路径与方法                                      | 调用者与执行层校验                                      | 数据/文件能力                                                                                                   | 风险等级                                                        |
| ----------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `GET/POST /api/auth/[...all]`                   | Session（代理）；POST 另有每 IP 10 次/分钟限流          | Better Auth 会话与账户操作                                                                                      | 高；当前登录走 `/login` Server Action，不依赖未登录访问该 Route |
| `GET/POST /api/trpc/[trpc]`                     | Session（代理）+ procedure 级校验                       | 取决于具体 router                                                                                               | 取决于 procedure                                                |
| `GET/POST /api/internal/scheduler/tick`         | 公共 transport + `INTERNAL_JOB_TOKEN`；未配置返回 `503` | GET 健康检查；POST 物化到期计划任务                                                                             | 高；Token 泄露可持续创建后台任务                                |
| `GET/HEAD/POST /api/webhooks/scan`              | 公共 transport + `SCAN_WEBHOOK_TOKEN`；未配置返回 `503` | GET 无 `jobId` 只健康检查、有 `jobId` 只读 `SYSTEM + SCAN` 受限 DTO；HEAD 只认证；POST 可创建目录发现或列表扫描 | 高；Token 泄露可触发高成本扫描并读取对应扫描摘要                |
| `POST /api/scan/stream`                         | Session（双层，`requireAdminRequest`）                  | 入队或执行目录发现/列表扫描；拒绝全目录强制刷新                                                                 | 高，数据库和原媒体目录读取                                      |
| `POST /api/scan/rescan`                         | Session（双层，`requireAdminRequest`）                  | 重扫一个 Artwork，更新目录与审计                                                                                | 高，数据库和文件关系变化                                        |
| `POST /api/migration/stream`                    | Session（双层，`requireAdminRequest`）                  | 入队或执行迁移、复制/移动/清理                                                                                  | 最高，可能修改原媒体                                            |
| `POST /api/artwork/[id]/replace`                | Session（代理）                                         | 初始化、提交或回滚媒体替换会话                                                                                  | 最高，数据库与原媒体写入                                        |
| `GET/POST /api/artwork/upload-chunk`            | Session（代理）                                         | 查询上传状态、写入媒体分块                                                                                      | 高，原媒体写入                                                  |
| `POST /api/artwork/media-chapters/upload`       | Session（代理）                                         | 上传章节 manifest                                                                                               | 高，数据库/派生或媒体侧写入                                     |
| `DELETE /api/artwork/media-chapters/[image-id]` | Session（代理）                                         | 清除章节记录，可选择删除文件                                                                                    | 高，数据库与文件删除                                            |
| `GET /api/v1/images/[...path]`                  | Session（代理）+ 路径边界检查                           | 读取并流式返回 `SCAN_PATH` 内媒体，支持 Range                                                                   | 高，原媒体内容读取                                              |
| `GET/HEAD /api/pixiv-data/[...path]`            | Session（代理）+ 路径、根目录与文件类型检查             | 从独立于 Next `public` 和 ImgProxy 的只读挂载返回作者图片与标签封面；拒绝作品 metadata JSON                     | 中，私有来源图片读取                                            |
| `GET /api/v1/media/[image-id]/chapters`         | Session（代理）                                         | 读取已发布章节 manifest                                                                                         | 中，私有媒体元数据读取                                          |
| `GET /api/v1/media/[image-id]/keyframes`        | Session（代理）                                         | 读取已发布代表帧 manifest                                                                                       | 中，私有媒体元数据读取                                          |

HTTP Route 新增文件写入、删除、迁移或任务控制时，应使用 Route 内 Session 复核，不能只依赖代理路径没有被误加入 `PUBLIC_PATHS`。

`POST /api/webhooks/scan` 保持现有 URL、Bearer Token 和生产 `202` 响应字段。`type=list`
只处理提交的 `metadataList`，新身份可导入，已有 Source Reference 使用 `SKIP`；`{}` 和 `type=full`
仍是目录发现。公开请求体不再接受 `force` 字段；任意 `force` 请求返回 HTTP `400` 参数错误，且不写入
`SystemJob` 或 `ScanRun`。GET 和 HEAD 永不触发扫描。App 任务命令层同时拒绝新建、人工复制或
重试 `FULL_RECONCILE`；当前 Worker 不再解析或执行该模式，历史终态任务只保留查询和展示。生产升级门禁会
阻断任何仍处于 `PENDING / RETRY_WAIT / RUNNING / PAUSING / PAUSED / CANCELLING` 的历史 FULL 任务。

Pixiv 作品 metadata 和同步报告仍不得通过 `/api/pixiv-data` 或静态目录直接下载。管理端只能提交作品 ID、报告 ID 与 `before/after` 标识；服务端从当前唯一 Pixiv 身份构造固定路径，并校验已完成任务、报告身份、路径边界、符号链接、文件类型和大小后返回解析后的 JSON。

## tRPC Router 矩阵

所有标准 HTTP tRPC 调用先经过 Session 代理门禁。下表记录 procedure 自己使用的边界。

| Router           | 读取                                                            | 修改/控制                                                            | 当前 procedure 边界                                                                |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `auth`           | 当前账户 `me`                                                   | 无                                                                   | `authProcedure`                                                                    |
| `artist`         | 详情、分页                                                      | 创建、修改、收藏、删除、Pixiv 补全/取消/重试、采用来源姓名           | 既有读写为 `authProcedure`；Pixiv 任务控制与采用来源姓名为 `adminProcedure`        |
| `artwork`        | 详情、feed、相邻、随机、推荐、上传路径、Pixiv 同步汇总与受控报告/快照读取 | 创建、修改、删除、媒体增删与排序、Pixiv 同步/取消/重试               | 大多为 `authProcedure`；作品删除、视频重新探测、Pixiv 任务控制及报告 JSON 读取为 `adminProcedure` |
| `search`         | 搜索建议                                                        | 无                                                                   | `authProcedure`                                                                    |
| `tag`            | 查询、管理列表与 Pixiv 补全状态                                 | 创建、修改、删除、批量补全与单标签重试                               | 普通管理为 `authProcedure`；Pixiv 补全读写为 `adminProcedure`                      |
| `series`         | `list`、`get`                                                   | 创建、修改、删除、成员增删与排序                                     | 读取为 `publicProcedure`，写入为 `authProcedure`；transport 仍需 Session           |
| `setting`        | 健康、扫描路径、系统设置                                        | 修改扫描路径和系统设置                                               | 全部 `authProcedure`                                                               |
| `user`           | 全部账户                                                        | 创建、删除其他账户                                                   | 全部 `authProcedure`；新增账户拥有同等管理员能力                                   |
| `userSetting`    | 当前账户设置                                                    | 写入主要通过 Server Action                                           | `authProcedure`，以 `userId` 限定当前账户                                          |
| `scanRun`        | 扫描历史、详情                                                  | 无                                                                   | `authProcedure`                                                                    |
| `sourceAudit`    | `availability/get/listItems/getApplyOverview/getApplyOperation` | `start`、`startApply`（1–50 个 NEW/CHANGED）                         | 所有读取为 `authProcedure`；两个 mutation 为 `adminProcedure`                      |
| `migration`      | precheck、失败项                                                | pause/resume/cancel 等控制                                           | 读取 `authProcedure`，控制 `adminProcedure`                                        |
| `localImport`    | preview、status                                                 | 保存映射、启动、取消                                                 | 读取 `authProcedure`，写入/控制 `adminProcedure`                                   |
| `archiveInbox`   | 持久收件列表与汇总                                              | 创建/修正、暂停/恢复、重试/取消、批量归档入队                        | 读取 `authProcedure`，写入/控制 `adminProcedure`                                   |
| `archive`        | 分页任务、项目、统计和批量结果                                  | 单项操作、重试和 `PAUSE/RESUME/CANCEL/RETRY` 批量控制                | 读取 `authProcedure`，写入/控制 `adminProcedure`                                   |
| `pendingReplace` | 预览与状态                                                      | 绑定、排序、执行、取消、恢复、清理备份                               | 全部 `adminProcedure`                                                              |
| `job`            | 多类状态、待处理失败和队列读取                                  | 创建、取消、重试、逐条确认失败提醒、优先级、scheduler 与中央任务控制 | 一般状态读取为 `authProcedure`；敏感后台面与控制为 `adminProcedure`                |

由于当前所有账户等权，`authProcedure` 与 `adminProcedure` 的运行时能力相同。任何未来角色分离都必须先审查表中使用 `authProcedure` 的用户管理、系统设置、目录写入和删除操作，不能只给 `adminProcedure` 增加角色判断后宣布完成。

`sourceAudit.startApply` 只接受 audit ID、1–50 个不重复 item ID 和 UUID 幂等键；客户端不能提交绝对路径、hash、
来源身份或写策略。服务端从已完成核对冻结这些证据，并在共享 SCAN lock 内复核 cutover、dispatcher、来源根、
inventory 与 `SCAN@v3` Worker readiness。读取接口只返回相对 metadata path、固定结果码和脱敏摘要，不返回冻结的
绝对路径、数据库异常原文或内部 apply reason 原文。

## Server Action 矩阵

| Action                                                   | 边界                                      | 能力                                                    |
| -------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `loginUserAction`                                        | 公共 `actionClient` + 每 IP 5 次/分钟限流 | 使用用户名/密码建立 Better Auth Session                 |
| `initAdminAction`                                        | 公共 `actionClient`                       | 创建账户；当前 Action 自身没有验证系统用户总数仍为 0    |
| `changePasswordAction`                                   | `authActionClient` + 每 IP 5 次/分钟限流  | 修改当前账户密码                                        |
| `toggleLikeAction`                                       | `authActionClient`                        | 修改当前账户与 Artwork 的收藏关系                       |
| `updateProfileAction`、`updateUserSettingAction`         | `authActionClient`                        | 只修改当前 `userId` 的资料与偏好                        |
| `batchCreateArtworksAction`、`batchRegisterImagesAction` | `authActionClient`                        | 批量写入作品与媒体记录                                  |
| `exportNoSeriesArtworksAction`                           | 无 Action 级 Session 复核                 | 读取并导出未归系列 Artwork 标识；依赖调用页面的代理保护 |
| `updateTagStatsAction`                                   | 无 Action 级 Session 复核                 | 重建标签计数；依赖调用页面的代理保护                    |

首次初始化页面只在 `hasUsers() === false` 时显示表单，但 `initAdminAction` 目前只检查同名账户是否存在，不复核“系统仍无任何账户”。修复前不得把初始化入口暴露到不可信网络。

## 服务、网络和存储矩阵

| 组件          | 网络入口                                    | 数据库                 | 原媒体                     | 派生媒体   | Pixiv data | 当前保护                                                                    |
| ------------- | ------------------------------------------- | ---------------------- | -------------------------- | ---------- | ---------- | --------------------------------------------------------------------------- |
| `app`         | 宿主机 5430 / 反向代理                      | 读写；启动时 migration | 生产默认 `ro`，可配置 `rw` | `rw`       | `ro`       | Better Auth、Bearer Token、代理网络与路径校验                               |
| `worker`      | 健康端口 3011 仅 Compose 网络，未映射宿主机 | 读写                   | `rw`                       | `rw`       | `rw`       | 同进程双 lane；健康端点无认证，依赖容器网络隔离                             |
| `scheduler`   | 无入站业务接口，只访问 App                  | 无                     | 无                         | 无         | 无         | 仅持有 `INTERNAL_JOB_TOKEN`                                                 |
| `postgres`    | 默认映射宿主机 5432                         | 数据库本体             | 无                         | 无         | 无         | 用户名/密码 + 主机防火墙；Compose 未配置 TLS                                |
| `imgproxy`    | 默认映射宿主机 5431                         | 无                     | `ro`                       | `ro`       | 无         | 仅限制 `local:///media/` 和 `local:///derived-media/` 来源；当前 URL 未签名 |
| `zip-convert` | 本地 CLI，无服务端口                        | 无                     | 读写指定本地目录           | 写转换结果 | 无         | 依赖执行它的主机账户；当前源码存在不应入库的外部站点会话凭据                |

ImgProxy Compose 没有配置签名 Key/Salt，且默认发布宿主机端口。反向代理必须将它限制在受信网络或等效的认证路径；仅使用难猜文件路径不能视为授权。PostgreSQL 的宿主机端口也应由防火墙限制，不对互联网开放。

Worker 两个 lane 共用同一容器的数据库凭据和 `rw` 媒体挂载，lane 是执行资源和 capability 边界，不是操作系统级权限隔离。`ARCHIVE_RESOLVE_ITEM` 的 Executor 不执行媒体写入，所有归档下载、回收、恢复、永久清理和其他文件操作仍由 writer lane 执行并经过根目录/符号链接边界校验。

归档任务 payload、结果、事件、错误与普通日志统一脱敏。不得记录 Cookie、Authorization、完整 Provider locator、token，或 URL 路径中的敏感段；列表和批量结果只返回完成管理操作所需的脱敏值。

## 凭据与信任头

| 项目                                          | 用途                           | 当前规则                                                                                  |
| --------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                          | Better Auth 会话安全           | 强随机值，只保存在受控环境；不能与其他 Token 复用                                         |
| Better Auth Cookie                            | 浏览器会话                     | 默认 7 天到期、每日更新，Cookie Cache 5 分钟；生产必须实测 `Secure`/`HttpOnly`/`SameSite` |
| `BETTER_AUTH_TRUSTED_ORIGINS`                 | 允许的浏览器来源               | 只列真实 HTTPS 入口和明确本地入口，不使用宽泛来源                                         |
| `SCAN_WEBHOOK_TOKEN`                          | 外部扫描调用方                 | 缺失时 Route fail closed 为 `503`；错误值 `401`                                           |
| `INTERNAL_JOB_TOKEN`                          | scheduler                      | 缺失时 Route fail closed 为 `503`；错误值 `401`                                           |
| `POSTGRES_PASSWORD` / `DATABASE_URL`          | App 与 Worker 数据库访问       | 只在环境和受控备份中保存；不要记录到日志或文档                                            |
| `x-user-session` / `x-pathname`               | Next.js 代理到应用内部的上下文 | 外部反向代理必须删除客户端同名头                                                          |
| `x-forwarded-for`                             | 进程内 IP 限流                 | 只能信任受控反向代理重写后的值                                                            |
| `JWT_SECRET` / `JWT_TTL`                      | 遗留模板变量                   | 当前 Better Auth 浏览器会话不依赖它们，不能作为现行认证说明                               |
| `INIT_ADMIN_USERNAME` / `INIT_ADMIN_PASSWORD` | 遗留模板变量                   | 当前代码没有读取它们自动初始化账户；首次账户由 `/login` Action 创建                       |

当前限流器只保存在单个 App 进程内，重启后清空，多实例之间也不共享。它是缓解措施，不是认证或全局抗滥用保证。

## 当前必须跟踪的风险

以下内容是现状，不代表已解决：

1. `initAdminAction` 没有在写入时复核系统用户数为 0；首次初始化必须增加原子门禁和并发测试。
2. 所有账户等权，而用户管理、系统设置和多类删除操作仍使用 `authProcedure`；不得向不可信用户发放账户。
3. 媒体替换、分块上传和章节增删等 HTTP Route 只依赖代理层 Session；应逐步增加 Route 内复核与未授权测试。
4. 三个旧 Server Action 没有使用 `authActionClient`，应补 Session 复核。
5. ImgProxy URL 未签名且端口默认映射宿主机；必须依赖网络/反向代理限制，后续应评估签名 URL 或受保护转发。
6. `x-user-session`、`x-pathname` 和 `x-forwarded-for` 的安全性依赖反向代理正确清理和重写。
7. Better Auth 的 `useSecureCookies` 当前受生产模式、HTTPS URL 和 Trusted Origins 配置组合影响，部署后必须检查真实响应 Cookie 属性。
8. `zip-convert` 的已跟踪源码含外部站点会话凭据；必须轮换该凭据、从历史和当前代码移除，并改为运行时秘密注入。
9. 当前没有覆盖代理公共路径、内部信任头和全部接口未授权分支的统一自动化测试。
10. Worker lane 共享同一容器文件权限；解析 lane 的最小权限当前依赖 capability 注册、类型契约和 Executor 边界，而不是独立容器挂载。

风险修复应更新本文中的“当前事实”，并在 [TODO](../../TODO.md) 留下可执行项。涉及凭据泄露时，只记录凭据类型、轮换时间和负责人，不记录实际值。

## 变更门禁

以下变化必须同步更新本文并添加权限测试：

- 新增公共页面、`PUBLIC_PATHS` 或 matcher 排除项；
- 新增 HTTP Route、Server Action、tRPC Router 或新的 transport；
- 将 procedure 在 `publicProcedure`、`authProcedure`、`adminProcedure` 之间移动；
- 新增账户、角色、共享访问或外部 API；
- 新增 Token、Cookie、Webhook 或反向代理信任头；
- 修改数据库端口、服务端口、容器网络或媒体挂载读写模式；
- 让 App、Worker 或 ImgProxy 接受新的外部调用方。

最小权限测试应覆盖：无凭证、错误凭证、有效凭证、凭证缺失配置、越界资源、路径穿透、限流和敏感值日志脱敏。高风险写入口还要断言未经授权时数据库和文件系统均未发生变化。

相关文档：

- [产品基线](../product/product-baseline.md)
- [当前架构](../architecture/current-architecture.md)
- [测试策略](../development/testing-strategy.md)
- [部署基线](../operations/deployment.md)
- [备份与恢复基线](../operations/backup-and-recovery.md)
- [扫描 Webhook 契约](../../packages/pixishelf/docs/webhook-features.md)
