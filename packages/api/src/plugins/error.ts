import { FastifyInstance } from 'fastify'

export async function errorPlugin(server: FastifyInstance) {
  server.setErrorHandler((error, _req, reply) => {
    const statusCode = (error as any).statusCode || 500
    const message = error.message || 'Internal Server Error'
    server.log.error({ err: error }, 'Request failed')
    reply.code(statusCode).send({ statusCode, error: statusCode === 500 ? 'Internal Server Error' : 'Bad Request', message })
  })
}