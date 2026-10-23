---
status: historical
scope: 同艺术家作品去重第一阶段的代码收口与隔离验证证据
date: 2026-10-23
---

# 去重第一阶段验证记录

本记录只描述本次 worktree 的隔离验证。**第一阶段代码与独立审查门槛通过**，代码提交为 `79b19167b4df98beb733bf9020c5e6e07c7be6bf`。用户在浏览器工具受阻后明确允许先进入第二阶段，全部浏览器回归留到最终统一验收；D1-B01 仍为未完成，详见[实际浏览器记录](./artwork-deduplication-phase-1-browser-2026-10-23.md)。总计划见[设计](../design/artwork-deduplication.md)，文档阶段证据见[首阶段记录](./artwork-deduplication-2026-10-23.md)。

## 基线与环境

- 工作分支：`codex/artwork-deduplication`。
- 开工快照：`aa26274677aab611bd4b9bbe2970cfdf150cd966`，包含开工时未提交的下载通道改造；文档阶段提交：`a4f4a031`。
- 开发目录：独立受管 worktree；原目录与原暂存区保留。以下结果对应第一阶段代码检查点；精确代码提交由随后浏览器记录补记。
- PostgreSQL 15 容器 `pixishelf-dedup-postgres`，仅绑定 `127.0.0.1:55432`。数据、App、Executor、内容聚合、浏览器各用独立数据库；没有连接真实图库数据库。
- 合成媒体根为 `/tmp/pixishelf-dedup-fixtures`；各文件/数据库测试另外使用自清理临时目录。浏览器 App 使用 `5440`，专用 Worker `dedup-browser-phase1` 的健康端口为 `55411`，ImgProxy 为 `55431`。原服务端口未改。
- `20261023002000_media_content_fingerprints` 与 `20261023003000_media_content_recovery_grants` 已正式 deploy 至上述五个隔离库，现有迁移共 103 份；迁移不扫描媒体。非空旧库的专项约束测试由数据验收证据单独记录，不能用 deploy 成功替代。
- 恢复依据是可销毁合成数据和正式迁移链；不以真实图库做破坏性测试。

## 已获得的证据

| 范围                    | 已执行结果                                                                                           | 能证明的范围与限制                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内容摘要与文件句柄      | 8 项测试通过                                                                                         | 顺序无关、保留重复次数、全部登记原件、整数精度、路径与句柄身份、零字节/取消/读中变化；不是硬件故障演练                                                                                                                                       |
| 缓存与完整作品发布      | 真实 PostgreSQL + 临时文件 3 项通过                                                                  | 500 个原文件冷读 500；热读内容字节 0、命中 500、缓存写入 0；改一张仅重读一张；强制读取、成员变化及陈旧源提交被拒绝                                                                                                                           |
| 源状态和数据库约束      | DB 全量曾为 46 文件 / 237 项通过；新增接口定向 58 项通过                                             | 包括空/非空迁移和启动门禁；迁移 102→103 空/非空升级专项 4/4 通过，逐表验证旧媒体、任务、六张内容证据表不变；新 grant CHECK、活动唯一键、job FK 有效，随机 schema 回滚自清理                                                                  |
| Executor 集成           | 定向 175 项通过；归档与 guard PostgreSQL 25 项通过；扫描 PostgreSQL 60 项、替换 PostgreSQL 15 项通过 | 已封存归档 rename 后事务失败能受限交接；其他领域旧 attempt 的显式恢复见后续收尾与复审证据                                                                                                                                                    |
| Executor 取消与恢复收尾 | 单元 133 项、专用 PostgreSQL 12 项通过，Executor typecheck 通过                                      | 维护 6 项含 TRASH/RESTORE/PURGE 离线授权断点；领域恢复 6 项含 pending/migration/video 主动取消。与此前范围有重叠，不累加总数。后续独立审查通过，runtime 取消回收及恢复授权另有真实 PostgreSQL 验证                                           |
| App 上传/替换           | 28 文件 / 218 项定向测试、真实 PostgreSQL 9 项通过；App typecheck、lint 通过                         | 详情及有重叠的后续边界复测见 [App 交接](./artwork-deduplication-phase-1-app-handoff-2026-10-23.md)；同步删除另有后续证据；不代表全量 App 或阶段验收通过                                                                                      |
| App 同步删除与恢复隔离  | 真实 PostgreSQL 15 项、删除相关 106 项分批通过；新增媒体 HTTP 4 项通过                               | 三入口原范围重试、响应丢失、manifest/gate 窗口、新占用停止及隐藏路径保护；日志 `/tmp/dedup-deletion-*`。限定 lint 通过；当时 App tsc 的归档控制类型错误已由控制组修复，之后 App tsc 通过。旧 55439 专库 integration 仅更新调用与清理，未执行 |
| 离线恢复 CLI            | 5 项通过                                                                                             | 必须显式停写确认、快照文件独占创建与受限权限、大小及摘要校验、拒绝坏输入；数据库授权与 Worker 消费由另组测试证明                                                                                                                             |
| 类型与文档              | 最新 DB、Executor、App、runtime、Worker typecheck 均通过；受影响 App lint 通过                       | 只核对本阶段受影响包；Worker 单包构建用于浏览器运行，未执行全量 App 构建                                                                                                                                                                     |

