---
status: historical
scope: 视觉检索 V2 合并候选的真实进程重启与桌面抽查
last-verified: 2026-10-29
sources:
  - packages/pixishelf/services/artwork-dedup-service.ts
  - packages/pixishelf-worker/src/dispatcher.ts
  - packages/pixishelf-worker/src/production-capabilities.ts
---

# 视觉检索 V2 发布补充验收（2026-10-29）

适用候选 `a7f2eedb`（`4ade7b44` 与 main `8ea4d57c` 合并）。仅使用隔离 PostgreSQL fixture 和临时合成媒体，未访问开发或生产库。main 新增 3 条迁移部署、Prisma generate、必要 Worker 依赖链 build、registry 专项 13 项及 READY 能力审计通过（39 类 / 63 版本）；没有重跑全量验证。

新增艺术家 7：50 部作品 × 40 张静图，共 2000 文件、3,620,370 bytes；每两部内容完全相同，预期 25 组。首轮浏览器发起的检查自然完成，不能算作重启证据。

随后通过现有 `startArtworkDedup` 领域入口发起 FULL 检查，run `4610351e-5064-4ff5-a370-f32438bed0b5`、job `957799b0-eec6-4b29-93a4-06cbbc8245cc`。15:39:52.573Z 在 HASH 阶段观察到 120 张已提交，向自有 Node Worker PID 93370 发送一次 SIGKILL；停止后的持久检查点为 160 张。读取子进程 PID 93629 与父进程均在 1.5 秒后确认退出。同环境重启 PID 93678，未改租约或时钟；旧租约 15:40:45.495Z 到期，15:40:46.740Z 同 run/job 进入第 2 次执行，从 160 张继续，15:41:28.426Z 完成。

最终 50 部均完成，stat/hash/媒体行均为 2000，25 组准确对应预设配对。2000 文件的大小与 SHA-256 均与种子及数据库一致；FULL 的 2000 次特征解码及持久读取 7,240,740 bytes 与两遍全量读取一致，未重复累计。198 个状态样本未发现持久计数或同阶段进度回退。既有 A/C 的 10 个文件、先前删除的 B 状态及新增样本全部保持原状。自建 Worker 与采样到的读取子进程均已停止，数据库和媒体保留。

浏览器观察到同 run 从原件 0 项恢复到特征 127/2000，刷新后 1211/2000，随后视觉 1792/2000，最终 25 组；没有人工继续或删除。首轮检查活跃期间列表可打开；检查完成后结果分页可用。详情自动化读取超时后恢复，故不声明完整桌面交互覆盖。

范围限制：本次真实进程恢复发生在原件 HASH 阶段，没有覆盖视觉纯计算阶段重启。SIGKILL 瞬间未提交尾片的物理读取未跟踪；`retryReadBytes=0` 不能证明零物理重读，只能确认持久计数没有重复累计。

轻量审计：[release-validation.json](./evidence/visual-search-v2/release-validation.json)。完整私有证据位于 `/private/tmp/pixishelf-visual-search-v2-20261029/evidence/release-worker/`；浏览器记录为同临时目录下 `evidence/browser/release-browser.md`。迁移前检查点保存在同临时目录的 `release-checkpoint-before-main-migrations/`（dump 可读，未声称恢复演练通过）；不提交连接配置、账户、绝对媒体路径或原件哈希。
