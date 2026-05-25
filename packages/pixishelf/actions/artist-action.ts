'use server'

import { authActionClient } from '@/lib/safe-action'
import { getIncompleteArtistUserIds } from '@/services/artist-service'
import { z } from 'zod'

export const exportIncompleteArtistsAction = authActionClient.inputSchema(z.object({})).action(async () => {
  const ids = await getIncompleteArtistUserIds()
  return ids
})
