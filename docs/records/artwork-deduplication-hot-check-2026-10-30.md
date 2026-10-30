---
status: historical
scope: 热检查前置核对和无内容读取执行片的调度优化、同样本验收
last-verified: 2026-10-30
sources:
  - packages/pixishelf-job-executors/src/artwork-dedup/pipeline.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-db/src/artwork-dedup.ts
  - packages/pixishelf-db/src/artwork-dedup-hot-batch.ts
---

# 热检查提速：实施与验收记录

## 开工基线与批准方案

用户批准 2026-10-30 的最小方案。本轮复用独立 worktree `dedup-visual-search-v2/PixiShelf`，新分支 `codex/dedup-hot-check-batching`；代码基线 `a46438f613a95a63fe2e348b61a2fbf336d07cc7`，开工时 main 同版本且工作区干净。保留主目录、暂存区和其它分支。不自动合并、推送或发布。

生产同一艺术家 2812 的第二轮 `266d0295-65bf-4bc6-9d00-039d8e34c219`：7,905 原件、5,624 可比静图、2,281 未核对媒体；耗时 249.127 秒，1,323 次事务、15,769 次数据库 API 调用、累计事务 wall 170.652 秒。索引前准备约 229.298 秒，进入 INDEX 时已完成 1,217 次事务，固定冷却约 48.184 秒；索引构建、节点访问、候选、精比、原图读取与解码均为零。API 调用不等于 SQL 条数，事务 wall 包括往返与等待，不能与阶段时间直接相加。

与首轮输入摘要、检索版本相同；这不是首次解码冷检，也不构成受控 NAS 基准。原始只读诊断证据保留于本线程 visualizations 的 `dedup-production-two-runs-2026-10-30.{json,md,sql}`。

## 本轮实施边界

1. 每批最多 100 个原件。普通资料读取和文件属性检查在写事务外；已绑定、未变化且缓存有效的批次跳过重复目录绑定。一次事务统一核对执行权、有效作品归属、成员、来源、目录及写入状态，原子保存媒体结果、游标和计数；同事务内部不重复查询已核对事实，不跨事务保留执行许可。
2. 新增、变化、缺缓存走既有重算；输入或执行权在提交时变化则拒绝该批。最终发布、实际删除前完整核验不变，共享基础校验 API 的其它调用者不变。
3. 保留约 10 秒让行。没有内容读取或解码的执行片立即重新排队；有内容读取/解码的片保留冷却。失败退避、人工暂停和处理上限等待不变。

不改变动图、相似算法、删除系统和 1 万原件上限；不新增数据库表、服务或缓存层，保留现有检查点和旧任务协议。复杂批处理/续跑由 Astra high 实施，专项与独立审查由 Sol 6.1 xhigh，桌面验证由 Sol 6.1 medium。

## 验收约定与恢复依据

先保存同一份隔离样本的优化前基线，再测优化后：未变化热检结果一致、无内容读取/解码/候选遍历，每个成功热批次一次提交，无固定冷却。专项覆盖修改一张、新增、缺缓存、暂停、取消/失执行权、目录变化、事务回滚和 Worker 重启续跑。不重复全量 lint/test/build。

仅使用本任务专属隔离数据库、临时媒体和独立端口；从保留的合成样本复制，未连接开发库或生产库做写入。无 schema 迁移，代码由 Git 基线恢复；保留样本和基准结果以便复测，收尾只停止本轮自建进程。

## 同样本实测

复用 2026-10-29 留存的 2,000 原件、50 部作品样本，复制到本任务媒体目录。优化前代码来自上述基线的 `git archive`，先预热一次再保存数据库备份；前后两次使用该备份的独立克隆和同一份物理文件。隔离 PostgreSQL 端口为 `55432`，仅使用新建的 `dedup_hot_*_20261030` 数据库。正式测量期间没有本轮 App、Worker 或浏览器争用资源。两版各执行一次完整检测，不是单独测视觉内核。

