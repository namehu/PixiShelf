import { assertMobileAccount, mobileRoute } from '@/lib/mobile/http'
import { MobileId, MobileMediaQuery } from '@/schemas/mobile.dto'
import { openMobileMedia } from '@/services/mobile-media-service'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return mobileRoute(request, async (userId) => {
    const input = MobileMediaQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
    assertMobileAccount(userId, input.expectedUserId)
    return openMobileMedia(
      MobileId.parse((await context.params).id),
      input.revision,
      input.variant,
      request.headers.get('range')
    )
  })
}
