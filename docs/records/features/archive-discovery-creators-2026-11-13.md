---
status: historical
scope: 上传者与标题关键词来源统一扫描绑定艺术家的本地验证
last-verified: 2026-11-13
sources:
  - packages/pixishelf-job-executors/src/archive/uploader-scan-executor.ts
  - packages/pixishelf/services/archive-uploader/archive-uploader-service.ts
  - packages/pixishelf/services/archive-uploader/discovery-deferred-service.ts
  - packages/pixishelf/services/archive-uploader/title-rule-service.ts
---

# 发现来源固定艺术家统一绑定验证

## 日期、版本与环境

2026-11-13 本次固定艺术家绑定统一改动的本地验证，未执行生产部署。环境为本机 macOS、Node 20、pnpm，数据库为一次性 PostgreSQL 15 Alpine 容器；独立空库使用现有 142 项正式迁移初始化，未连接生产库或挂载媒体目录。

## 变更与覆盖

当前规则由[发现来源的艺术家绑定](../../features/archive-discovery.md#发现来源的艺术家绑定)维护。本次将标题来源接入上传者已有的扫描首次绑定路径，删除直接入箱与暂缓入箱时读取当前来源配置的特殊行为；规则应用和人工复核不再消耗首次扫描绑定机会。

隔离回归覆盖：

- 两类来源在扫描首次接纳时使用冻结艺术家配置；无本地作品保存待生效记录，已有作品立即追加。
- 空配置、全局忽略、重复扫描、跨来源追加及手动移除抑制。
- 标题扫描 v4/v5 的机器接纳、过滤、人工接纳和人工排除；绑定以最终接纳结果为准。
- 规则应用与人工复核不会提前写入首次扫描接纳标记。
- 直接入箱、幂等重放、容量拒绝和暂缓入箱保留扫描时的绑定，不追加后来修改的来源配置。

## 执行与结果

| 检查                               | 结果                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 扫描 Executor 聚焦回归             | 25 项单元测试、12 项 PostgreSQL 测试通过                                                                          |
| 标题规则与暂缓入箱 PostgreSQL 回归 | 35 项通过；新增规则应用断言另行聚焦复跑通过                                                                       |
| Worker 依赖链 typecheck / build    | 通过                                                                                                              |
| Worker 依赖链单元测试              | 首轮 5 个 Executor 文件因沙箱子进程和端口限制失败；构建后在沙箱外复跑 55 项全部通过；Worker 包单独运行 121 项通过 |
| 主应用 lint / typecheck / build    | 通过                                                                                                              |
| 独立子 agent 代码审查              | 通过；未发现阻止提交或构建 tag 的问题。审查核对现有验证日志，未重复运行全量测试                                   |
| 主应用全量 test                    | 首轮 3,823 项通过、6 项失败、404 项跳过；沙箱外执行 `TZ=UTC pnpm test` 后 3,829 项通过、404 项跳过，全部失败消除  |
| 文档检查与图示检查                 | 本地链接检查通过；使用已安装 Chrome 校验 34 张图源及 23 段内嵌 Mermaid 通过                                       |

未设置测试库的全量单元命令按既有约定跳过 PostgreSQL 套件；本次仅对上表列出的相关数据库套件配置隔离库，不将跳过项计作通过。默认 Playwright Chromium 未安装，图示检查改用 `WEBP_BROWSER_CHANNEL=chrome`。

## 发布、历史与恢复边界

本次没有 Schema、迁移、任务 payload 或版本变更。App 与 Worker 需要一起更新，才能同时启用扫描绑定并去除旧的标题入箱补绑行为。本记录不代表生产验收。

已有 `firstMatchedAt` 的历史候选不会因重扫或入箱自动补绑；历史缺失关系须从来源结果显式批量绑定。没有执行生产补绑、清理或重算。

回退 App/Worker 不会删除已经建立的待生效或正式关系；需要撤销时使用现有绑定管理入口，不清空首次标记或批量删除关系。生产发布前的检查点与恢复依据遵循[备份与恢复基线](../../operations/backup-and-recovery.md)。隔离测试容器及合成数据在验证结束后删除，不承担生产恢复职责。
