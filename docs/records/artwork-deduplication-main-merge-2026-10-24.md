---
status: historical
scope: 去重分支合入main的增量保留、冲突处理及本地启动测试
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-direct-delete-batch3-2026-10-24.md
  - docs/operations/runbooks/artwork-deduplication.md
  - README.md
---

# 去重合入主目录

用户明确要求合入主目录、保留期间主线修改，不重复全量验证。本次只合并代码并生成本地客户端，不迁移用户数据库，不启动或停止用户服务，不执行媒体操作。

## 基线与保留依据

- 主目录 `/Users/namehu/mm_code/PixiShelf`，合并前main为 `9713c1b3c1b226451867e692e239d5085499ca01`，工作区和暂存区干净。
- 去重分支 `codex/artwork-deduplication` 为 `5dec7b585c97fd96b8ed8aacecba675d6aa9044c`，沿用第三批已审查和隔离验收证据。
- Git共同祖先 `c3df56be`；去重开工快照 `aa262746` 含当时未提交的归档下载改造。主线后续14个提交通过普通双亲merge保留，不采用覆盖主目录或重置。
- 相对开工快照，仅主线改变的114个文件与合并前main逐路径相同，包括视频缩放/全屏、详情定位、浏览返回缓存和归档来源管理。机器核对清单保存于 `/private/tmp/dedup-main-preservation.json`。
- 两侧共同改变的代码仅为 `reading-service.test.ts` 和 `artwork-service/index.ts`：保留主线90%完成阈值及稳定 `String(id)` key，叠加去重声明保护。两份共同修改文档保留主线视频规格入口和来源搜索/关联权限规则，另加去重规则。

## 冲突处理

19个代码冲突路径在开工快照与当前main间内容完全相同；因此保留去重在同一基线上的后续修改。归档maintenance自动合并残留的一份旧内联helper与新共享helper重复，移除重复旧实现后，19路径均与已验收去重头一致，没有删掉main后续逻辑。

5份文档冲突分别处理：去重最新批准方案替代早期草案；备份和升级手册保留原文并叠加媒体声明恢复规则；归档下载本地升级记录完整保留main新增的用户验收后日志与数据核验，未退回旧的待验收状态。

复杂合并由Astra/high实施；Sol6.1/xhigh只做限定合并复审。验证结果在本记录收尾登记，不重新运行全量lint/test/build、规模测试、浏览器或真实数据库迁移。

## 启动开发测试

沿用现有两份环境文件，不覆盖配置。先结束旧F5/Next开发进程，再停止旧Worker和scheduler；按备份基线保留开发数据库和媒体的升级前检查点。以下在主目录执行：

```bash
cd /Users/namehu/mm_code/PixiShelf
docker compose --env-file build/.env -f build/docker-compose.dev.yml stop worker scheduler
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db db:status
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d --build worker
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/capability-audit.cjs
pnpm --filter @pixishelf/next dev
```

数据库和ImgProxy沿用现有服务；若尚未启动，先执行README的 `up -d postgres imgproxy`。Prisma脚本优先使用终端DATABASE_URL；未提供则按脚本读取本地环境，宿主地址应为localhost/127.0.0.1而非容器内postgres。正式使用db:deploy，不用db:push。迁移报错时停在该步骤，不启动新Worker。

`--build worker` 是让运行中的Worker获得新执行器，不是重复全量验证；宿主App使用开发启动或原F5即可，无需再执行App build。开发入口为 `http://127.0.0.1:5430/artists?entry=direct`，选择艺术家后点击“检查重复”；可先用同艺术家下两份可丢弃的重复作品测试检查、保留选择、预览和一次删除确认。

已有URL归档缺少新来源证明时可能只允许检查、在删除预览中阻断；不得给旧任务补签来源证明，详见去重运维手册。此次合并不声称已将真实图库升级或完成新的生产验收。

## 增量验证与独立复审结果

- Schema validate、Prisma Client generate通过；现有迁移SQL没有修改，仅新增14份去重/内容声明迁移，未执行数据库deploy。
- 聚焦单元测试217项通过：DB启动/阅读契约48，Executor归档/维护/扫描路径/来源证明66，Worker能力/注册16，App归档/阅读/viewer75，任务投影/动画让行12。11项PostgreSQL用例因未配置本轮隔离库而跳过，不记作通过。
- App（含路由typegen）、Executor、Worker类型检查通过。没有运行全量lint/test/build、规模或浏览器；原去重专项和故障证据沿第三批记录复用。
- Sol6.1/xhigh独立限定复审通过：19冲突路径解法、114主线独有路径、两处自动合并代码语义及五份文档冲突均无阻断；未重复测试。
- 主应用大写路径0匹配、代码差异空白检查通过。完整代码合并交接在 `/private/tmp/dedup-merge-code-handoff.md`，本记录提供持久摘要；原114路径清单在 `/private/tmp/dedup-main-preservation.json`。

合并提交保留合并前main与去重头两个父提交，不改写既有历史；本记录所在提交即本次合并交付。主线新增代码未经此次重复浏览器/生产验证，本次不将“代码已合并”写成“数据库已升级或服务已部署”。

合并文档检查 `pnpm docs:check` 通过：263份Markdown的本地链接、锚点、大小写与围栏全部通过；图源未在本次合并中重写，沿用既有图示验证。

提交前完整暂存区空白检查报告3处去重分支既有的文件末尾空行：02000指纹migration、e-hentai-url.ts、audit-root-guard.ts。三文件暂存blob均与已验收去重头完全相同；本次不为格式改写已应用migration校验和，也不额外改动既有源码。以去重头为基准的合并增量 `git diff --check MERGE_HEAD` 通过；未将完整暂存区检查冒称全绿。
