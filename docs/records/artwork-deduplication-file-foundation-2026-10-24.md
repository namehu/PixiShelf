---
status: historical
scope: 三至五阶段文件执行基础首批定向验证
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-files.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/maintenance-files.test.ts
  - packages/pixishelf-worker/native/artwork-dedup-rename.c
  - packages/pixishelf-worker/native/tests/rename-exclusive.cjs
---

# 受控文件执行基础验证

日期：2026-10-24。基线 `c2d6be73` 上的未提交首批实现；与 DB/UI 并行，记录只覆盖此批文件适配，不代表 PREPARE/ISOLATE/RESTORE/PURGE 已交付。共享阶段门禁仍关闭。未访问真实媒体或规模库，未改动第二阶段基准副本。

## 实现与边界

既有固定 reader 增加精确文件属性检查、有界目录分页和实际文件系统能力探测。属性包括 hard-link count，末端符号链接只报告类型；父路径符号链接/越界拒绝。目录页至多 100 条，名称游标绑定目录设备/inode/mtime/ctime；单次扫描至多 10,000 项，超过预算直接阻断。Pixiv 平铺的清单构建仍须只传精确路径，不能以本接口认领邻居。

最小 Node-API 8 addon 在 reader 进程内同步执行 Linux `renameat2(RENAME_NOREPLACE)` 或 macOS `renameatx_np(RENAME_EXCL)`，以已打开的父目录描述符和单段名称调用。没有文件操作孙进程、线程池执行者或普通 rename/复制删除回退。其他平台和 addon 缺失时能力拒绝；其他 Worker 功能的构建不因此被禁用。Docker 仅 builder 增加 `build-base`，运行镜像不增加编译器。

首个原媒体动作前必须完成实际挂载的探针：已占目标被拒绝且两文件不变、空目标移动保留 inode、文件和目录同步可用。失败保留探针证据，成功仅清理自己创建的探针文件。本批尚未把原媒体移动或删除暴露为 reader IPC，后续清单/意图/收据执行必须继续使用相同进程与持久占用证明。

## 执行结果

| 检查                                           | 环境与结果                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| 单独编译 addon                                 | macOS arm64，Node v20.19.4，系统 cc；成功。仅生成 Worker 的该 `.node` 产物  |
| `reader.test.ts` + `maintenance-files.test.ts` | 2 文件、21 项通过；原 reader 12 项与新增 9 项                               |
| macOS native 单独夹具                          | 不覆盖普通文件/符号链接、保留 inode、拒绝越界/非法单段名、目录 fsync 均通过 |
| Linux native 单独夹具                          | 一次性 Node 20 Alpine arm64 容器，Node v20.20.2；相同夹具通过               |
| 执行器 typecheck                               | `pnpm --filter @pixishelf/job-executors typecheck` 通过                     |
| 格式与应用路径                                 | `git diff --check` 无输出；主应用全小写路径检查无输出                       |

Linux 使用本地 `node:20-alpine` 镜像 ID `sha256:cd266ddf7e80183cbac3cb23b49e90ab83a06f14f95d28681d8468f89dc00615`；仅安装编译依赖并编译这个 C 文件，没有构建整 Worker/App。容器退出后删除；挂载的源码为只读。

新增真实 reader 夹具覆盖：0 字节和不存在项保持真实状态、硬链接计数、符号链接父路径拒绝、201 项的 100/100/1 分页、目录变化拒绝、10,001 项超限、真实能力探针不动原文件、主进程调用能力拒绝、目标普通文件/符号链接原子不覆盖、移动保持 inode。SIGKILL 夹具在同一子进程即将调用 native 前阻塞，确认 close 和 PID 已退出，再越过原计划动作时间检查源仍在、目标不存在；结合 addon 无 spawn/threadpool 的实现证明没有能独立继续 rename 的文件操作执行者。原 reader 的真实 Worker SIGKILL/重启退出证明回归也通过。

## 限制和后续

这些是 macOS 本地文件系统及 Linux 容器文件系统证据，不是 NAS 性能、所有远程挂载兼容或断电耐久性证明。文件/目录 fsync 成功不等于整个存储系统已获得断电保证；真实挂载仍须运行时探测，未知结果依据原意图双位置复核。

本批不宣称 DB 意图、磁盘清单封印、动作后收据、完整 fresh hash、URL drain/hold 或 tombstone 已验收。后续各批按同一共享契约接入并单独留下故障重放证据。未执行全量构建/测试；高级维护入口保持共享门禁拒绝，等待独立审查和阶段验收。

## 独立审查 P1/P2 修复后的定向验证

同日针对[独立审查记录](./artwork-deduplication-file-foundation-review-2026-10-24.md)完成两项修复；没有开始下一批维护业务，也没有开放高级入口。修改范围仅原文件适配、原 native 目标/夹具、两份新边界测试及执行契约/本记录。

维护写入现在先完整核验 rootIdentity，再打开根目录并核对设备/inode；后续目录逐段使用 fd 相对 `openat(O_DIRECTORY | O_NOFOLLOW)`，每段拒绝跨设备。rename 的源/目标目录，以及探针 mkdir/open/unlink/rmdir 和目录同步，均使用这些锚定描述符，不再重新解析维护路径的绝对祖先。句柄仍完全属于同一个受控 reader，同步 native 调用无子进程或线程池。每个写入口及实际动作前复核包含 marker 的完整根身份，过期绑定不会先创建探针路径。

新增 `maintenance-boundary.test.ts` 的 12 项真实 child/临时目录测试通过：

- 在 source 父目录打开前替换同设备祖先为根外 symlink，移动拒绝 `UNSAFE_PATH`，根外 source 与根内原 source 均未动。
- 分别在探针 mkdir、create、unlink、rmdir 调用点替换祖先；已打开 fd 继续指向原目录，后续解析拒绝 symlink。五类场景均核对整个根外夹具树字节/目录名未变，而不是只看错误码。
- marker 新增时 rename/ensure/probe/sync 四个入口均返回 `ROOT_CHANGED`，`.trash` 未创建，源/目标不变；marker 删除/改变也在探针首个路径创建前拒绝。
- 在动作目录已打开后改变 marker，rename 前的再次核验仍拒绝，源/目标不变。

本轮相关回归共 3 个文件、33/33 项通过（12 新边界 + 9 文件基础 + 12 原 reader），包括既有真正 SIGKILL Worker/reader 的退出证明；执行器 typecheck 通过。macOS Node v20.19.4 和同一 Linux Node 20 Alpine arm64 镜像再次仅编译受影响 native 目标，新 `anchoredAtCalls` 夹具均通过：替换目录名称后 fd 相对创建/删除仍只作用原目录，新 symlink 拒绝，外侧目录保持空。不覆盖 rename、非法名称、inode 与目录 fsync 回归继续通过。

以上不扩展为 NAS、恶意并发写入下完整事务原子性或断电保证；外部停写和后续冻结身份/意图/收据仍是维护前提。没有全量 build/test、数据库操作或基准样本改动，等待原独立审查者窄复审。
