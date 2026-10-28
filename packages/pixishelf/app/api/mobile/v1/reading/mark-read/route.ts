import { assertMobileAccount, mobileBody, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { ReadingMarkReadInputSchema } from '@/schemas/reading.dto'
import { markReadingRead } from '@/services/reading-service'

export async function PUT(request: Request) {
  return mobileRoute(request, async (userId) => {
    const input = ReadingMarkReadInputSchema.parse(await mobileBody(request))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await markReadingRead(userId, input))
  })
}
