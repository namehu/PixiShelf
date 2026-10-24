---
status: historical
scope: 去重三至五阶段首批受控文件执行基础的独立代码审查
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - docs/design/artwork-deduplication/04-isolation.md
  - docs/records/artwork-deduplication-file-foundation-2026-10-24.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-files.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-child.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-protocol.ts
  - packages/pixishelf-worker/native/artwork-dedup-rename.c
  - packages/pixishelf-worker/scripts/build-dedup-native.mjs
  - build/worker.Dockerfile
---

# 文件执行基础独立审查

2026-10-24，分支 `codex/artwork-deduplication`，基线 `c2d6be73d0ace279a8ea716511daaa9b241d1616` 的首批未提交文件实现。审查者不参与本批实现；本记录只评估冻结的文件执行基础，不评估尚未完成的 PREPARE/ISOLATE/RESTORE/PURGE 全流程，也不据此开放阶段门禁。

## 范围与方法

静态审查 `maintenance-files.ts`、`reader.ts`、`reader-child.ts`、`reader-protocol.ts`，新增 `maintenance-files.test.ts` 与 `maintenance-rename-fixture.ts`，原生组件及 `native/tests/rename-exclusive.cjs`，`build-dedup-native.mjs`、`build.mjs`、Worker Dockerfile，以及文件执行契约、第四阶段相关节和首批验证记录。为理解调用边界，定向阅读既有媒体根解析、根 marker 和 reader supervisor 实现；既有代码不是本批修改目标。

只对具体疑点做两个临时目录夹具，运行环境为 macOS arm64、Node v20.19.4，使用现有 tsx 和已编译 addon。夹具通过 `pnpm --filter @pixishelf/worker exec node --import tsx` 执行；全部输入和文件动作均位于系统临时目录，结束后清理。没有访问真实媒体、数据库或规模库，没有修改业务代码，没有重新执行全量构建、全量测试或浏览器验收。实现者记录的 21 项测试及 Linux 容器结果属于原验证记录，本审查没有将其冒称为独立重跑结果。

## 发现

### P1：打开维护目录时祖先符号链接仍可绕过根范围

位置：`packages/pixishelf-job-executors/src/artwork-dedup/maintenance-files.ts:172–176`，影响 `renameMaintenanceFile` 使用的源/目标目录描述符，以及仍按绝对路径执行的探针创建和清理。

`resolveMediaContentPath` 完成逐段 lstat/realpath 校验后，`fs.open(resolved.absolutePath, O_DIRECTORY | O_NOFOLLOW)` 再次解析完整路径。`O_NOFOLLOW` 只约束最后一段；祖先目录在两步之间被替换成指向同设备根外位置的符号链接时，返回的目录描述符仍可通过这里只检查设备的断言，随后 native rename 操作根外文件。目录替换者可能是尚未真正静默的外部同步或编辑进程。外部停写声明是操作前提，但不能把已经发生的祖先替换误判为路径检查通过。

定点夹具在实际 `fs.open` 之前暂停，把受信根下 `parent` 移为 `original-parent` 并将 `parent` 替换为指向兄弟临时目录的 symlink，再继续同一个打开和原生调用。`renameMaintenanceFile(root, 'parent/child/source', 'target/moved')` 成功，结果为：

```json
{ "swapped": true, "movedContents": "outside", "originalContents": "inside", "outsideSourceMissing": true }
```

这里移动的是根外临时文件，原根内临时文件未动。最小修复方向是从已验证的根描述符出发，逐段以 fd 相对的 `openat`/`O_NOFOLLOW` 获取目录并核对身份；维护目录的创建、文件打开及清理也应使用受锚定目录描述符，避免校验后重新解析含祖先路径的绝对字符串。增加同设备祖先 symlink 替换的拒绝夹具，再接入原媒体动作。

### P2：维护写入口没有在写入前验证完整根身份

位置：`packages/pixishelf-job-executors/src/artwork-dedup/maintenance-files.ts:243–247`；同样涉及 `openDirectory`/`ensureMaintenanceDirectory` 及 `renameMaintenanceFile`。

这些写入口依赖 `resolveMediaContentPath` 的路径、设备及 inode 检查，没有调用包含 `.pixishelf-root` 身份语义的 `assertMediaContentRootUnchanged`。在已解析根的 marker 随后新增、丢失或改变时，文件系统路径和目录 inode 可以保持不变，维护 helper 仍执行写入。能力探针直到创建目录和文件、尝试 rename 后的 `inspectMaintenanceFile` 才发现旧 rootIdentity，因此不能保证在错误根身份上开始前就拒绝。

无竞争夹具先解析无 marker 的临时根，再加入合法的新 marker。标准完整根断言返回 `ROOT_CHANGED`，但原媒体移动 helper 仍成功移动临时文件；随后能力探针返回 `ROOT_CHANGED` 时，已经在该过期根创建了探针目录和文件：

```json
{
  "assertedCode": "ROOT_CHANGED",
  "renamedDespiteStaleRoot": "inside",
  "capabilityCode": "ROOT_CHANGED",
  "createdProbeUnderStaleRoot": ["probe-<uuid>"]
}
```

最小修复是在首个 mkdir 前及每次维护动作前验证完整 rootIdentity，并与描述符锚定检查结合；补充 marker 改变时探针不创建任何路径、移动源目标均不变的夹具。本批尚未开放原媒体移动 IPC，因此没有声称当前线上已发生原媒体移动；这是文件基础在后续复用前必须补齐的边界。

## 其余结论与限制

固定 addon 的 Linux `renameat2(RENAME_NOREPLACE)` / macOS `renameatx_np(RENAME_EXCL)` 同步调用、单段名称校验、无普通 rename/copy-delete 回退，以及源/目标目录 handle 的 finally 关闭路径，静态审查未发现独立阻塞项。C 组件自身不创建进程、线程或目录描述符；reader 的 close/PID 证明仍覆盖执行 native 调用的同一个进程。维护目录与探针操作在 reader 调度中与读取互斥。

目录分页最多返回 100 项，完整单次枚举超过 10,000 项拒绝，名称顺序和目录设备/inode/mtime/ctime 游标检查与本批契约一致。精确属性报告 0 字节、缺失项、末端 symlink 及硬链接计数；这些报告仍需后续计划构建者据类型、归属和 link count 拒绝不合格条目。本批没有把硬链接报告误当作移动授权。

构建将 addon 与固定 reader 放入 Worker dist，Docker builder 增加编译器而 production 不携带编译器；静态核对没有发现产物遗漏或平台回退。没有重新构建镜像，也没有把已有 macOS/Linux 本地证据扩展为 NAS 或断电保证。磁盘清单封印、DB 意图/收据、完整 fresh hash、URL drain/hold 和后续状态机未在本次审查范围内。

结论：本批仍有上述两项需修复；修复并定向复审前，不以本记录关闭文件执行边界验收。

## 文档与范围检查

- 冻结的已跟踪 diff 的 `git diff --check` 无输出。
- 主应用大写路径检查 `rg --files packages/pixishelf | rg '[A-Z]'` 无输出。
- `pnpm docs:check` 通过：211 份 Markdown 的本地链接、锚点、路径大小写和代码围栏检查通过。
- 未修改 Mermaid/SVG；本批审查明确禁止浏览器，`docs:diagrams:check` 脚本会启动 Chromium，因此未运行，交由最终统一文档门禁核对。
