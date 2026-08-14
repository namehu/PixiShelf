export const VIDEO_POSTER_LOCK_NAMESPACE = 728_346

export async function lockVideoPoster(
  transaction: { $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown> },
  imageId: number
) {
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)::text', VIDEO_POSTER_LOCK_NAMESPACE, imageId)
}
