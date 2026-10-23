---
status: current
scope: 去重开发分支已实现的同艺术家内容检测与任务控制；不含审核和文件清理
last-verified: 2026-10-23
sources:
  - packages/pixishelf/server/routers/artwork-dedup.ts
  - packages/pixishelf/services/artwork-dedup-service.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-check-page.tsx
---

# 同艺术家作品重复检测

本文描述开发分支的检测能力，不表示生产部署或完整去重流程已验收；阶段证据见[第二阶段记录](../records/artwork-deduplication-phase-2-2026-10-23.md)。审核、隔离、恢复与永久清理仍按[后续设计](../design/artwork-deduplication.md)实施。

艺术家页“检查重复”进入管理页面。用户主动开始后冻结该艺术家当前有效归属的活动作品；后来新增作品不加入本次范围。内容相同指全部登记原文件的大小与 SHA-256 排序多重集合相等，忽略文件名和顺序，但保留重复次数。动画组合比较其全部登记原文件，不做相似度、部分重叠或跨艺术家检测。

检测先访问文件属性，仅对数量和可靠大小清单相同的候选读取内容。有效文件哈希持久化，普通检查可复用；完整检查对候选绕过内容缓存。缺失、不可读、零字节或读取时变化的媒体不能成为完整结果。正常零重复、局部未完成与整次环境故障分别显示，不把根掉线当成空图库。

## 控制与账户

同一艺术家只允许一个活动检测，暂停也占用该资格。页面支持暂停、继续、取消和失败重试；离开页面不会终止任务。重试保持原 run 身份与冻结范围，推进执行版本；重新检查已完成范围则创建新 run。通用任务中心只链接领域入口，不能绕过状态限制、提升优先级或直接重放。

调用需要有效 Session 与 expectedUserId 一致。检测结果属于实例管理事实，发起者字段用于审计，不是账户独占权限；检测 DTO 不暴露其他账户的私人整理记录，也不返回绝对媒体路径、根身份、原始哈希或执行租约。

## 执行与恢复

检测复用 BACKGROUND_WRITER，保持现有三条通道。读取由单个受控子进程执行，有界分页与并发；默认预算、调度让行和指标口径见[实施契约](../design/artwork-deduplication/phase-2-contracts.md)。App 不在请求内遍历图库或计算哈希。

文件缓存、作品完整指纹和最终分组分别检查源代次、成员证据及执行围栏；最终组发布与任务完成在同一事务。根身份和有效归档子目录映射随运行持久绑定，续跑不能自动接受新的映射。未知旧 reader 是否退出时保留占用；租约超时或发送 kill 不能代替实际退出证明。需要人工恢复时使用[停写恢复手册](../operations/runbooks/media-content-recovery.md#去重读取进程遗留占用)，不直接删占用行。

检测不移动或删除原文件；它的结果也不是清理授权。当前页面、数据与执行器定向测试和独立审查分别登记在阶段记录中；浏览器交互留到最终统一验收，规模测量明确区分数据库登记数、实际文件数和内容读取字节。
