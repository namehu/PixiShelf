# PixiShelf 优化 TODO

这个文档用来记录后续可逐项推进的优化任务。每一项都尽量保持独立、可验证，避免一次性大改导致扫描、图库管理或生产构建行为变得不可控。

## P0：核心稳定性

- [x] 扫描链路 fixture 集成测试
  - 目标：用小型本地目录 fixture 覆盖真实扫描路径，而不只验证单个函数。
  - 覆盖场景：
    - 正常 Pixiv metadata 扫描；
    - metadata 缺失；
    - metadata 损坏；
    - 重复 metadata；
    - 同一作品多图；
    - local artwork 扫描；
    - 增量扫描重复执行不产生重复数据。
  - 验收：
    - 能在 `packages/pixishelf` 下通过单条 Vitest 命令运行；
    - 测试不依赖开发机真实图库；
    - 不访问用户真实文件目录。

- [x] Rescan 行为集成测试
  - 目标：保护 `rescanArtwork` 和 `rescanLocalArtwork` 在后续重构中不被改坏。
  - 覆盖场景：
    - Pixiv metadata 更新后重新扫描；
    - local artwork 增删图片后重新扫描；
    - 手工字段不被 local rescan 意外覆盖；
    - 图片、章节、tag 不重复创建。
  - 验收：
    - 测试能明确区分 Pixiv rescan 和 local rescan；
    - 数据库断言覆盖 artwork、image、tag、raw metadata。

- [x] 扫描取消与异常路径测试
  - 目标：保证长扫描取消、异常 metadata、数据库错误时状态可预期。
  - 覆盖场景：
    - 扫描中途取消；
    - 批处理前取消；
    - 批处理后取消；
    - metadata parse 异常不影响整体扫描策略。
  - 验收：
    - 用户可见错误信息不回退；
    - progress 状态不出现卡死或错误百分比。

## P1：性能与可观测性

- [x] 扫描性能分段日志
  - 目标：让“扫描慢”能快速定位到具体阶段。
  - 建议记录：
    - metadata discovery 耗时；
    - metadata parse 耗时；
    - media collection 耗时；
    - batch DB 写入耗时；
    - image seed 预计算耗时；
    - 每批处理数量、跳过数量、失败数量。
  - 验收：
    - 默认日志足够排查问题；
    - 不输出用户敏感路径的大量明文；
    - 不改变扫描结果和事务边界。

- [x] 大目录扫描压测脚本
  - 目标：构造可重复的性能基准，避免凭感觉优化。
  - 建议：
    - 生成临时 fixture 目录；
    - 支持 100、1,000、10,000 metadata 规模；
    - 输出扫描总耗时和阶段耗时。
  - 验收：
    - 不需要真实 Pixiv 收藏；
    - 运行后自动清理临时目录；
    - 结果可复制到 issue/PR 说明。

- [ ] 数据库写入热点排查
  - 目标：确认批处理里的 artist、tag、image、raw metadata 写入是否有明显瓶颈。
  - 验收：
    - 有一份简短结论：瓶颈在哪、是否值得改；
    - 如果不值得改，记录原因，避免反复讨论。

## P1：模块结构与可维护性

- [ ] 继续拆分 admin 扫描管理组件
  - 目标：把 UI 展示、扫描配置、扫描操作、进度展示拆开。
  - 候选文件：
    - `packages/pixishelf/app/admin/setting/_components/scan-management.tsx`
  - 验收：
    - 页面行为不变；
    - 扫描按钮、取消按钮、进度展示、错误提示都保留；
    - 新组件有清晰命名和单一职责。

- [x] 整理 artwork 管理页复杂组件
  - 目标：降低作品列表、筛选、批量操作、rescan 按钮之间的耦合。
  - 候选目录：
    - `packages/pixishelf/app/admin/artworks/_components`
  - 验收：
    - 页面交互不变；
    - rescan 入口仍然可用；
    - 列表筛选、分页、选择状态不回退。

- [x] 梳理 API route 中的服务边界
  - 目标：让 API route 更薄，业务逻辑尽量进入 service 层。
  - 候选：
    - scan stream route；
    - rescan route；
    - artwork 管理相关 route。
  - 验收：
    - route 主要负责参数校验、权限/上下文、调用服务、返回响应；
    - 服务层可单测。
  - 进展：
    - [x] `app/api/artwork/upload-chunk/route.ts` 上传分片逻辑已抽到 `services/artwork-service/media-upload.ts`，并补充 service 单测。
    - [x] `app/api/artwork/media-chapters/upload/route.ts` 章节 manifest 上传逻辑已抽到 `services/artwork-service/media-chapter-upload.ts`，并补充 service 单测。
    - [x] `app/api/artwork/[id]/replace/route.ts` 图片替换 init/commit/rollback 会话逻辑已抽到 `services/artwork-service/image-replace-session.ts`，并补充 service 单测。

## P2：类型与质量门禁