| 指标 | 优化前 | 优化后 | 变化 |
| --- | ---: | ---: | ---: |
| 总耗时，包含调度等待 | 32.769 秒 | 25.196 秒 | −23.11% |
| 到首个 INDEX 检查点 | 30.078 秒 | 22.168 秒 | −26.30% |
| 执行器提交事务调用 | 814 | 666 | −18.18% |
| 实际 SQL，含事务控制和队列结算 | 15,481 | 12,876 | −16.83% |
| 持久日志的数据库 API 调用 | 8,540 | 7,169 | −16.05% |
| 持久冷却计时 | 6,008 毫秒 | 7 毫秒 | 无固定 3 秒冷却 |

优化后两个让行点的 `availableAt` 都已可执行。7 毫秒是检查点记录到可调度时刻的实际结算间隔，没有把它抹成零；正常排队仍存在。事务调用口径与持久日志的 817→669 次不同，后者还包含读取进程清理；SQL `BEGIN` 为 825→677 次，还覆盖队列和结算。数据库 API 调用不等于 SQL，事务 wall 也不是磁盘时间。

两次均得到 25 个完全相同组，结果摘要一致；输入与检索版本一致。2,000 次文件属性检查和 2,000 次 SHA 缓存命中；原图读取字节、解码、内容哈希重算、索引构建、节点访问和候选精比均为零。专项测试另行验证每个成功热批次仅一次提交；这不表示整个作品或整个任务只有一次事务。

剩余开销最大的已测桶为 `MATCH`：事务 wall 14.451→14.203 秒，SQL 事件耗时 13.467→13.309 秒；原件核对桶事务 wall 6.447→4.645 秒。这些是按最近检查点归类的调用耗时，跨阶段首个读取可能归到前阶段，不能当成精确阶段总时长或与总耗时相加。本轮到此收口，不扩成关系匹配优化。

原始口径、可复现步骤、源码摘要和结构化指标见[测量说明](evidence/hot-check-2026-10-30/measurement-notes.md)、[测量结果](evidence/hot-check-2026-10-30/measurement.json)与[源码摘要](evidence/hot-check-2026-10-30/source-hashes.json)。这是本机顺序单次测量，文件系统缓存已热，不能据此承诺生产 NAS 的 249 秒将降到多少秒。

## 专项验证

- 隔离 PostgreSQL 热路径专项 13 项通过：100 个边界、一次提交、零固定冷却、暂停后新执行器续跑、修改／新增／缺缓存／FULL 回退、取消、失租约、成员与来源／目录写入变化、事务回滚。
- 旧协议与字节额度回归 5 项通过；遥测 10 项通过，包含真实前序冷却和未知计时。
- DB、executor 两包类型检查通过；未运行主应用全量 lint/test/build。
- 两次 PostgreSQL 专项的原始结果在本线程工具执行记录中，未单独留存原始输出；[命令与结果摘要](evidence/hot-check-2026-10-30/core-validation.md)明确此限制。最终[遥测原始输出](evidence/hot-check-2026-10-30/core-telemetry.txt)已留存。

## 桌面与真实 Worker 续跑

Sol 6.1 / medium 在独立 App `http://127.0.0.1:5500`、桌面 1200 × 794、`entry=direct` 入口启动一次包含疑似版本的快速检查。Run 为 `88591024-95b4-41e2-957d-f7ce2b2753b4`，Job 为 `6396e29a-6112-4f42-acb8-bf19def6a64e`。实际看到暂停、刷新仍暂停、继续后进入作品关系检查，以及同 run 最终 25 组、疑似版本检查完成；任务详情显示完成，未看到总体 99%。[独立 UI 观察和 6 张截图](evidence/hot-check-2026-10-30/browser/browser-acceptance.md)保留实际覆盖范围。

在暂停后继续、关系检查游标从 18 前进至 22 的已提交边界，监控向本轮 Worker PID 42357 发送 `SIGKILL`。1.5 秒后确认旧 Worker 和读取子进程 45250 均退出，再启动 PID 45262；等待既有租约自然过期，没有直接改数据库状态。新 Worker 从同一游标 22 接续、同 run 和 job 完成。最终 `statMedia / cacheHitMedia / media` 都恰好为 2,000，哈希重算和读取为零，25 组与基准结果一致，无 changed/failed，读取令牌清空且租约为零。详见[进程与检查点证据](evidence/hot-check-2026-10-30/worker-lifecycle.json)。

