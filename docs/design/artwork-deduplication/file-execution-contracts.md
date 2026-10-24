---
status: draft
scope: 保留的受控 PREPARE/reader 边界与去重专用原地逐文件删除目标协议
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/direct-delete.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/reader.ts
---

# 文件执行契约

本文细化[直接删除契约](./direct-delete.md)的媒体 I/O 边界。PREPARE、reader 占用、检查点、受控读取和逐文件日志基础继续复用；DIRECT_DELETE 尚未实现验收，独立能力门禁保持关闭。旧 rename/no-replace 探针、隔离树、MOVE/RESTORE 和隔离后 PURGE 不再是实施目标，旧代码或测试不构成新删除证明。

## 受控检查与 PREPARE

全部 stat/open/realpath/hash、目录检查及删除均在既有固定 reader 中，SCAN 与维护共用持久占用及 Worker supervisor；父进程不做媒体 I/O。IPC 有界，文件动作串行且与读请求互斥。停止接收结果后等待实际 close；kill、失租约和超时不允许替代或清 token。未知进程归属保留需人工处理状态，离线恢复继续沿用原 owner/token CAS，不 force 清除。

PREPARE 根据 DB 冻结引用检查完整根映射（含 archiveRelativePrefix）、规范路径、普通文件、link count、设备/inode/大小/纳秒时间；全库精确引用由 DB helper 判定，reader 不能将 UNCONFIRMED 自行提升为 VERIFIED。硬链接、符号链接和共享路径不因哈希相同获得删除资格。独占目录才有界检查遗漏，Pixiv 平铺只检查精确引用，不将邻居加入清单。

沿用现有预算：目录页 100 项、DFS 深度 12、总访问 10,000，检查点只保存有界栈、名称游标和可靠目录属性；变化、越界或超预算阻断，不把部分结果标完整。不保存文件全集或未经检查的路径。每页至多 50 个 Image（含章节至多 100 文件行），stat 并发最多 4，来源读取串行，数据/计数/检查点同一短 fenced 事务提交。

metadata/归档 manifest 上限 16 MiB、章节清单 5 MiB，完整读取核对身份和摘要，不截断后认作成功。Pixiv 使用既有 metadata 解析器，章节使用现有规范摘要和 chaptersHash；归档核对已发布且 sealed/drained 的同 generation 封印、provider/externalId/revision、真实 importItem→Image 路径/大小/摘要，不猜 pageIndex。未验证历史 revision 原件在新删除预览阻断；已知来源文件不是额外历史原件的删除授权。

来源文件按独立 referenceKey 保存，媒体/来源/目录阶段有各自持久游标；失败 IPC 也回报累计实际读字节，不能绕过 slice 预算。约 10 秒或 256 MiB 在文件边界提交并让出 writer，实际 close 后冷却 3 秒；事件按聚合进度记录，不逐文件刷事件。首尾复核根，页提交复核原版本，最终 READY/STALE/阻断与任务完成同一 fenced 事务。

新 PREPARE 明确 DIRECT_DELETE 目的/协议，旧 ISOLATION 预览必须重新准备。它不产生删除授权，也不长期认领作品；未知附件始终阻断，用户选整组不能代替文件审核。

## 首删前与描述符边界

Worker 取得全部 keeper/copy 声明和来源 HOLD，确认相关执行已真正退出后，绕过缓存完整读取所选全部组，核对 keeper/copy 多重集合。所有组成功才首删；预检失败时零删除。根/来源/成员变化不接纳为新快照。

在首删前持久化原授权范围、manifest/摘要、全范围 fresh 证据及 COPY 不可见状态；每个删除动作前再核对版本/fence、根 marker、普通文件身份和精确路径。外部同步/编辑停写声明须持续有效。删除仅 unlink 冻结文件，不 rename、不递归、不清空目录、不 rmdir；不为新模式要求同文件系统移动能力或旧 no-replace 探针。

文件操作应从核验的根目录描述符逐段解析父目录，拒绝符号链接和越界，持有已核验父目录句柄，以最终单段文件名执行精确 unlink。不能在检查后重新经完整绝对路径解析祖先。完整 rootIdentity 包括 marker，不由 dev/inode 替代；每个实际动作前核验。实现须证明父目录替换/路径竞争不会把动作重定向到根外或新占用；不降级 shell rm。具体原生适配复用现有安全边界，第二批以真实文件系统故障测试验收，不能根据平台名称推定 NAS 支持。

## 意图、删除、回执与续行

1. 原 operation/execution/version 与冻结 fileId 核验，通过精确身份检查。
2. 短 fenced 事务持久 `DELETE_INTENT`，绑定原路径、原身份及动作。
3. 受控 reader 对该精确文件 unlink，并按目标能力同步必要父目录。
4. 以同一围栏保存 `DELETED` 回执；全部文件收据齐全后由 DB 层终结业务记录、墓碑和 Claim。

数据库事务不涵盖 unlink。无意图缺失是异常；原意图后缺失只有可证明属于原操作的既有核验身份时才能补回执。路径被新文件占用、根/身份变化则阻断并保留新文件，不能凭文件名继续删。unlink 成功而同步/回执失败须保留“不确定/已可能删除”的事实，不标回滚成功。原意图缺失续行也必须成功同步已验证父目录后才补回执，不能把 ENOENT 单独当作持久删除成功。

部分失败、崩溃或请求停止后保留冻结范围、COPY 不可见、必要 keeper/copy 声明、来源 HOLD、intent/receipt 和诊断。重试先确认旧 reader 退出、原围栏/授权仍有效，fresh 重验 keeper，再复核并续原未完成文件；不扩围、不换 keeper、不删除新占用。原范围内已删文件不能恢复。

首个意图前取消有效，核验无动作及退出后释放。首个意图后仅在安全文件边界停止，不再发起下一条动作；未决意图按可能已删除处理，现场未核实前不能恢复可见性或解锁。业务终结不得级联删除日志或来源墓碑。详细测试标准见 DD-05–09。

### POSIX 原子性限制

受控 reader 通过已验证父 fd，在同一次同步 native 调用中以 fstatat(AT_SYMLINK_NOFOLLOW) 核对 dev/inode/size/nlink/纳秒时间，然后紧接 unlinkat；没有 JavaScript await 或完整绝对路径重解析。POSIX 没有 inode 条件 unlink CAS，因此两个 syscall 之间仍存在外部进程换名窗口。这里依赖已批准的外部同步/编辑持续停写前提；不能宣称无条件抵御违反该前提的外部并发替换。动作前已存在的新占用、符号链接、祖先/根变化必须拒绝并保留。该事实纳入独立审查及第三批开放决策。

测试可在已校验父 fd/文件身份后、unlinkat 前用仅测试编译的 syscall 屏障替换合成父目录。此时动作仍针对原已打开父 fd 下的冻结文件；新路径占用及根外 symlink 目标不受影响。该证明不等同于抵御同一父 fd 内 fstatat 与 unlinkat 之间的恶意文件换名，外部持续停写前提仍适用。
