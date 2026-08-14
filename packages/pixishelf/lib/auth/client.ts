import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  // 如需覆盖客户端认证行为，在此集中传入配置。
})

export const { signIn, signOut, useSession, signUp } = authClient
