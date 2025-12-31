import { apiHandler, responseSuccess } from '@/lib/api-handler'
import { sessionManager } from '@/lib/session'
import { ERROR_MESSAGES } from '@/lib/constants'
import { ApiError } from '@/lib/errors'
import { validateCredentials } from '@/services/user-service'
import { AuthLoginRequestDTO, AuthLoginResponseDTO } from '@/schemas/auth.dto'

/**
 * 处理用户登录请求
 * POST /api/auth/login
 */
export const POST = apiHandler(AuthLoginRequestDTO, async (request, data) => {
  const { username, password } = data

  // 验证用户凭据
  const user = await validateCredentials(username, password)
  if (!user) {
    throw new ApiError(ERROR_MESSAGES.LOGIN_FAILED, 401)
  }

  // 创建会话
  const session = await sessionManager.createSession(user)

  const response = responseSuccess({ data: AuthLoginResponseDTO.parse({ id: user.id }) })

  // 设置认证Cookie
  const cookieOptions = sessionManager.getCookieOptionsForRequest(request)
  response.cookies.set('auth-token', session.token, {
    httpOnly: cookieOptions.httpOnly,
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
    maxAge: cookieOptions.maxAge,
    path: cookieOptions.path
  })

  return response
})
