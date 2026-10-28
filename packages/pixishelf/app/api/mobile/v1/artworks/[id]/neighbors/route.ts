import { assertMobileAccount, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { MobileId, MobileNeighborsQuery } from '@/schemas/mobile.dto'
import { mobileArtworkNeighbors } from '@/services/mobile-detail-service'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return mobileRoute(request, async (userId) => {
    const input = MobileNeighborsQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await mobileArtworkNeighbors(userId, MobileId.parse((await context.params).id), input))
  })
}
