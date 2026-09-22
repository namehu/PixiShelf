/** Release responses discarded before reading without hiding the request outcome. */
export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup is best effort; the caller retains its original status/error.
  }
}

export async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  tooLarge: () => Error
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) throw tooLarge()
      chunks.push(value)
    }
    return Buffer.concat(chunks, total)
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Cancellation may itself fail after a stream/network failure.
    }
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Do not replace a read failure with a cleanup failure.
    }
  }
}
