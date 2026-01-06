import { router } from './trpc'
import { authRouter } from './routers/auth'
import { settingRouter } from './routers/setting'

export const appRouter = router({
  auth: authRouter, // 挂载子路由
  setting: settingRouter
})

// 导出类型供前端使用（最关键的一步）
export type AppRouter = typeof appRouter
