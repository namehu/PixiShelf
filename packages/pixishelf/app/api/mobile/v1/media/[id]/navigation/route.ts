import { assertMobileAccount, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { MobileAccount, MobileId } from '@/schemas/mobile.dto'
import { mobileVideoNavigation } from '@/services/mobile-video-navigation-service'

const querySchema = MobileAccount.extend({ revision: MobileId })
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return mobileRoute(request, async (userId) => {
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await mobileVideoNavigation(MobileId.parse((await context.params).id), input.revision))
  })
}
