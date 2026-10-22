---
status: current
scope: 容器构建资产、源码/产物边界与挂载约定
last-verified: 2026-10-22
sources:
  - build/Dockerfile
  - build/worker.Dockerfile
  - build/entrypoint.sh
  - build/docker-compose.dev.yml
  - build/docker-compose.deploy.yml
---

# 容器构建资产

本目录维护 App/Worker 镜像、Compose 与环境模板。启动与升级只维护在[部署基线](../docs/operations/deployment.md)，本地准备见[根 README](../README.md#本地开发)，镜像发布见[GitHub 工作流](../.github/README.md)。

## 文件与职责

| 资产                        | 用途                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `Dockerfile`                | Next.js standalone App；直接编译 workspace 源码，交付版本化 WebP 资源与 Prisma 维护工具 |
| `worker.Dockerfile`         | 独立 DB/contracts/runtime/executors/Worker 构建；不复制 Next.js 应用源码                |
| `entrypoint.sh`             | App 启动前检查迁移边界、执行 migrate deploy，再启动应用                                 |
| `docker-compose.dev.yml`    | 本地依赖与 Worker 构建；App 在宿主机开发，scheduler 按 profile 启用                     |
| `docker-compose.deploy.yml` | 预构建 App/Worker 生产拓扑                                                              |
| `.env.example` / `init.sql` | 配置模板 / PostgreSQL 初始化辅助；完整 Schema 仍来自 migration 链                       |

App 不依赖宿主机 job 包 `dist`；Worker 独立构建三个 job 包的 dist/类型声明并验证依赖顺序。WebP C/WASM 预编译产物随仓库提供，普通 dev/build 只验证与打包，原生重建走专用流程。

App 版本参数在依赖安装、源码复制和 Prisma generate 后紧邻 Next build 注入；版本号变化不单独使依赖层失效。构建缓存命中和显示版本应分别核验，不预先承诺节省比例。

## 挂载与运行边界

| 宿主机配置                   | 容器路径                                                                             | App                | Worker | ImgProxy |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------ | ------ | -------- |
| `PIXISHELF_DATA_PATH`        | App/Worker `/app/data`；ImgProxy `/mnt/pixishelf/media`                              | 默认 ro，可配置 rw | rw     | ro       |
| `DERIVED_MEDIA_HOST_PATH`    | App/Worker `/app/.local-data/derived-media`；ImgProxy `/mnt/pixishelf/derived-media` | rw                 | rw     | ro       |
| `PIXISHELF_PUBLIC_DATA_PATH` | `/app/pixiv-data`                                                                    | ro                 | rw     | 不挂载   |

Pixiv data 不进入 Next `public`。Worker 以 UID/GID 1001 运行，预检 Schema、根目录读写、FFmpeg/FFprobe 后才 READY；它不执行 migration。两个 lane 共用容器挂载，各自单任务，数据库 lease/执行索引兜底；这不是容器权限隔离。

Worker 启动即消费，维护须停止进程。当前没有旧 archive-worker 或 Dispatcher 消费开关；能力以目标 [`production-capabilities.ts`](../packages/pixishelf-worker/src/production-capabilities.ts) 与 capability audit 为准，不在多个 README 复制数量。

事务等待/执行上限、lease、扫描排除目录、探测并发等精确配置以 `.env.example` 和 Compose 为准。事务超时必须小于任务 lease；下载、探测与 FFmpeg 不放长事务。归档媒体内部并发来自数据库 Setting，不属于 Compose 环境变量。

## 单独构建与配置核对

在仓库根目录：

```bash
docker build -f build/Dockerfile --target production -t pixishelf .
docker build -f build/worker.Dockerfile --target production -t pixishelf-worker .
docker compose --env-file build/.env.example -f build/docker-compose.dev.yml config --services
docker compose --env-file build/.env.example -f build/docker-compose.deploy.yml config --services
```

此处构建不等于部署或消费授权。真实挂载、数据库迁移和 READY/capability 冒烟按[部署基线](../docs/operations/deployment.md)执行；镜像回退的数据兼容性按[备份恢复](../docs/operations/backup-and-recovery.md)判断。
