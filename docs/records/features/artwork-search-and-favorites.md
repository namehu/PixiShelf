---
status: historical
scope: 我的喜欢与多语言标签搜索的本地实现、隔离数据库和浏览器验证
date: 2026-10-22
baseline: f064bd4a
sources:
  - packages/pixishelf/tests/integration/artwork-favorites.postgres.test.ts
  - packages/pixishelf/lib/__tests__/artwork-like-cache.test.ts
  - packages/pixishelf/app/artworks/_components/__tests__/search-box.test.tsx
  - docs/features/artwork-search-and-favorites.md
---

# 作品搜索与我的喜欢验证记录

本记录对应 `f064bd4a` 后的本地未提交工作区，日期为 2026-10-22；没有发布到生产。实施依据是[开发重点审查](../development-priorities-2026-10-22.md)，当前业务规则见[作品搜索与我的喜欢](../../features/artwork-search-and-favorites.md)。

## 实现与修正

- 当前账户喜欢条件贯通筛选草稿、URL、快捷筛选、普通／随机分页与沉浸浏览；缺失字段的旧预设保持显示全部。
- 标签建议支持原名、中文、英文名称，`#` 进入显式标签模式，选择后使用稳定 ID；未选择建议时不改写作品关键词。标签列表保留既有全文检索与相关度，修复清理查询时丢弃假名的问题。
- 独立代码复核发现账户 A 的取消喜欢响应晚于切换 B 时，A 的缓存可能没有失效。修复为始终更新发起账户缓存、仅在当前账户匹配时同步 viewer store，并在取消旧查询后再次确认账户；跨账户失效不立即发出 B 会话请求。定向回归通过，复核已关闭该问题。
- 既有 `viewer-compact-progress` 组件测试补充真实 `QueryClientProvider` 和清理，保留原断言。

## 验证环境与恢复依据

macOS 本地生产构建，Next.js 16.1.1、Vitest 4.0.18。新建 PostgreSQL 15.19 容器，绑定 `127.0.0.1:55434`，数据库为 `favorites_verification`；从空库执行完整 97 个正式 migration，没有使用 `db:push`。新建 ImgProxy 绑定 `127.0.0.1:55431`，只读挂载合成媒体；应用使用独立环境包装器和端口 5430。

数据库集成测试使用唯一标识并清理自身 fixture。浏览器 fixture 包括两个通过真实认证接口创建的账户、18 部作品、54 张合成 PNG 和三个含中英日名称的标签。缩略图请求返回 200 / `image/webp`。既有 PostgreSQL 5432、ImgProxy 5431、Worker 与业务收藏目录均未改动。

仅本次新建容器和合成文件构成可丢弃恢复单位；清理须匹配容器名与本次任务标签。凭证保存在被忽略的本地证据目录，不进入本记录或 Git。

验收后已核实进程归属并停止本次应用，5430 端口空闲；按精确 ID 和任务标签删除两个临时容器及其匿名卷。原有数据库、ImgProxy 和 Worker 仍运行。截图及日志保留，清理证据为 `cleanup-evidence.json`。

## 自动化与数据库结果

| 检查                                      | 结果与边界                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                               | 通过，0 warnings / 0 errors                                                                                                       |
| `pnpm --filter @pixishelf/next typecheck` | 最终代码通过，包含测试文件类型检查                                                                                                |
| 主应用单元／组件全量                      | `pnpm run test:unit --maxWorkers=2` 通过：408 文件、2873 测试；原有 30 文件、221 测试跳过，未计为通过                             |
| `pnpm build`                              | 提升权限通过；使用隔离环境，编译和构建内 TypeScript 均通过                                                                        |
| `artwork-favorites.postgres.test.ts`      | 6 / 6 通过                                                                                                                        |
| 多语言真实服务检查                        | 中英日名称、大小写、单字、重复命中、空白、数量上限、稳定 ID、普通模式边界与全文相关度通过                                         |
| 文档、图示和路径                          | 文档链接／锚点／围栏、主应用路径大小写与 diff 检查通过；图示检查使用已安装 Chrome 提升权限通过，28 个独立图源和 23 处内嵌 Mermaid |

数据库测试实际验证 A/B 喜欢隔离、非活动作品排除、阅读／标签组合、四种普通 keyset 排序和完整随机环、取消边界项及后续项后的分页，以及列表／卡片／沉浸候选一致性。缺失或错误账户、改变条件后重用游标均拒绝。没有将单元 mock 结果替代真实 SQL 结果。

首次全量在沙箱中受到回环端口和 CLI IPC 的 `EPERM` 限制，并暴露上述组件 provider 缺失；修复 provider 后提升权限重跑，本次相关测试通过，一个未改动的归档批量选择测试在与 build 并行时超过原有 5 秒上限。单独重跑该文件 6 / 6 通过，超时用例耗时 1.856 秒；最终使用相同套件、两个 worker 重跑，没有扩大超时或削弱断言。

## 浏览器验收

使用 `entry=direct`、隔离 fixture 与生产构建，在 Chrome 完成两轮有界验收，共记录 19 项检查和 8 张截图。桌面视口为 1440 × 1000，手机视口为 390 × 844。

- 桌面：初始 18 部作品；勾选喜欢及保存预设均不提前应用，应用后精确返回 A 的 9 部喜欢；刷新保留、清除恢复、预设恢复均符合 URL 与候选结果。
- 多语言：中文与大小写混合英文选择同一标签 ID，和喜欢取交集得到 3 部；无结果 Enter 和清空标签输入均不误提交作品关键词。
- 沉浸浏览：继承喜欢与标签条件；取消喜欢立即移除当前作品并前进，返回列表后剩余 2 部正确候选。
- 手机：抽屉条件可应用；账户 A 正常退出并登录 B 后，精确返回 B 的 6 部喜欢，B 没有 A 的快捷筛选。喜欢列表、抽屉应用后页面及标签建议的页面宽度与视口一致，未出现横向溢出。

截图与逐项数据见本机证据目录的 `browser-evidence.json`、`desktop-*.jpg` 和 `mobile-*.jpg`。手机视口不等于真实手机或原生软键盘；浏览器测试没有注入跨账户晚到响应，该竞态由定向组件／缓存测试覆盖。随机完整分页由真实 PostgreSQL 测试覆盖，浏览器沉浸流程使用有序模式。

观察到一条 `artwork.cardList` 客户端 tRPC 控制台错误，仅包含无法展开的 `Object`，现有浏览器日志不能确定原因；发生于桌面筛选／标签阶段，早于账户切换，不能归因为跨账户请求拒绝。页面无可见失败、断言集合均正确、服务端未记录对应业务错误。该项保留为未归因观测，不声明控制台零错误。现有 `output: standalone` 配置下使用包内 `next start` 还输出启动方式建议，应用仍成功启动并完成验收；本次未修改部署入口。

## 证据位置与未覆盖范围

本机证据位于被忽略的 `.local-data/favorites-20261022/`：`resource-evidence.json`、`database-evidence.log`、`integration.log`、`multilingual-evidence.json`、`production-build.log`、`unit-final.log` 及浏览器验收材料。先前全量原始输出另在 `/private/tmp/pixishelf-favorites-final-test.log`。这些路径只证明本机当时执行，长期可复核摘要以本记录为准。

本次没有修改 Schema、migration、依赖或原媒体；前后端需要一起发布。未进行生产部署、真实手机、生产规模性能压测、全部 integration 或 Worker／WebP 全链回归；本次变更未涉及这些运行时的实现。默认单元套件跳过的数据库场景不计为通过，本次喜欢分页另有上述独立 PostgreSQL 验证。
