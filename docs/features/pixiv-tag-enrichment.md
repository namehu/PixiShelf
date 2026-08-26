---
status: current
scope: Pixiv 来源标签的人工触发补全、字段发布、任务状态和封面存储
last-verified: 2026-08-26
sources:
  - packages/pixishelf/server/routers/tag.ts
  - packages/pixishelf/services/pixiv-tag-enrichment-service.ts
  - packages/pixishelf-job-executors/src/pixiv-tag/
  - packages/pixishelf-db/prisma/schema.prisma
  - build/docker-compose.dev.yml
  - build/docker-compose.deploy.yml
---

# Pixiv 标签补全

标签管理页提供人工触发的 Pixiv 补全。默认操作会把发现阶段的全部未检查候选纳入一个持久化逻辑批次，也可以在列表中多选最多 200 个标签后强制重新查询。显式开启“刷新已有资料”后，所选标签或全部 Pixiv 来源标签都会重新查询并刷新 Pixiv 管理字段。它只处理数据库中已经存在的普通标签，不创建新标签，也不会由扫描、计划任务或页面浏览自动触发。

## 候选范围

一个标签同时满足以下条件时才是候选：

- `namespace=general`；
- 不是系统标签；
- 至少通过一个 `ArtworkTag.provenance=SOURCE` 关系连接到 `providerKey=pixiv` 的来源引用；
- 默认批量操作中尚无 `providerKey=pixiv` 的外部检查状态。

默认批量任务按标签 ID 以 200 个为数据库分页大小持续发现，直到当次候选集合耗尽，并跳过已有任意检查状态的标签。200 不是逻辑批次上限；多选补全仍会强制重新查询最多 200 个所选标签。全量刷新不受 200 个逻辑批次上限限制，会持续发现全部 Pixiv 来源标签。发现时会冻结每个标签的 ID、原始名称和刷新模式。单标签重试仍会重新验证标签名称和来源关系；标签已经删除、改名或失去 Pixiv 来源关系时不发布旧结果。

## 数据来源与发布规则

Worker 只访问 Pixiv 公共标签 Ajax 接口，不使用 Cookie 或登录会话。规范化结果包含：

- 中文翻译 `name_zh`；
- 英文翻译 `name_en`；
- Pixpedia `abstract`；
- Pixpedia 封面图片。

默认发布遵循只填空字段：任何已有非空翻译、简介或封面都不会被自动覆盖，已有封面时也不会重复下载远端图片。显式刷新会用 Pixiv 本次返回的非空中文翻译、英文翻译、Pixpedia `abstract` 和成功保存的封面替换旧值；Pixiv 未返回、封面下载失败或执行期间被人工修改的字段保留现值。`name` 和用户维护的 `description` 永远不由补全或刷新覆盖，`description` 与 Pixpedia `abstract` 分开存储、分开展示。

默认补全实际填入至少一种翻译且当前 `translateType=NONE` 时，翻译来源变为 `PIXIV`；已有 `MANUAL` 或 `AI` 来源不变。显式刷新成功发布至少一种翻译时，来源变为 `PIXIV`。中英文翻译与来源作为一组执行并发比较；任务查询期间任一成员被修改时整组跳过。用户在标签编辑框保存任一翻译后来源为 `MANUAL`；两种翻译都清空时来源为 `NONE`。

## 任务与状态

`PIXIV_TAG_ENRICHMENT` 运行在 `BACKGROUND_WRITER`：

1. `DISCOVER` 父任务先统计候选数，再按 ID 每页 200 个持续发现全部候选，为每个标签创建一个低优先级 `TAG` 子任务，并记录总数、页数、创建数和幂等复用数；
2. 每个子任务只查询并发布一个标签，因此会在标签之间释放 writer lane；
3. 网络限流和暂时错误按 `Retry-After` 或指数退避重试；响应结构不匹配时安全失败；
4. 管理页轮询父任务和子任务状态，失败或部分成功的标签可单独重试。

任务总览把同一 `DISCOVER` 父任务派生的全部 `TAG` 子任务折叠为一个逻辑批次。父任务完成候选发现后，执行动态仍以父任务 ID 稳定显示批次执行状态、已处理数、总数和整体进度，实际运行的子任务只作为当前处理项展示；直到全部子任务进入终态，批次才从活动视图中结束。关闭管理页不会停止持久队列。从标签管理页取消整批任务，或在任务页取消该批次中的任一任务，都会先停止父任务继续派生，再在事务内锁定活动子任务：排队、等待重试和暂停项直接进入 `CANCELLED`，当前运行项进入 `CANCELLING`。已完成的标签结果不回滚，取消审计事件按有界分块写入。

每个标签的 `TagExternalMetadata` 保存最近一次规范化响应、SHA-256、状态、尝试/成功时间、错误摘要和 SystemJob ID。状态含义如下：

| 状态      | 含义                                             |
| --------- | ------------------------------------------------ |
| `SUCCESS` | Pixiv 返回有效数据，所需封面也已保存             |
| `PARTIAL` | 本次需要写入封面，文本响应有效但远端封面下载或校验失败 |
| `NO_DATA` | 请求成功或明确不存在，但没有可用翻译、简介或封面 |
| `FAILED`  | 请求、限流重试耗尽或响应契约校验失败             |

默认批量操作跳过所有已有检查状态，包括失败状态；重新查询可以使用标签行上的单项重试，也可以多选后作为一个批次补全。显式刷新可以刷新所选标签，或把全部 Pixiv 来源标签排入一个连续刷新批次；刷新下载失败时保留原封面。

标签管理列表可以按“非 Pixiv 来源、待检查、已检查、成功、部分成功、无数据、失败”筛选；该条件在数据库分页前应用，并可与名称和翻译状态组合。

多选批次创建成功后，标签列表立即清空选择；打开的弹窗保留本次标签快照用于展示进度。批次进入终态后弹窗只显示结果和关闭操作，不在同一次弹窗会话中再次创建任务；关闭后重新打开才开始下一次操作。

## 封面存储与读取

Pixiv 作者图片和标签封面统一保存在既有的 `PIXISHELF_PUBLIC_DATA_PATH`：

```text
pixiv_data/
├── artists/<user-id>/...
└── tags/<sha256>.<真实扩展名>
```

Worker 对该挂载可写，App 只读。标签封面只接受 HTTPS `i.pximg.net`，每次重定向都重新检查主机，并限制响应大小、图片格式、像素数和尺寸；Sharp 验证成功后才通过临时文件原子发布。数据库只保存内容哈希文件名，不保存远端 URL。

数据库只保存文件名；响应 DTO 将作者图片和标签封面统一生成为显式 `/api/pixiv-data/...` URL。该 Route 受 Session 保护，只允许读取 `artists` 和 `tags` 下的受支持图片，并再次执行根目录和符号链接边界检查。

标签管理列表用缩略图明确区分有封面、无封面和读取失败；点击已有封面的缩略图可以在页面内查看完整图片。

部署、备份和恢复时，`PIXISHELF_PUBLIC_DATA_PATH` 必须和 PostgreSQL、原媒体、派生媒体属于同一恢复点。App 将该宿主目录只读挂载到 `/app/pixiv-data`，Worker 对同一个容器路径读写；它不属于 Next `public`，也不挂载给 ImgProxy。精确挂载见 [Build 与部署](../../build/README.md)，恢复要求见[备份与恢复基线](../operations/backup-and-recovery.md)。
