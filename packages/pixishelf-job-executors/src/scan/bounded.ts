export async function mapBounded<TInput, TOutput>(
  values: readonly TInput[],
  concurrency: number,
  signal: AbortSignal,
  operation: (value: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Scan concurrency must be a positive integer')
  }
  throwIfAborted(signal)
  const results = new Array<TOutput>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      throwIfAborted(signal)
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await operation(values[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

export function chunks<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Chunk size must be a positive integer')
  const pages: T[][] = []
  for (let index = 0; index < values.length; index += size) pages.push(values.slice(index, index + size))
  return pages
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error('Scan execution was interrupted')
}
