import dotenv from 'dotenv'
import { buildServer } from './app'

dotenv.config()

const start = async () => {
  const server = await buildServer()
  const port = Number(process.env.API_PORT || process.env.PORT || 3002)
  const host = process.env.HOST || '0.0.0.0'
  server
    .listen({ port, host })
    .then((address) => {
      server.log.info(`Server listening at ${address}`)
    })
    .catch((err) => {
      server.log.error(err)
      process.exit(1)
    })
}

start()