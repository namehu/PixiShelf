import { createUserResponseDTO, createUserSchema, getUsersResponseDTO } from '@/schemas/users.dto'
import { authProcedure, router } from '@/server/trpc'
import { addUser, deleteUser, queryUsers } from '@/services/user-service'
import z from 'zod'

export const userRouter = router({
  /**
   * 获取当前用户信息
   */
  queryUsers: authProcedure.query(async () => {
    const users = await queryUsers()
    return getUsersResponseDTO.parse(users)
  }),

  /**
   * 添加用户
   */
  addUser: authProcedure.input(createUserSchema).mutation(async ({ input }) => {
    const { username, password } = input
    const user = await addUser(username, password)
    return createUserResponseDTO.parse(user)
  }),

  /**
   * 删除用户
   */
  deleteUser: authProcedure
    .input(z.number({ error: '用户ID必须是数字' }).int('用户ID必须是整数').positive('用户ID必须是正数'))
    .mutation(async ({ ctx: { userId }, input }) => {
      // 防止删除自己
      if (userId === input) {
        throw new Error('Cannot delete yourself')
      }
      await deleteUser(input)
    })
})
