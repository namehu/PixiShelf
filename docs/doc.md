# PixiShelf - 项目计划与架构设计 V1.2

---

## 1. 产品愿景与目标

**产品愿景:** 将用户本地存储的、按文件夹组织的静态图片收藏，转变为一个动态、美观、易于导航和管理的现代化个人Web画廊。

---

## 2. 技术选型 (Technology Stack)

| 分层 | 技术 | 备注 |
| :--- | :--- | :--- |
| **项目管理** | `pnpm workspace` | 高效的 Monorepo (单体仓库) 依赖管理方案。 |
| **代码质量** | `ESLint`/`Oxlint`, `Prettier`, `Husky` | 保证代码风格统一和提交前质量检查。 |
| **前端** | `React` + `Vite` + `TypeScript` | 现代、高效的Web用户界面开发套件。 |
| | `TanStack Query` | 优雅地处理数据获取、缓存和状态同步。 |
| | `Tailwind CSS` | 实现高度定制化和响应式的UI设计。 |
| **后端** | `Node.js` + `Fastify` + `TypeScript` | 高性能的Web框架，结合TS保证代码健壮性。 |
| | `Prisma` | 下一代ORM，简化与PostgreSQL的交互。 |
| **数据库** | `PostgreSQL` | 功能强大，支持全文索引等高级功能。 |
| **部署** | `Docker` & `Docker Compose` | 实现环境一致性，一键化部署和管理。 |

---

## 3. 架构设计 (细化)

### 3.1 Monorepo 目录结构 (Refined)

*(增加 `.github` 用于 CI/CD)*
```plaintext
pixishelf/
├── .github/
│   └── workflows/           # CI/CD 工作流 (e.g., lint, test, build)
├── .husky/                  # Git hooks 配置
├── docker-compose.yml
├── Dockerfile
├── pnpm-workspace.yaml
└── packages/
    ├── api/
    ├── web/
    └── shared/
```

### 3.2 数据库表结构设计 (Refined)

*(补充索引建议)*
```prisma
// file: packages/api/prisma/schema.prisma
// ...
model Artwork {
  // ...
  title       String
  description String?
  tags        String[]

  // 为全文搜索准备
  @@index([title, description]) // B-Tree 索引用于常规搜索
  // @@fulltext([title, description]) // Prisma 5.x+ 支持的全文索引
}
// ...
```
**说明:** `Artwork` 表的 `tags`, `title`, `description` 字段将使用 PostgreSQL 的 GIN 或 Trigram 索引来实现高效的全文搜索。

---

## 4. 核心服务与API设计

### 4.1 文件扫描与任务调度
* **V1.0 (手动与定时):** 后端提供一个 API (`POST /api/v1/scan`) 用于手动触发扫描。同时，使用 `node-cron` 在后端服务中嵌入一个可配置的定时扫描任务。
* **V2.0 (专业任务队列):** 引入 `BullMQ` 和 `Redis`，将扫描任务作为后台作业处理。这能提供任务重试、状态跟踪和更好的系统解耦。

### 4.2 API 规范与设计 (V1.0)
* **版本化:** 所有API路径将以 `/api/v1/` 开头，为未来的API迭代做准备。
* **文档化:** 使用 `fastify-swagger` 插件，根据代码和JSDoc注解自动生成并托管 OpenAPI (Swagger) 文档。

| 方法 | 路径 | 描述 |
| :--- | :--- | :--- |
| `POST` | `/api/v1/scan` | 手动触发一次文件扫描任务 |
| `GET` | `/api/v1/artworks` | 获取作品分页列表 |
| `GET` | `/api/v1/artworks/:id` | 获取单个作品及其图片列表 |
| `GET` | `/api/v1/artists` | 获取所有作者列表 |
| `GET` | `/api/v1/images/*` | 获取图片文件 |

### 4.3 性能与可扩展性
* **图片处理 (V1.x):** 引入 `sharp` 库。在首次扫描或访问时，为原始图片生成不同尺寸的缩略图 (e.g., `thumbnail`, `medium`) 并缓存到本地文件系统。API (`/api/v1/images/*`) 将支持 `?size=` 参数来获取相应尺寸。
* **上传支持 (V2.0):** 未来若支持上传功能，将考虑实现分片上传与断点续传。

---

## 5. 部署与运维 (Production Readiness)

