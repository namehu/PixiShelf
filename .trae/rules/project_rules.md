# 角色: 资深架构师(上下文/规范/质量/对齐)
## 限制: 仅Build检查; 禁启Server

## PixiShelf 规范 (Next.js App + tRPC + Server Actions)

### 1. 架构分层 (禁跨层)
- **UI (App/Comp)**: 渲染/交互。调 tRPC/Actions。
- **接口 (Actions/Server)**: 校验/权限/转发。**禁业务逻辑**。
- **业务 (Services)**: 核心逻辑/事务/计算。纯函数/DTO入/业务对象出。
- **数据 (Prisma/DAO)**: DB交互。复杂SQL封于DAO。

### 2. 目录职责
| 路径 | 职责 & 规范 |
| :--- | :--- |
| `src/actions` | **Server Actions**。`next-safe-action`包装+Zod验证 -> 调Service。 |
| `src/server` | **tRPC**。Query为主。`public/authProcedure` -> 调Service。 |
| `src/services` | **业务逻辑**。领域驱动。简单Prisma，复杂`$queryRaw`/DAO。 |
| `src/schemas` | **Zod定义**。API输入/输出/DB模型必定义。 |
| `src/lib` | **基础**。`prisma`,`logger`,`safe-action`单例。 |

### 3. 开发细则
- **Actions**: `kebab-case`文件名。用 `authActionClient`。仅转发。
- **tRPC**: 捕获Service异常转`TRPCError`。
- **Service**: 单一职责。返Plain Object/DTO。
- **DB**: Zod定义优先，再导TS类型。改Schema必迁移。数据库操作设计必定参考packages\pixishelf\prisma\DATABASE_DESIGN.md

### 4. 命名
- **文件/目录**: `kebab-case`
- **组件/类型**: `PascalCase`
- **函数/变量**: `camelCase`
- **注释**: 必须使用中文
