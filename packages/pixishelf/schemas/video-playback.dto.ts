import { z } from 'zod'

const mediaUrl = z.string().regex(/^\/api\/v1\/media\/\d+\/playback\?(?:generation=[a-f0-9-]+|original=[a-f0-9]+)$/)
export const VideoPlaybackSourceDto = z.discriminatedUnion('status', [
  z.object({ status: z.literal('READY'), originalUrl: mediaUrl, playbackUrl: mediaUrl.nullable() }),
  z.object({ status: z.enum(['MISSING', 'WRITING', 'CHANGED']), originalUrl: z.null(), playbackUrl: z.null() })
])