### 5.1 部署架构 (Refined)
在生产环境中，推荐使用 `Nginx` 作为反向代理，部署在 `api-server` 前端。
* **Nginx 职责:**
    * 处理 SSL 证书。
    * 作为前端静态文件 (`web` 包构建产物) 的高效服务器。
    * 将 `/api` 请求反向代理到后端的 `api-server` 服务。
    * 可以配置缓存策略和速率限制。

### 5.2 配置与环境管理
* 项目根目录将提供 `.env.example` 文件，清晰列出所有必需的环境变量 (数据库连接信息, `API_PORT`, `JWT_SECRET`, 扫描路径等)。

### 5.3 备份与恢复
* **V1.0 (手动):** 在 `README` 中提供使用 `pg_dump` 手动备份数据库的命令指南。
* **V2.0 (自动):** 在 `docker-compose` 中增加一个 `backup` 服务，使用 `postgres` 客户端镜像和 `cron` 定期执行 `pg_dump`，并将备份文件存储到挂载的卷或云存储。

---

## 6. 系统质量与安全保障

### 6.1 认证与安全
* **V1.0 (基础安全):**
    * **CORS:** 在Fastify中配置严格的跨域资源共享策略。
    * **API 认证:** 提供一个简单的、基于环境变量配置的 `Bearer Token`，所有非公开API请求都需要携带此令牌。
    * **图片防盗链:** 基础实现可通过校验HTTP `Referer` 头来完成。
* **V1.x (用户账户体系):**
    * 引入本地用户账户（用户名+密码），使用 `bcrypt` 存储密码哈希。
    * 通过 `JWT` (JSON Web Tokens) 管理用户会话。
    * 增加 CSRF 保护措施。

### 6.2 错误处理与日志
* **错误处理:** API将遵循统一的错误响应结构，例如 `{ "statusCode": 404, "error": "Not Found", "message": "Artwork not found" }`。
* **日志:** 使用 `pino` (Fastify默认) 进行日志记录。日志将以JSON格式输出，并分级 (info, warn, error)，便于后续日志系统（如ELK Stack）的采集与分析。

### 6.3 CI/CD 与代码质量
* **代码质量 (V1.0):** 使用 `ESLint`/`Oxlint` + `Prettier` 强制代码规范，并配置 `husky` + `lint-staged` 在每次 `git commit` 前自动检查和格式化代码。
* **持续集成 (V1.x):** 创建 GitHub Actions 工作流，在 `push` 或 `pull_request` 时自动执行：`pnpm install` -> `lint` -> `type-check` -> `test` -> `build`。

---

## 7. 开发路线图 (更新)

### 阶段一: 项目初始化与环境搭建 (V1.0)
* [✔] 构思项目名称并细化架构设计。
* [✔] 初始化 `pnpm` monorepo，包含 `api`, `web`, `shared`。
* [✔] 配置 `ESLint`, `Prettier`, `Husky`。
* [✔] 添加 `MIT` 许可证和 `CONTRIBUTING.md` 模板。
* [✔] 编写 `docker-compose.yml`，运行 `postgres-db` 服务。
* [✔] 在 `api` 包中配置 `Prisma`，定义 `schema.prisma` 并成功连接数据库。

### 阶段二: 后端核心功能 (V1.0)
* [✔] 实现文件扫描服务 (`scanner.ts`) 及手动触发API。
* [✔] 实现所有版本化的 (`/api/v1/...`) 核心API。
* [✔] 实现安全的图片服务路由。
* [✔] 集成基础的日志和错误处理机制。
* [✔] 实现基于环境变量的API令牌认证。

### 阶段三: 前端核心功能 (V1.0)
* [ ] 开发主画廊页和作品详情页。
* [ ] 实现骨架屏 (Skeleton) 加载效果和图片懒加载。
* [ ] 完成基础的响应式设计。
* [ ] 接入后端API，完成数据联调。
* [ ] 实现用户登录与注册功能。
* [ ] 实现用户认证与授权。
* [ ] (可选) 增加 i18n 基础框架 (`react-i18next`)。

### 后续里程碑 (V1.x / V2.0)
* **增强:** 全文搜索、缩略图生成、用户账户体系、Swagger文档。
* **运维:** 自动化CI/CD流程、数据库自动备份、引入任务队列。
* **监控:** 集成 Prometheus + Grafana 进行应用监控。
