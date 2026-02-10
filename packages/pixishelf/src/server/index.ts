import { router } from './trpc'
import { authRouter } from './routers/auth'
import { settingRouter } from './routers/setting'
import { userRouter } from './routers/user'
import { artistRouter } from './routers/artist'
import { artworkRouter } from './routers/artwork'
import { searchRouter } from './routers/search'
import { tagRouter } from './routers/tag'
import { seriesRouter } from './routers/series'
import { migrationRouter } from './routers/migration'

// 挂载子路由
export const appRouter = router({
  auth: authRouter,
  setting: settingRouter,
  user: userRouter,
  artist: artistRouter,
  artwork: artworkRouter,
  search: searchRouter,
  tag: tagRouter,
  series: seriesRouter,
  migration: migrationRouter
})

// 导出类型供前端使用
export type AppRouter = typeof appRouter
