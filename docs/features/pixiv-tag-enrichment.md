---
status: current
scope: Pixiv 来源标签的人工触发补全、字段发布、任务状态和封面存储
last-verified: 2026-08-24
sources:
  - packages/pixishelf/server/routers/tag.ts
  - packages/pixishelf/services/pixiv-tag-enrichment-service.ts
  - packages/pixishelf-job-executors/src/pixiv-tag/
  - packages/pixishelf-db/prisma/schema.prisma
  - build/docker-compose.dev.yml
  - build/docker-compose.deploy.yml
---

# Pixiv 标签补全

标签管理页提供人工触发的 Pixiv 补全。它只处理数据库中已经存在的普通标签，不创建新标签，也不会由扫描、计划任务或页面浏览自动触发。

## 候选范围

一个标签同时满足以下条件时才是候选：

- `namespace=general`；
- 不是系统标签；
- 至少通过一个 `ArtworkTag.provenance=SOURCE` 关系连接到 `providerKey=pixiv` 的来源引用；
- 默认批量操作中尚无 `providerKey=pixiv` 的外部检查状态。

批量任务会冻结标签 ID 和查询时的原始名称。单标签重试仍会重新验证标签名称和来源关系；标签已经删除、改名或失去 Pixiv 来源关系时不发布旧结果。

## 数据来源与发布规则

Worker 只访问 Pixiv 公共标签 Ajax 接口，不使用 Cookie、登录会话或浏览器扩展凭据。规范化结果包含：

- 中文翻译 `name_zh`；
- 英文翻译 `name_en`；
- Pixpedia `abstract`；
- Pixpedia 封面图片。

发布始终遵循只填空字段：任何已有非空翻译、简介或封面都不会被自动覆盖。`description` 是用户维护的标签描述，和 Pixpedia `abstract` 分开存储、分开展示。

当 Pixiv 实际填入至少一种翻译，且当前 `translateType=NONE` 时，翻译来源变为 `PIXIV`。已有 `MANUAL` 或 `AI` 来源不变。用户在标签编辑框保存任一翻译后来源为 `MANUAL`；两种翻译都清空时来源为 `NONE`。

## 任务与状态

`PIXIV_TAG_ENRICHMENT` 运行在 `BACKGROUND_WRITER`：

1. `DISCOVER` 父任务分页发现候选，为每个标签创建一个低优先级 `TAG` 子任务，然后结束；
2. 每个子任务只查询并发布一个标签，因此会在标签之间释放 writer lane；
3. 网络限流和暂时错误按 `Retry-After` 或指数退避重试；响应结构不匹配时安全失败；
4. 管理页轮询父任务和子任务状态，失败或部分成功的标签可单独重试。

任务总览把同一 `DISCOVER` 父任务派生的 `TAG` 子任务折叠为一个逻辑批次，当前执行槽仍显示实际运行的子任务。从标签管理页取消整批任务，或在任务页取消该批次中的任一任务，都会先停止父任务继续派生，再取消同批次所有排队和运行中的子任务。

每个标签的 `TagExternalMetadata` 保存最近一次规范化响应、SHA-256、状态、尝试/成功时间、错误摘要和 SystemJob ID。状态含义如下：

| 状态      | 含义                                             |
| --------- | ------------------------------------------------ |
| `SUCCESS` | Pixiv 返回有效数据，所需封面也已保存             |
| `PARTIAL` | 文本响应有效并已发布，但远端封面下载或校验失败   |
| `NO_DATA` | 请求成功或明确不存在，但没有可用翻译、简介或封面 |
| `FAILED`  | 请求、限流重试耗尽或响应契约校验失败             |

默认批量操作跳过所有已有检查状态，包括失败状态；重新查询必须使用标签行上的单项重试。

## 封面存储与读取

Pixiv 作者图片和标签封面统一保存在既有的 `PIXISHELF_PUBLIC_DATA_PATH`：

```text
pixiv_data/
├── artists/<user-id>/...
└── tags/<sha256>.<真实扩展名>
```

Worker 对该挂载可写，App 只读。标签封面只接受 HTTPS `i.pximg.net`，每次重定向都重新检查主机，并限制响应大小、图片格式、像素数和尺寸；Sharp 验证成功后才通过临时文件原子发布。数据库只保存内容哈希文件名，不保存远端 URL。

数据库只保存文件名；响应 DTO 将作者图片和标签封面统一生成为显式 `/api/pixiv-data/...` URL。该 Route 受 Session 保护，只允许读取 `artists` 和 `tags` 下的受支持图片，并再次执行根目录和符号链接边界检查。

部署、备份和恢复时，`PIXISHELF_PUBLIC_DATA_PATH` 必须和 PostgreSQL、原媒体、派生媒体属于同一恢复点。App 将该宿主目录只读挂载到 `/app/pixiv-data`，Worker 对同一个容器路径读写；它不属于 Next `public`，也不挂载给 ImgProxy。精确挂载见 [Build 与部署](../../build/README.md)，恢复要求见[备份与恢复基线](../operations/backup-and-recovery.md)。
