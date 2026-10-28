import { assertMobileAccount, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { MobileFeedQuery } from '@/schemas/mobile.dto'
import { mobileFeed } from '@/services/mobile-reader-service'
export async function GET(request: Request) {
  return mobileRoute(request, async (userId) => {
    const input = MobileFeedQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await mobileFeed(userId, input))
  })
}