重启发生在原件提交完毕后的 MATCH 阶段，不等于真实进程在原件读取中或热提交中被杀的验证；热批次中断、回滚和执行权丢失由前述 PostgreSQL 专项覆盖。暂停页没有原件累计计数，UI 不替代数据库计数证据。任务中心加载瞬间执行槽旧阶段与已完成列表短暂不同步，进入详情时一致为已完成；未捕捉短暂的重启等待画面，未为截图重新开任务。本轮没有重新验收删除或手机。

## 收口与未覆盖项

已停止本轮 App、Worker 和监控，`5500 / 55840` 不再监听；保留隔离 PostgreSQL `55432`、样本、备份和证据，未停止用户服务。[关闭进程记录](evidence/hot-check-2026-10-30/process-cleanup.json)包含精确 PID。后续仅需复看隔离环境时，可使用任务目录 `/private/tmp/pixishelf-dedup-hot-20261030` 中留存的 `start-app.sh`、`start-worker.sh`；账号与连接配置不入库。重复测量须按测量说明新建备份克隆，不把已有完成的运行冒充原始检查点。

`pnpm docs:check` 通过（341 个 Markdown）；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过（34 个独立图源、23 个内嵌图）；`git diff --check` 通过。两张更新后的 SVG 已用本机 Chrome 生成并目视核对可读性；默认 Chromium 缺失，未将该首次渲染失败当作通过。主应用路径大小写扫描无匹配。生产 NAS 性能、首次内容解码、其它规模及负载未在本轮重测。动画、算法、删除和上限不变，无数据库迁移、检查点或缓存版本升级。交付止于独立分支提交，暂停，不合并、推送或发布。

## 独立审查

2026-10-30，由未参与实现的 GPT-6.1 Sol / xhigh 以新上下文只读审查。未发现 P0/P1/P2，无阻塞发现。核对热批次一次提交、执行权与目录／来源／成员边界、v1/v8 及 FULL 行为、游标和计数原子性、暂停／取消／失租约／回滚以及冷却与计时。成员完整性沿用既有 revision 触发器约束，不重复增加整部 COUNT。审查者只实际运行 `git diff --check`，没有独立重跑测试；测试结果由实施与隔离验收各自提供。

已审代码 SHA-256：

```text
326164d99eafb63e3b8f028e107e1c32a94532c1274a99f88ff8aa2a8407e586  packages/pixishelf-db/src/artwork-dedup-hot-batch.ts
0cb9bb05a3140d905dc119142243f57fe1418392220c076a8884fe458266ffe6  packages/pixishelf-db/src/index.ts
3cd613f229afe1e348139c91a4fc21169d0c6f9e2ae8a0351229ac01637aecc5  packages/pixishelf-job-executors/src/artwork-dedup/pipeline.ts
b700273f4228585c9e95b5dd23b2114f28af6b450fbc4e1bcea5bb3fd3956f8a  packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
ff8e5bd2a4da28e8a0372c178407782aa47ddb1c3193ec894366d42ede6a6421  packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor.postgres.test.ts
111409b1cbfa03cc91e7fac3b9aa9ba4fe83a86ffeacf0a51773e14feb7db02b  packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor-lifecycle-telemetry.test.ts
```

末次差异复审仅涉及两个旧遥测测试：没有前序调度记录时冷却应为 `null`，给出同时间 `SCHEDULER` 记录后才验证为 `0`。另有真实 3,000ms 前序冷却进入视觉阶段仍保留的用例。未通过默认归零掩盖缺失测量；功能文件摘要不变，末次复审仍无阻塞。

最终摘要核对发现 PostgreSQL 测试文件比初次审查多了事务包装的泛型签名修正。审查者将该签名在内存还原后摘要与原已审文件精确相等，确认没有其它差异；当前文件也与已测 after 快照逐字一致。该类型修正补审通过，无运行时行为变化，上表使用最终摘要。

测量驱动与 5 个留存辅助脚本另行只读审查。发现构建辅助脚本允许复用输出 label、可能先覆盖 bundle 再失败的问题，已改为构建前拒绝已有目录并复审通过；不影响本轮使用全新输出的测量。辅助脚本语法检查通过，旧／新源码 107／108 项摘要全部吻合；原始 SQL 与精简证据汇总、结果摘要均核对一致。没有为了复审重复基准或构建。
