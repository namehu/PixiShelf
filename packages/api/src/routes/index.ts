import { FastifyInstance } from 'fastify'
import healthRoutes from './health'
import settingsRoutes from './settings'
import scanRoutes from './scan'
import artworksRoutes from './artworks'
import artistsRoutes from './artists'
import imagesRoutes from './images'
import authRoutes from './auth'
import usersRoutes from './users'
import suggestionsRoutes from './suggestions'

export default async function registerRoutes(server: FastifyInstance) {
  await healthRoutes(server)
  await authRoutes(server)
  await settingsRoutes(server)
  await scanRoutes(server)
  await artworksRoutes(server)
  await artistsRoutes(server)
  await imagesRoutes(server)
  await usersRoutes(server)
  await suggestionsRoutes(server)
}