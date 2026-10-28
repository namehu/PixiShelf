import { assertMobileAccount, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { MobileId } from '@/schemas/mobile.dto'
import { MediaPageInputSchema } from '@/schemas/artwork-reader.dto'
import { mobileMediaPage } from '@/services/mobile-reader-service'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return mobileRoute(request, async (userId) => {
    const query = Object.fromEntries(new URL(request.url).searchParams)
    const input = MediaPageInputSchema.parse({
      ...query,
      artworkId: MobileId.parse((await context.params).id),
      page: Number(query.page)
    })
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await mobileMediaPage(input.artworkId, input.fingerprint, input.page, userId))
  })
}
