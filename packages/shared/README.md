# @pixishelf/shared

这个包包含了 PixiShelf 项目中前后端共享的类型定义、常量和工具类型。

## 📁 项目结构

```
src/
├── types/
│   ├── core.ts        # 核心数据模型（Artist, Artwork, Image, Tag, User）
│   ├── api.ts         # API 请求/响应类型
│   ├── auth.ts        # 认证相关类型
│   ├── scan.ts        # 扫描相关类型
│   ├── settings.ts    # 设置相关类型
│   ├── system.ts      # 系统状态类型
│   └── utils.ts       # 工具类型
├── constants/
│   └── index.ts       # 常量定义
└── index.ts           # 主入口文件
```

## 🎯 核心数据模型

### 从 `types/core.ts` 导出：
- `Artist` - 艺术家信息
- `Artwork` - 作品信息
- `Image` - 图片信息
- `Tag` - 标签信息
- `User` - 用户信息

### 从 `types/api.ts` 导出：
- `PaginationQuery` - 分页查询参数
- `PaginatedResponse<T>` - 通用分页响应
- `ArtworksResponse` - 作品列表响应
- `ArtistsResponse` - 艺术家列表响应
- `UsersResponse` - 用户列表响应
- `ErrorResponse` - 错误响应

### 从 `types/auth.ts` 导出：
- `LoginRequest/Response` - 登录相关类型
- `CreateUserRequest/Response` - 创建用户类型

### 从 `types/scan.ts` 导出：
- `ScanRequest/Result/Progress` - 扫描相关类型
- `ScanStatusResponse` - 扫描状态响应
- `LogEntry` - SSE 日志条目

### 从 `types/settings.ts` 导出：
- `ScanPathRequest/Response` - 扫描路径设置
- `SettingsUpdateResponse` - 设置更新响应

### 从 `types/system.ts` 导出：
- `HealthResponse` - 健康检查响应
- `AppState` - 应用状态

### 从 `types/utils.ts` 导出：
- `Optional<T, K>` - 可选字段类型
- `CreateType<T>` - 创建类型（排除 id 和时间戳）
- `UpdateType<T>` - 更新类型

### 从 `constants/index.ts` 导出：
- `SCAN_PHASES` - 扫描阶段常量
- `SSE_EVENT_TYPES` - SSE 事件类型常量
- `HTTP_STATUS` - HTTP 状态码常量
- `API_PATHS` - API 路径常量

## 🚀 使用示例

### 在 API 包中使用

```typescript
import { 
  Artwork, 
  ArtworksResponse, 
  PaginationQuery,
  API_PATHS,
  HTTP_STATUS 
} from '@pixishelf/shared'

// 在路由处理器中使用
server.get('/api/v1/artworks', async (req, reply) => {
  const query = req.query as PaginationQuery
  
  // ... 业务逻辑
  
  const response: ArtworksResponse = {
    items: artworks,
    total: count,
    page: parseInt(query.page || '1'),
    pageSize: parseInt(query.pageSize || '20')
  }
  
  return reply.code(HTTP_STATUS.OK).send(response)
})
```

### 在 Web 包中使用

```typescript
import { 
  Artwork, 
  ArtworksResponse, 
  LoginRequest,
  API_PATHS 
} from '@pixishelf/shared'

// 在 React 组件中使用
function useArtworks() {
  return useQuery({
    queryKey: ['artworks'],
    queryFn: async (): Promise<ArtworksResponse> => {
      const response = await fetch(API_PATHS.ARTWORKS)
      return response.json()
    }
  })
}

// 在 API 调用中使用
const login = async (credentials: LoginRequest) => {
  const response = await fetch(API_PATHS.AUTH_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  })
  return response.json()
}
```

### 按模块导入

```typescript
// 只导入核心数据模型
import { Artist, Artwork } from '@pixishelf/shared'

// 只导入 API 相关类型
import { ArtworksResponse, PaginatedResponse } from '@pixishelf/shared'

// 只导入常量
import { API_PATHS, HTTP_STATUS } from '@pixishelf/shared'
```

## 🔧 构建

```bash
# 构建类型定义
pnpm build

# 开发模式（监听文件变化）
pnpm dev

# 类型检查
pnpm type-check

# 代码检查
pnpm lint
```

## ✨ 架构优势

### 模块化设计
- **按功能分类**: 类型按功能模块分离，便于维护和查找
- **清晰的依赖关系**: 核心类型独立，其他模块按需引用
- **渐进式导入**: 支持按需导入，减少不必要的类型加载

### 类型安全
- **统一数据结构**: 前后端使用相同的类型定义
- **编译时检查**: TypeScript 严格模式，确保类型安全
- **完整的类型覆盖**: 涵盖所有 API 接口和数据模型

### 开发体验
- **智能提示**: 完整的 TypeScript 类型提示和自动补全
- **API 路径常量**: 避免硬编码，减少拼写错误
- **一致的命名规范**: 统一的接口命名和数据结构

## 📋 迁移完成状态

### ✅ 已完成的迁移

**API 包**:
- ✅ `src/types/index.ts` - 使用共享类型，保留 Fastify 扩展
- ✅ `src/routes/artworks.ts` - 使用 `ArtworksResponse` 和 `Artwork`
- ✅ `src/routes/auth.ts` - 使用 `LoginRequest` 和 `LoginResponse`
- ✅ `src/routes/settings.ts` - 使用设置相关类型
- ✅ `src/routes/users.ts` - 使用用户相关类型
- ✅ `src/routes/health.ts` - 使用 `HealthResponse`
- ✅ `src/routes/artists.ts` - 使用 `ArtistsResponse`

**Web 包**:
- ✅ `src/pages/Settings.tsx` - 使用共享类型和 `API_PATHS`
- ✅ `src/pages/Gallery.tsx` - 使用 `ArtworksResponse` 和 `API_PATHS`
- ✅ `src/pages/ArtworkDetail.tsx` - 使用 `Artwork` 和 `API_PATHS`
- ✅ `src/pages/Users.tsx` - 使用 `UsersResponse` 和相关类型

## 🎉 迁移收益

- ✅ **类型一致性**: 前后端使用相同的数据结构定义
- ✅ **代码复用**: 减少重复的类型定义
- ✅ **维护便利**: 集中管理类型，便于后续修改
- ✅ **开发效率**: 提供完整的类型提示和自动补全
- ✅ **错误预防**: 编译时发现类型不匹配问题
- ✅ **模块化架构**: 按功能分离，便于维护和扩展