缓存计数来自可计数 reader 和真实数据库，500 项不是最终要求的 50 万媒体性能验证。文件元数据读取仍会发生；“热读内容字节 0”不等于零 I/O。

## 审查前发现与处理

1. 目录内子路径写入必须推进祖先 generation，否则递归扫描可能提交旧清单；已补祖先失效与兄弟路径缓存不误失效测试。
2. 首次上传尚无 Image，必须保留逐路径声明直到登记事务完成；新增目录声明不能只依赖媒体行 gate。
3. 原 attempt 的持久声明会阻挡崩溃后重试。已封存归档有专用“只剩 DML”证明；其他 Worker 文件业务使用显式停写后的单次恢复授权，不按租约超时自动接管。
4. 上传响应丢失、刷新及错误选文件需要客户端持久凭据/逐块本机摘要；服务端仍以 checkpoint 与 CAS 为准，不能根据磁盘长度接管。
5. 同步删除失败不能丢失原选择和授权。已实现精确删除意图与按原范围重试，不能修改文案后把永久阻塞当作恢复完成。

## 独立审查

第一轮 Executor 审查由 GPT-6.1 Sol / xhigh 以独立上下文完成，结论不通过，发现 4 项 P1 与 1 项 P2。涉及迁移终态与声明事务、归档清理对恢复证据的保护、发布 rename 前的崩溃入口及多 revision 声明范围；完整触发、行号、最小修复与缺失测试见[审查记录](./artwork-deduplication-phase-1-executor-review-2026-10-23.md)。已由 Astra 实施者集中修复，Sol / xhigh 独立窄复审确认全部关闭。

运行手册已按复审后的实现核对，见[原媒体写入异常恢复](../operations/runbooks/media-content-recovery.md)。这不代表生产部署或恢复已验收。

## 本轮修复证据

- Executor 首轮五项修复新增 17 个定向用例通过（7 单元/临时文件、10 PostgreSQL）及类型检查通过，见[修复记录](./artwork-deduplication-phase-1-executor-fixes-2026-10-23.md)。第二轮补齐超过 100 个 revision 的完整分页读取与流式定长摘要，新增 7 个定向用例通过；最终窄复审确认五项问题均关闭，并独立验证 100/101/200 项及末项变化。
- App 独立审查复现损坏图片上传后的恢复阻断、过期章节删除预览扩大路径两项 P1，见[审查记录](./artwork-deduplication-phase-1-app-review-2026-10-23.md)。修复后 PostgreSQL 30 项、单元/接口 62 项及 App tsc、限定 lint 通过；测试范围含旧案例，不与此前数字相加。证据见 [App 交接](./artwork-deduplication-phase-1-app-handoff-2026-10-23.md)。原 reviewer 窄复审通过，另外实际执行 2 条独立修复复现、6 条相关 PostgreSQL 回归、2 条接口字段传递测试，原两项 P1 均关闭；未重复全局检查。
- DB/control 独立审查复现归档控制锁反转及 grant 重放无法取回原授权两项 P2，见[审查记录](./artwork-deduplication-phase-1-data-control-review-2026-10-23.md)。修复前已通过 runtime PostgreSQL 11、DB resume PostgreSQL 4、CLI 单元 6 与真实命令链路 1、App 控制单元 73 与归档 PostgreSQL 8；上述旧证据不与新增用例累加。两项修复后并发 PostgreSQL 8 项、授权重放 PostgreSQL 14 项、真实 CLI 1 项、App 单元 32 项及 App/DB 类型检查通过；原 reviewer 独立重跑前三组通过，两项 P2 均关闭。详见[修复证据](./artwork-deduplication-phase-1-data-control-fixes-2026-10-23.md)。

## 收口状态

- 迁移 103 新增专项测试已通过最后一次窄复审，见[DB/control 审查](./artwork-deduplication-phase-1-data-control-review-2026-10-23.md)。4/4 执行日志：`/tmp/pixishelf-migration103-20261023.log`；未重复完整迁移链。
- GPT-6.1 Sol / high 完成合成账号、艺术家和空作品创建。IAB 文件选择工具挂起断连，Chrome 恢复尝试因扩展缺少本地文件权限被拒绝，实际上传 0 张。已停止浏览器操作；D1-B01 留待最终统一补验，不能据此判断产品上传失败。
- 文档链接已检查，第一阶段代码已单独提交。图源未变，复用已通过的 33 份独立源、23 份内嵌图语法及源哈希检查，不重复渲染。

三个领域的独立代码审查均已通过，App/DB/Executor/runtime/Worker 相关静态检查通过。浏览器实际动作、尺寸和未覆盖项见专门记录，没有持久截图文件，未编造路径。最终全量检查和 50 万媒体性能验证仍属于后续交付。
