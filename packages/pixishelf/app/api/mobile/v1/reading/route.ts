import { assertMobileAccount, mobileBody, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { ReadingReportInputSchema } from '@/schemas/reading.dto'
import { reportReading } from '@/services/reading-service'
export async function POST(request: Request) {
  return mobileRoute(request, async (userId) => {
    const input = ReadingReportInputSchema.parse(await mobileBody(request))
    assertMobileAccount(userId, input.expectedUserId)
    return mobileJson(await reportReading(userId, input))
  })
}
