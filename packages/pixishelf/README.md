# PixiShelf

PixiShelf 是一个自托管的 Pixiv 本地图片管理与浏览系统。它允许你扫描本地存储的 Pixiv 图片（支持通过 Powerful Pixiv Downloader 等工具下载的目录结构），并提供现代化的 Web 界面进行浏览、搜索、标签管理和数据统计。

## 🛠 技术栈

- **前端**: [Next.js 15](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/)
- **状态管理**: [Zustand](https://github.com/pmndrs/zustand), [TanStack Query](https://tanstack.com/query)
- **后端**: Next.js Server Actions / API Routes
- **数据库**: [Prisma](https://www.prisma.io/) (PostgreSQL)
- **工具库**: [Zod](https://zod.dev/) (验证), [Winston](https://github.com/winstonjs/winston) (日志), [Day.js](https://day.js.org/) (时间处理)

## 📂 项目结构

```plain
src/
├── app/
│   ├── api/
│   │   └── auth/
│   │       └── route.ts      <-- 只负责解析 Request，调用 server/services
│   └── dashboard/
│       └── page.tsx          <-- 页面
├── server/                   <-- 【新增】专门存放后端逻辑
│   ├── services/             <-- 业务逻辑 (UserService.ts)
│   └── db.ts                 <-- (可选) 数据库访问层封装
├── services/                 <-- 【前端】API 请求封装 (ApiClient)
│   └── auth-client.ts        <-- 前端 fetch('/api/auth')
├── lib/
│   ├── prisma.ts             <-- Prisma 单例
│   └── redis.ts              <-- Redis 配置
├── utils/
│   ├── formatting.ts         <-- 纯函数
│   └── validators.ts         <-- Zod Schemas (前后端公用)
├── types/
│   └── api-responses.ts      <-- 前后端公用的 API 返回类型定义
└── components/
```

## 🚀 快速开始

### 前置要求

- **Node.js**: v20 或更高版本
- **PostgreSQL**: 需要安装并运行 PostgreSQL 数据库（建议启用 `pg_trgm` 扩展以支持模糊搜索）
- **包管理器**: 推荐使用 pnpm, npm 或 yarn

### 配置环境变量

在项目根目录下创建 `.env` 文件，并配置以下变量：

```env
# 数据库连接字符串
DATABASE_URL="postgresql://user:password@localhost:5432/pixishelf?schema=public"

# JWT 密钥 (生产环境请务必修改)
JWT_SECRET="your-secret-key-at-least-32-chars"

# Node 环境
NODE_ENV="development"
```

### 4. 数据库初始化

运行 Prisma 迁移以创建数据库表结构：

```bash
npm run db:migrate
```

### 5. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:5430](http://localhost:5430) 查看应用。

## 📜 常用脚本

- `npm run dev`: 启动开发服务器 (端口 5430)。
- `npm run build`: 构建生产版本。
- `npm run start`: 启动生产服务器。
- `npm run db:migrate`: 执行数据库迁移。
- `npm run db:generate`: 生成 Prisma 客户端代码。
- `npm run db:studio`: 打开 Prisma Studio 可视化管理数据库。
- `npm run lint`: 运行 ESLint 代码检查。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 📄 许可证

[MIT](LICENSE)
