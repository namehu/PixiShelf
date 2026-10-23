---
status: verification-record
date: 2026-10-23
scope: 归档下载独立通道；隔离 PostgreSQL、真实文件系统及非浏览器测试
current: ../features/archive-lifecycle.md
---

# 归档下载通道实施验证

本记录只描述本次开发工作区的验证，未部署到生产。当前规则见[归档生命周期](../features/archive-lifecycle.md)，决策见 [ADR-0008](../adr/0008-separate-archive-download-and-publication.md)。

## 环境与迁移

使用专门新建的 PostgreSQL 容器和空测试库，无业务数据挂载。队列套件显式读取 `QUEUE_KERNEL_TEST_DATABASE_URL`，应用已有的 opt-in 套件另使用 `PIXISHELF_TEST_DATABASE_URL`，两者均指向本次隔离库，不回退使用应用数据库。对这个隔离库执行 `db:deploy`，全部 101 条 migration 完成；未对业务数据库执行迁移或 `db:push`。

新增 enum 与结构分为 `20261023000000_archive_download_lane_enum`、`20261023001000_archive_download_lane` 两条迁移。第一次隔离试跑暴露了 PostgreSQL 同事务使用新 enum 值的限制，拆分后重新部署通过。迁移仅增加结构和阶段关联元数据，不搬移媒体。Prisma generate 完成；依赖恢复使用 frozen lockfile，锁文件未变化。

## 已验证的行为

- `download-lane.postgres.test.ts`：15 项通过。真实慢下载流未结束时，三个 `CentralDispatcher` 中的轻量 writer/resolver 执行器实际完成；另一下载消费者不能占用同 lane；A 等待发布时 B 可以下载。
- 同一真实数据库套件覆盖封存/后继/当前指针/前驱终态的原子回滚与重放，暂停或取消竞争，检查点跨代核验复制，真实旧下载流迟到至最终文件落盘但 checkpoint 被 fence 拒绝，发布 rename 后崩溃恢复。
- 发布恢复用例禁止媒体全量校验与复制函数，网络调用也必须为零。旧 v1/v2 保留冻结标签、未知来源、非零历史 attempt 和 RETRY_WAIT 的 availableAt。已知 legacy final 可清理再重试，未知身份目录拒绝清理并保留证据；已验证 legacy final 在封存前暂停/取消后仍可清理及重试。
- 独立 `download-lane-recovery.postgres.test.ts`：3 项通过；在另一空库验证 manifest 尚未完成时不能提前宣告 drain，以及 cleanup 对已确认代和失联旧代的隔离。使用真实文件系统和有控制的阻塞点，未把 lease 过期当作 I/O 终止。
- `archive-logical-jobs.postgres.test.ts`：2 项通过，验证归档按业务创建日期/ID 聚合，普通任务与归档混合分页、跨日交接和翻页交接不会重复或漏项；快照与旧执行详情跟随 current；dashboard 不把 HANDOFF 计为整体完成，SSE 不发送旧阶段成功通知。
- executor、maintenance、storage、扫描路径和发现相关聚焦测试通过。新增长 ASCII / Unicode 源文件名验证最终文件名不超过 255 字节。
- 应用 hook 测试验证连接 SSE 时详情跟随稳定归档身份、历史行读取当前执行进度，以及后继执行进入视口后断线仍保留快速轮询。发布阶段的暂停/失败任务请求切换展示画质会被领域控制拒绝，保持封存事实。

## 最终检查与补跑

最终非浏览器检查另使用独立空库，101 条 migration、Prisma validate 和 Worker 依赖链 typecheck 通过；主应用完整 typecheck 通过，lint 无警告或错误。

