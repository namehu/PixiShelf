import { router } from './trpc'
import { authRouter } from './routers/auth'
import { settingRouter } from './routers/setting'
import { userRouter } from './routers/user'
import { artistRouter } from './routers/artist'

// 挂载子路由
export const appRouter = router({
  auth: authRouter,
  setting: settingRouter,
  user: userRouter,
  artist: artistRouter
})

// 导出类型供前端使用
export type AppRouter = typeof appRouter