- [ ] API response 类型统一
  - 目标：减少前后端 response shape 不一致。
  - 建议：
    - 定义统一成功/失败响应类型；
    - 对扫描、rescan、artwork 管理接口优先处理。
  - 验收：
    - 前端调用能拿到明确类型；
    - 错误 response 包含稳定的 `message`；
    - 不引入大范围 API 行为变化。
  - 进展：
    - [x] 新增 `lib/api-response.ts`，统一 typed success/error/json helper，保持现有 JSON shape 不变。
    - [x] 为 artwork media 三组接口补充前后端 response 类型：upload chunk、media chapter upload、image replace session。
    - [x] 新增 `apiFailure` typed helper，迁移 internal scheduler tick 接口，保持 `{ success: false, error }` shape 不变。
    - [ ] scan/rescan 接口和更广泛 API 的 `{ message }` 迁移待单独设计，避免破坏现有前端对 `{ error }` 的依赖。

- [x] 逐步减少扫描链路中的宽松类型
  - 目标：降低 metadata、Prisma include/select、tag 处理中的类型漂移风险。
  - 验收：
    - 每次只收紧一个局部；
    - 保持现有测试通过；
    - 不借类型优化改业务逻辑。
  - 进展：
    - [x] 收紧 `ScanContext.artistCache`，新增 `ArtistCacheEntry`，替换 batch processor 中的 `Map<string, any>`。
    - [x] 为 batch processor 的 artwork/image/artworkTag/rawMetadata/artist createMany 数据和 artwork lookup map 补明确类型。
    - [x] `metadata-parser` 改为 `unknown` JSON root + `Record<string, unknown>` 安全读取，去掉 `catch(error: any)` 和 `let raw: any`。
    - [x] scan/rescan fixture Prisma stub 移除裸 `args: any`、`condition: any`、`tx: any`，改用轻量测试参数类型和安全 helper。

- [ ] CI/本地脚本分层固化
  - 目标：让质量检查路径更清晰。
  - 建议命令层级：
    - 快速：lint + typecheck；
    - 单元：Vitest 非集成测试；
    - 完整：build + 关键集成测试。
  - 验收：
    - README 或 docs 里写清楚；
    - package scripts 命名直观；
    - 不强迫普通开发每次都跑最重检查。

## P2：产品体验

- [x] 扫描错误提示统一
  - 目标：用户看到的是可行动的提示，开发日志保留细节。
  - 验收：
    - 用户提示不直接暴露长 stack；
    - 日志里仍有足够上下文；
    - scan、rescan、cancel 的错误格式一致。
  - 进展：
    - [x] 新增扫描错误格式化工具，统一取消、扫描路径未配置、数据库清空失败、批处理失败、rescan 常见失败等用户提示。
    - [x] scan/rescan service 错误数组改用稳定中文提示，logger 仍保留原始错误对象。
    - [x] scan stream、rescan stream、webhook scan 的 SSE/API 错误输出接入同一套提示；前端扫描 hook 会从 JSON error response 中提取可读文案。

- [x] 扫描历史或最近一次扫描摘要
  - 目标：用户能知道上次扫了什么、成功/失败多少、耗时多久。
  - 验收：
    - 设置页能看到最近一次扫描结果；
    - 至少包括开始时间、结束时间、总数、成功数、失败数；
    - 不影响当前扫描流程。
  - 进展：
    - [x] 新增独立扫描审计表 `ScanRun` / `ScanRunItem`，不把历史能力绑死在 `system_jobs.result` 上。
    - [x] Pixiv 全量/增量/客户端列表扫描、webhook 扫描、Pixiv rescan、本地 rescan 接入扫描运行记录。
    - [x] 本地目录导入、后台批量导入、本地创建作品接入同一套扫描审计历史；批量导入通过 `scanRunId` 串联创建和图片注册阶段。
    - [x] 作品级明细按批量写入，记录成功、跳过、失败及相对路径，不保存绝对路径或 raw metadata。
    - [x] 设置页新增扫描历史卡片，支持最近一次摘要、历史列表和按状态筛选详情。
    - [x] 新增 scheduler 扫描历史清理任务，默认关闭，可在任务计划页面开启或立即执行；终态历史保留 180 天，并按 `ScanRunType` 各保留最近 100 条。

- [x] 后台任务化扫描设计
  - 目标：让扫描不依赖页面连接长期保持。
  - 建议先写设计，不直接实现。
  - 设计要回答：
    - job 存在哪里；
    - progress 如何订阅；
    - 页面关闭后如何恢复；
    - 取消任务如何传播；
    - 与现有 `/api/scan/stream` 如何兼容或迁移。
  - 验收：
    - 形成设计文档；
    - 明确是否分阶段迁移；
    - 不在设计阶段改生产代码。
  - 进展：
    - [x] 新增 `docs/design/background-scan-jobs.md`，明确 `SystemJob` 负责运行态、`ScanRun` 负责审计历史。
    - [x] 设计 start/status/cancel 任务接口、页面恢复、取消传播、`/api/scan/stream` 兼容迁移和分阶段落地顺序。

## 建议执行顺序

1. 扫描链路 fixture 集成测试
2. Rescan 行为集成测试
3. 扫描性能分段日志
4. 大目录扫描压测脚本
5. 拆分 admin 扫描管理组件
6. 整理 artwork 管理页复杂组件
7. API response 类型统一
8. 后台任务化扫描设计

## 每项开始前的固定检查

- 先确认本项是否会改变用户可见行为。
- 如果改变行为，先写设计或验收标准。
- 优先补测试，再改实现。
- 每次只处理一个主题，避免“顺手优化”扩散。
- 完成后至少跑窄范围测试；核心扫描链路变更再跑 typecheck、lint、完整测试和 build。