- Worker 依赖链五包共 1521 项已分批验证通过：DB 224、契约 140、runtime 108、executors 938、Worker 111。runtime 首次暴露旧单一 IMPORT cleanup gate 断言，改为三种归档类型后 108/108 通过；其余环境补跑见下一项。
- executors 全套 938 项已覆盖通过。首次运行 925 项通过、13 项扫描 PostgreSQL 用例因临时容器中断而失败；重建隔离库后完整扫描 PostgreSQL 套件 60/60 通过，不能将其描述为首次全量一遍通过。
- 主应用首次全套共 453 个文件，3020 项通过、119 项失败、109 项跳过。3 个失败来自旧双通道文案或旧搜索任务版本断言，修正后聚焦通过；其余失败发生在临时数据库失联后。主代理在重建隔离库中补跑所有主应用 PostgreSQL 套件和受影响控制/UI 文件，补跑另暴露 intake 并发 fixture 仍按旧 IMPORT lane 领取，以及两个标题搜索 PG 断言仍使用旧版本号；现已改为真实 DOWNLOAD → PUBLISH 执行并保留三轮 transfer/checkpoint/publication 与 100 项入队断言，标题搜索断言对齐现有 v5。另对 opt-in 归档重试测试改用新 DOWNLOAD@1 预期，并保留旧任务不可变、未知来源、优先级、预算及已完成检查点的强断言。3 个旧单元断言的对应文件补跑通过（UI 21/21、uploader 27/27）；封存画质控制文件 22/22 通过。

- 稳定 tmpfs 隔离库中，两个受影响完整 PG 文件补跑 37/37 通过：`intake-batch.postgres.test.ts` 19 项、`archive-discovery-delete.postgres.test.ts` 18 项。并发 fixture 保留真实 AUTO/SYSTEM priority 900，通过生产 registry 执行下载与发布；三轮传输、checkpoint、publication 阶段各完成 100 项入队。删除 fixture 在创建时确定 job type，未绕过类型不可变约束。

- 主应用全部 PostgreSQL 用例共 225 项已逐项验证通过。启用两套 opt-in 变量后的统一运行先得到 210 项通过、10 项 fixture 失败、5 项因 init 专用库名保护而跳过；上述 37 项完整文件补跑覆盖并解决 10 项失败，初始化套件另在专用 `init_admin_test` 空库 5/5 通过。此结果由完整运行和聚焦补跑共同构成，不是单次全套零失败。
- 文档检查通过（177 个 Markdown 文件）；主代理用已安装 Chrome 复核图检查通过（28 个图源、23 处内嵌 Mermaid），未启动业务页面。最终 `pnpm --filter @pixishelf/worker... build` 与主应用 `pnpm build` 均以 exit 0 完成。主应用构建使用提升权限，Next.js 16.1.1/Turbopack 编译、TypeScript 检查和路由生成通过。

临时容器在全套测试中途消失，原容器采用自动删除模式；后续补跑明确出现 PostgreSQL `No space left on device`，Docker 虚拟磁盘占用达到 100%。主代理仅处理本次自建容器，并改用 tmpfs 隔离库继续验证，未清理既有 Docker 数据。首次未提供 `PIXISHELF_TEST_DATABASE_URL` 而跳过的应用 PG 套件也纳入串行补跑。没有把连接或磁盘故障当作业务回归，也没有用跳过数据库测试替代重跑。所有测试数据库均为本次新建且无业务数据的隔离库；生产数据库和媒体未改动。

## 边界与交付检查

使用测试 Provider 和本地 PNG 数据，未访问真实来源站点；轻量调度执行器验证队列重叠，不代表高负载资源隔离或远端吞吐结果。未做浏览器验证、浏览器业务回归或生产发布。用户将执行浏览器验收。

全量 lint、测试与最终构建由主代理在实现和独立审查修复收口后组织，失败与补跑事实如上。上线仍需遵循[部署门禁](../operations/deployment.md)：停止并确认旧 Worker 已退出，同点备份后显式部署迁移，再核验三 lane 和完整 capability；失联代 orphan 仅在确认全部写进程停止的恢复窗口处理。
