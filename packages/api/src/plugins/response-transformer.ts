import { FastifyInstance, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { transformDates } from '../utils/response-transformer'

/**
 * Fastify 插件：自动转换响应中的日期格式
 * 这个插件会拦截所有的 JSON 响应，自动将 Date 对象转换为 ISO 字符串
 */
async function responseTransformerPlugin(fastify: FastifyInstance) {
  // 添加响应钩子，在发送响应前自动转换日期
  fastify.addHook('preSerialization', async (request, reply, payload) => {
    // 只处理对象类型的响应
    if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      return transformDates(payload)
    }
    return payload
  })

  // 为 FastifyReply 添加便捷方法
  fastify.decorateReply('sendTransformed', function (this: FastifyReply, data: any) {
    return this.send(transformDates(data))
  })
}

// 扩展 FastifyReply 类型
declare module 'fastify' {
  interface FastifyReply {
    sendTransformed(data: any): FastifyReply
  }
}

export default fp(responseTransformerPlugin, {
  name: 'response-transformer'
})