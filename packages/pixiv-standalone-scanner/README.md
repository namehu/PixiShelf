# @pixishelf/standalone-scanner

一个极简的 HTTP 服务，用于扫描指定目录下所有以 `-meta.txt` 结尾的 Pixiv 元数据文件，并通过 API 返回其相对路径列表。服务内置缓存与过期刷新逻辑，适合在容器中与主数据目录进行只读挂载使用。

## 特性

- 使用系统 `find` 命令扫描目标目录中的 `*-meta.txt` 文件（跟随软链接 `-L`）。
- 返回相对于 `SCAN_DIRECTORY` 的文件路径，便于上层系统拼接与访问。
- 内置内存缓存：首启时同步扫描，之后按过期时间异步刷新。
- 简单 REST API，便于集成。
- 提供 Dockerfile，推荐以容器方式运行（Alpine 镜像自带 `find`）。

## 快速开始

### 本地运行（建议使用 Docker 或 WSL2）

> 注意：服务依赖系统 `find` 命令。在原生 Windows 环境中可能不可用，建议使用 Docker 或 WSL2。

1. 安装依赖（在包目录内执行）：
   - `npm install`
   - 或使用 pnpm 工作空间：`pnpm --filter @pixishelf/standalone-scanner install`
2. 设置环境变量并启动：
   - `SCAN_DIRECTORY`：要扫描的目录（默认 `/app/data`）
   - `CACHE_DURATION_SECONDS`：缓存有效期秒数（默认 `86400`）
   - `PORT`：服务端口（默认 `3000`）
   - 启动：
     - `npm start`
     - 或：`pnpm --filter @pixishelf/standalone-scanner start`

### 使用 Docker 运行（推荐）

在 `packages/pixiv-standalone-scanner` 目录下：

```bash
docker build -t pixishelf/standalone-scanner .

docker run \
  -p 3000:3000 \
  -e SCAN_DIRECTORY=/app/data \
  -e CACHE_DURATION_SECONDS=86400 \
  -v /your/host/data:/app/data:ro \
  pixishelf/standalone-scanner
```

建议将数据目录以只读方式挂载到容器内的 `/app/data`，与默认 `SCAN_DIRECTORY` 保持一致。

## API

- `GET /metadata-files`
  - 返回当前缓存中的文件路径列表（JSON 数组）。
  - 如果缓存已过期且未在更新，服务会在后台触发一次异步刷新，但立即返回旧的缓存内容。
  - 如果缓存为空（如服务首次启动），会同步进行一次扫描后再返回数据。

- `POST /refresh`
  - 触发一次后台刷新扫描（不阻塞响应）。
  - 若正在更新中，返回 `429` 状态码：`{"message":"Cache update already in progress."}`。
  - 正常触发时返回 `202` 状态码：`{"message":"Cache refresh started in the background."}`。

### 响应示例

`GET /metadata-files`：

```json
[
  "/12345-meta.txt",
  "/illusts/67890-meta.txt"
]
```

> 提示：返回的是相对于 `SCAN_DIRECTORY` 的路径，服务会去掉前缀（例如 `/app/data/illusts/67890-meta.txt` -> `/illusts/67890-meta.txt`）。

## 配置与行为

- 环境变量：
  - `PORT`（默认 `3000`）：服务监听端口。
  - `SCAN_DIRECTORY`（默认 `/app/data`）：要扫描的根目录，必须存在且为目录。
  - `CACHE_DURATION_SECONDS`（默认 `86400`）：缓存过期时间（秒）。

- 缓存策略：
  - 首次启动：同步扫描并填充缓存。
  - 正常请求：如果缓存未过期，直接返回；过期时触发后台刷新，但仍返回旧缓存。
  - 手动刷新：通过 `POST /refresh` 触发后台刷新；并发刷新会被拒绝（429）。

- 扫描细节：
  - 使用 `find -L <SCAN_DIRECTORY> -type f -name '*-meta.txt'`。
  - 出错或 `find` 返回非 0 时，返回空数组但不中断服务。
  - 当 `SCAN_DIRECTORY` 不存在或不是目录时，首次扫描会失败且缓存保持为空。

## 使用建议

- 目录结构与命名约定：元数据文件以 `-meta.txt` 结尾，例如 `12345-meta.txt` 或 `illusts/67890-meta.txt`。
- 容器部署：优先使用 Docker；将数据目录只读挂载到 `/app/data`，保证与默认配置一致。
- 性能：`find` 会遍历整个目录树，若数据量很大建议合理规划目录层级或在上游做分区。
- 安全：该服务仅列出文件路径，不读取文件内容；请在外层网关限制访问来源与速率。

## 项目结构

- `app.js`：服务入口与核心逻辑（Express + 缓存 + 扫描）。
- `Dockerfile`：容器化构建与运行配置（Node 20 Alpine）。
- `package.json`：脚本与依赖（`express`）。

## 许可协议

遵循仓库根目录中的 `LICENSE`。