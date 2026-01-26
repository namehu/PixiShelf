# ProDataTable 组件

基于 `shadcn/ui` 和 `@tanstack/react-table` 封装的高级表格组件，复刻了 Ant Design Pro Table 的核心 API (`request` 属性)，实现了**配置即业务**的数据加载模式。

## ✨ 特性

- **自动管理 Loading**: 不需要手动维护 `isLoading` 状态。
- **Request 驱动**: 传入 `request` Promise 函数，组件自动处理分页参数、数据回填。
- **服务端分页**: 默认开启 Manual Pagination 模式，完美对接后端 API。
- **类型安全**: 完整的 TypeScript 类型定义。
- **ActionRef**: 提供 `reload` 和 `reset` 方法供父组件调用。

## 📦 依赖

确保你的项目中安装了以下依赖：

```bash
npm install @tanstack/react-table lucide-react
# 以及 shadcn 的 table, button, select, input 组件
```

## 🔨 基础用法

```ts
import { ProDataTable } from "@/components/pro-data-table"

// ... 列定义 columns ...

<ProDataTable
  columns={columns}
  request={async (params) => {
    // params 包含: { current: 1, pageSize: 10 }
    const res = await fetch(`/api/users?page=${params.current}`);
    const json = await res.json();

    return {
      data: json.list,
      success: true,
      total: json.total
    }
  }}
/>
```

## 🚀 进阶：Next.js + tRPC 集成

在 tRPC 架构中，推荐使用 trpc.useUtils().client 在 request 中发起请求，这样既能利用 tRPC 的类型推导，又能保持 ProTable 的控制反转特性。

```ts
const utils = trpc.useUtils();

<ProDataTable
  request={async (params) => {
    // 直接调用 tRPC 查询过程
    const data = await utils.client.yourRouter.list.query({
      page: params.current,
      limit: params.pageSize
    });

    return {
      data: data.items,
      success: true,
      total: data.total
    };
  }}
/>
```


## ⚙️ API

ProDataTableProps

| 属性 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| columns | 表格列定义 (TanStack Table) | ColumnDef[] | - |
| request | 获取数据的异步方法 | `(params, sort, filter) => Promise<RequestData>` | - |
| toolBarRender | 表格右上角工具栏渲染函数 | `() => ReactNode` | - |
| actionRef | 获取表格操作实例的 ref | `MutableRefObject<ActionType>` | - |
| defaultPageSize | 默认每页显示条数 | number | 10 |

ActionType (actionRef)

| 方法 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| reload | 刷新当前页数据 (保留分页状态) | - | - |
| reset | 重置所有状态 (页码归零、清空筛选排序) 并重新请求 | - | - |
