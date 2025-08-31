# Dev Container 配置

这个配置提供了一个完整的 Node.js 22 开发环境，用于 Artisan Shelf 项目开发。

## 功能特性

- **基础镜像**: Node.js 22
- **端口映射**: 
  - 3000 (前端服务)
  - 3001 (后端API)
- **数据挂载**: 宿主机 `C:\Users\pc\Downloads\pixiv` → 容器 `/app/data`
- **预装工具**: pnpm, TypeScript, ts-node, nodemon
- **VS Code 扩展**: TypeScript, Prettier, Tailwind CSS, ESLint, Prisma

## 使用方法

1. 确保已安装 Docker 和 VS Code Dev Containers 扩展
2. 在 VS Code 中打开项目
3. 按 `Ctrl+Shift+P` 打开命令面板
4. 选择 "Dev Containers: Reopen in Container"
5. 等待容器构建和配置完成

## 目录结构

- `/workspace` - 项目工作目录（挂载宿主机项目目录）
- `/app/data` - 数据目录（挂载宿主机pixiv下载目录）

## 注意事项

- 容器使用 `node` 用户运行，确保文件权限正确
- 首次启动会自动安装项目依赖
- 端口转发会自动配置，可直接访问 localhost:3000 和 localhost:3001