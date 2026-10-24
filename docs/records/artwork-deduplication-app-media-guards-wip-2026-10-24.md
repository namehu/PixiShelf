# App 媒体与章节守卫暂停交接

日期：2026-10-24。状态：**WIP，未完成、未独立审查**。用户选择当前小批次收口后暂停；接到指令后没有继续实现或启动验证。门禁保持 3，未执行实际隔离、恢复或永久清理。

工作树：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，基线 `6e8d4f4c`。所有改动均未提交，保留同工作树其他 agent 的改动。上一批输入证明错误映射 P2 已由独立复审关闭，本批没有再次修改其冻结文件。

## 本批已保存改动

- `docs/design/artwork-deduplication/app-write-guards.md`：新增第四小批边界；媒体/章节真实写事务、开始与最终检查、手工存储分配及控制回执约束。
- `packages/pixishelf/services/artwork-service/image-manager.ts`：整体媒体重建、reconcile、addImage、实际上传 publication 接 CONTENT；COMPLETED 已登记媒体回执保留无写返回；章节关联改同事务并核对 Image 归属，无文件清除接 CONTENT 并重查归属。
- `packages/pixishelf/services/artwork-service/manual-storage.ts`：实际存储路径分配入口接 STRUCTURE，覆盖新建和旧空手工作品修复。
- `packages/pixishelf/services/artwork-service/media-chapter-upload.ts`：开始前检查并映射 HTTP 409/404；最终关联再次检查；新章节路径显式向 beginContentUpload 提交相关视频 Image；原 content token 发布和 legacy 标记收尾仍在原事务。
- `packages/pixishelf/services/artwork-service/content-source-guard.ts`：beginContentUpload 可选 relatedImage，首次声明在同一根/path 事务加入既有 Image 内容声明；合并路径匹配及指定 Image 后一次调用原 source-write helper；原非 COMPLETED 上传复用核对相关 Image 原 token，不补造缺失声明。COMPLETED 分支仍只读。
- `packages/pixishelf/services/artwork-service/__tests__/manual-storage.test.ts`、`image-manager-replace.test.ts`：旧单测夹具 stub App guard；真实 Claim 回归尚未补。
- `packages/pixishelf/services/artwork-service/__tests__/media-chapter-upload.test.ts`：新增开始拒绝 409/404、迟到最终关联拒绝且不伪造完成的三个单测。

## 已结束的验证

运行以下四个 Vitest 文件：manual-storage、image-manager-replace、media-chapter-upload、image-manager。结果 **4 files / 30 tests passed**。执行进程已结束，无本 agent 尚在运行的自建测试进程；没有启动应用、Worker 或用户 5430 服务。

暂停后没有跑 typecheck、lint、build、docs、diagrams 或 PostgreSQL。没有新增本批真实数据库测试。本批没有最终格式、类型及锁序独立审查结论。

## 未完成与恢复入口

1. 先审查 relatedImage 开始声明/重试/完成路径的锁序、原 token 与 Image 归属语义；确认晚到 Claim 与新章节首传之间没有间隙，且旧缺声明上传不能补造。当前只完成代码和最小单测，不声明已经验证该跨事务性质。
2. 在独立合成数据库补真实 keeper/copy Claim 下零写、READY 上传迟到登记拒绝、COMPLETED 无写重放、章节 begin 竞态与声明释放、无 Claim 原功能、手工路径修复回归。现有库 `dedup_app_inputs112`（schema 111），仅 loopback 55432 / dedup / dedup-fixture-only；不并行清理其他 fixture。可设置 `PIXISHELF_TEST_DATABASE_URL=postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_app_inputs112`，若复用旧 fixture 则按其约定另设 QUEUE_KERNEL_TEST_DATABASE_URL。当前未写本批 PG 文件。
3. 完成受影响单测、必要类型/定向 lint 后再冻结给 Sol 独立审查。仅需用户主动恢复后执行；不自动继续。
4. artist/creator 全范围、tag 级联、元数据删除/URL hold、App archive publication retry 等仍未开始。publication retry 归 App 线，可复用 Executor 已导出的 assertArchiveSourceSnapshot；不要改 Executor archive 主体或 DB claims。

本批无需要恢复的后台进程。恢复时先进入上述隔离工作树阅读本记录及权威第四小批，保留并接续全部未提交改动；勿重跑已关闭输入 P2 或已审阅读/评分/标记/updateArtwork/reorder。
