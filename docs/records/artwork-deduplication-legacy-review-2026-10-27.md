---
status: historical
scope: v0.54.14 初始版本作品从检查到删除复核的兼容修复与验证
last-verified: 2026-10-27
sources:
  - packages/pixishelf-db/prisma/migrations/20261027000300_artwork_dedup_legacy_review/migration.sql
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - packages/pixishelf-db/src/artwork-dedup-operation.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-review.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/direct-delete.postgres.test.ts
---

# 初始版本去重审核修复

## 现场与范围

2026-10-27 生产只读核验：run `6037a45e-46a9-4285-a883-efa90973f0c9` 的 53 部作品全部完成，生成两组包含关系，但审核函数返回 `eligible=false`。四部作品仍处于活动状态，媒体版本、内容指纹、成员摘要和艺术家归属均匹配；源记录缺失、快照版本及代次均为 0。v0.54.13 修正了检查分组，却遗漏审核和维护下游的相同语义差异。

本次统一审核 SQL 函数、维护清单读取及操作快照复核。最后一项覆盖预览完成、授权、领取保护、首次删除及最终提交；现有锁顺序、写入占用、内容证据、范围签名和逐文件复核保持不变。只有缺失的当前源记录可按 0 解释，不对缺失指纹或非零历史快照补默认值。

视觉与分批视觉、底层内容快照已使用相同初始值；文件级源身份、根、目录代次和删除回执不是作品初始版本，不放宽这些检查。迁移只替换函数，不修改业务数据或既有授权。

## 验证

- 本机 Windows 临时 PostgreSQL 15，独立回环端口与临时数据目录，不连接生产；完整迁移链应用成功。
- 检测、审核、预览完整性、领取保护及归属最终提交五个 PostgreSQL 套件共 60 项通过，其中检测 18 项、审核 26 项。包含四类关系的审核／冻结、零版本预览完成，以及版本变化、写入占用、指纹缺失、作品删除、归属变化等负向用例。
- 升级回归先恢复旧函数，验证相同数据被拒；执行新迁移后通过，再执行一次仍通过。历史 item、源记录缺失状态与审核选择均未改变，测试事务最终回滚。
- Worker 依赖链类型检查通过。本机完整删除测试在读取进程阶段失败，未作为通过证据；真实原件删除依赖 Linux 环境。
- 主应用 lint、生产构建及文档／图示检查通过；主应用全量单测以两个并发进程运行，3292 项通过、326 项跳过，29 项失败集中在未修改的文件删除／替换恢复套件，Windows 目录 `fsync` 返回 `EPERM`。这不计作全量测试通过，仍须核对同提交 Linux CI。
- CI Worker 和镜像发布 validate 新增专用连接变量及明确测试命令，运行上述数据库套件和 EXACT／CONTAINS 初始版本全链路用例。工作流实际结论以对应提交的 Actions 为准，不能把已配置门禁视为已通过。

## 发布与恢复依据

目标 patch 为 v0.54.14，生产部署与复测由用户执行；本次没有直接修改生产数据库或文件。迁移顺序、刷新已有结果和回退限制见[去重运维](../operations/runbooks/artwork-deduplication.md)。按[备份基线](../operations/backup-and-recovery.md)保留升级前检查点及配套版本；本次本地测试不是生产备份恢复演练。
