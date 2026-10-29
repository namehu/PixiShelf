---
status: current
scope: 发现来源的冻结查询、游标、目录投影、规则预览与收件衔接
last-verified: 2026-10-22
sources:
  - packages/pixishelf/services/archive-uploader/
  - packages/pixishelf-job-executors/src/archive/
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-job-contracts/src/
---

# 发现来源架构

用户入口和操作规则见[发现来源](../features/archive-discovery.md)。本页描述人工来源扫描如何产出长期目录，再进入共同的归档收件链路；扫描发现不等于下载，也不代表已归档。

## 查询、运行与目录分离

| 对象                       | 保存内容                                               | 不承担的职责                     |
| -------------------------- | ------------------------------------------------------ | -------------------------------- |
| Source                     | 上传者或标题查询、指纹、启用状态和最新/历史水位        | 不直接保存一次执行的进度         |
| ScanRun / ScanItem         | 冻结查询身份、规则版本、起止游标、扫描检查点和逐项分类 | 不作为可随来源编辑变化的查询引用 |
| CatalogItem                | 按来源/Provider/GID 复用的长期发现记录                 | 不等于 IntakeItem 或已下载作品   |
| IntakeItem / ArchiveImport | 显式接纳后的持久解析与下载                             | 不以来源扫描完成作为自动下载授权 |

上传者稳定 UID、名称模式、单/多上传者限制和标题规则共同参与规范化与指纹计算；展示名称不进入远端表达式。运行读取冻结条件，来源编辑不改写已运行任务。游标必须绑定实际查询，查询身份改变后不能沿用旧水位猜测扫描范围。

## 执行与提交

来源扫描、标题扫描和规则预览进入解析 lane，与归档下载 lane 共用 Worker 进程内的 Provider 限速。SEARCH／RESOLVE 可与下载重叠，下载名额占满不阻止解析；具体请求间隔和冷却持久化规则见[归档生命周期](../features/archive-lifecycle.md#原站请求的内存限速)。Provider 只处理受控 HTTPS URL 和有界响应，权限/SSRF 规则由[安全基线](../security/access-control.md)维护。

每次运行持久化扫描进度和候选，只有 fenced 完成才推进来源游标。中断、取消或失败不能把未完成页面标成已完成；重试沿冻结查询与已提交检查点恢复。批量父任务冻结来源顺序，每轮让出解析 lane 等待子扫描，不能持有执行槽等待同 lane 子任务结束。

目录列表将历史发现与当前收件、下载、作品、忽略及删除意图合并投影；单一目录状态不能替代这些领域事实。独立统计接口与列表解耦，查询性能见[发现来源查询](./archive-discovery-query-performance.md)。

## 规则与处置一致性

标题规则预览只评估已有目录，不重新请求远端或下载。预览冻结规则、目录范围和版本证据，人工复核后原子应用；同一来源只激活被验证的规则版本。人工接纳不绕过上传者限制、全局忽略或收件校验，详细契约见[标题规则](../features/archive-title-rules.md)。

入箱、忽略、来源删除等操作遵守来源锁、Provider/GID 锁顺序，并在事务内重读当前工作流。跨来源发现同一画廊不等于可以并发创建重复下载。相同幂等键只能重放相同请求。

停用来源保留历史；显式删除只级联清除该来源的扫描/目录，不反向删除收件、下载、作品或媒体，全局忽略身份保留。存在相关非终态任务时阻止删除。重建相同来源是新身份和空游标，恢复删除历史须依赖数据库备份。

## 依据与验证

旧表名前缀 `ArchiveUploader*` 同时服务上传者和标题来源，是演进兼容命名；不能据此推断仅支持上传者。当前类型和输入以 Schema、Zod 与 Registry 为准。

发布前应覆盖冻结条件/指纹、边界游标、取消恢复、全局去重、原子规则切换、删除方向及未授权零读写。早期方案与本地验收保留在[上传者扫描历史](../archive/design/e-hentai-uploader-manual-scan.md)和[标题扫描历史](../archive/design/e-hentai-title-keyword-scan.md)，其中旧版本字段和发布步骤不作为现行操作依据。
