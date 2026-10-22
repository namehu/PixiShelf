---
status: current
scope: 仓库维护脚本的实际入口与副作用
last-verified: 2026-10-22
sources:
  - scripts/update-production.sh
  - scripts/auto-sort-year.js
  - scripts/config.json
  - scripts/check-docs.mjs
  - package.json
---

# 维护脚本

| 脚本                   | 用途                     | 副作用与前提                                                   |
| ---------------------- | ------------------------ | -------------------------------------------------------------- |
| `update-production.sh` | 成对更新生产 App/Worker  | 拉取/停止/重建容器、迁移和恢复原调度；必须先完成专用门禁与备份 |
| `auto-sort-year.js`    | 按文件名日期分目录       | 正式模式移动文件，dry-run 仍写日志；不更新 PixiShelf 数据库    |
| `check-docs.mjs`       | 文档路径、锚点与围栏检查 | 只读检查，不更新图示产物                                       |

## 文档维护

在仓库根执行：

```bash
pnpm docs:check
pnpm docs:diagrams
pnpm docs:diagrams:check
```

分别检查文档路径/锚点/围栏、由 `.mmd` 生成 SVG、校验渲染与图源哈希。图示命令委托 `packages/pixishelf-webp-player/scripts/render-diagrams.mjs`。修改图源后生成对应 SVG，不手改生成图；依赖与命令定义以根 package 和脚本为准。

## 生产更新

```bash
sudo bash ./scripts/update-production.sh \
  --compose-file build/docker-compose.deploy.yml --env-file build/.env
```

脚本默认拉取镜像，`--no-pull` 使用已有镜像；`--force` 只允许中断执行中任务，不绕过审计或备份。`PIXISHELF_PRE_UPDATE_HOOK` 指定停写后、启动 App 前的可执行检查点脚本；未配置时不会自动备份。精确参数使用 `bash scripts/update-production.sh --help`，操作依据见[部署基线](../docs/operations/deployment.md)。不要把首次删列/双 lane 切换直接当日常升级。

## 文件日期整理

仓库实际提供 Node.js 脚本，不存在 `AutoSort_Year.ps1` 或对应 Pester 测试。先对明确目录模拟：

```powershell
node scripts/auto-sort-year.js --source "D:\Photos" --dest "D:\Archive" --dry-run
```

| 参数                 | 默认/语义                                 |
| -------------------- | ----------------------------------------- |
| `--source` / `-s`    | 当前目录，只扫描直接子文件，不递归        |
| `--dest` / `-d`      | 源目录；移动到 `<dest>/<date>/<原文件名>` |
| `--config` / `-c`    | 脚本旁 `config.json`                      |
| `--dry-run`          | 仅报告移动；日志仍写入                    |
| `--log-level` / `-l` | Info；支持 Debug/Warning/Error            |

只使用 `Rules[0].Regex` 的命名组 `date`，当前配置在文件名任意位置匹配 `MM.dd`；`DateFormat`、后续规则和 Cache 字段未被实现读取。没有哈希缓存或增量验证。目标同名文件跳过，移动使用 `renameSync`，跨卷可能失败；文件名匹配内容不会经过日期有效性验证。

日志位置由 `Logging.LogFile` 相对配置目录确定，默认 `AutoSort.log`，当前滚动上限固定 10 MB；配置中的 MaxLogSizeMB 不控制实现。不要将此工具直接作用于已入库收藏根，它不维护数据库路径；批量移动前核对目标、备份与[恢复基线](../docs/operations/backup-and-recovery.md)。
