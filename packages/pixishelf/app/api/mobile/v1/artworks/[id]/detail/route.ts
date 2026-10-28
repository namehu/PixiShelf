import { assertMobileAccount, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { MobileAccount, MobileId } from '@/schemas/mobile.dto'
import { mobileArtworkDetail } from '@/services/mobile-detail-service'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return mobileRoute(request, async (userId) => {
    const input = MobileAccount.parse(Object.fromEntries(new URL(request.url).searchParams))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await mobileArtworkDetail(MobileId.parse((await context.params).id)))
  })
}
