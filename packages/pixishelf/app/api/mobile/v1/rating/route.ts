import { assertMobileAccount, mobileBody, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { ArtworkRatingSetInputSchema } from '@/schemas/artwork-rating.dto'
import { setArtworkRating } from '@/services/artwork-rating-service'
export async function PUT(request: Request) {
  return mobileRoute(request, async (userId) => {
    const input = ArtworkRatingSetInputSchema.parse(await mobileBody(request))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await setArtworkRating(userId, input.artworkId, input.level))
  })
}
