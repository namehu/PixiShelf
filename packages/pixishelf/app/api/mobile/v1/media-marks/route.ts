import { assertMobileAccount, mobileBody, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { MobileMarksQuery } from '@/schemas/mobile.dto'
import { MediaMarkSetInput } from '@/schemas/media-mark.dto'
import { getMediaMarks, setMediaMark } from '@/services/media-mark-service'

export async function GET(request: Request) {
  return mobileRoute(request, async (userId) => {
    const input = MobileMarksQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await getMediaMarks(userId, input.artworkId, input.mediaIds))
  })
}

export async function PUT(request: Request) {
  return mobileRoute(request, async (userId) => {
    const input = MediaMarkSetInput.parse(await mobileBody(request))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await setMediaMark(userId, input.artworkId, input.mediaId, input.kind, input.value))
  })
}
