export const WORKER_HEARTBEAT_STALE_AFTER_MS = 90_000

export function isWorkerHeartbeatFresh(heartbeatAt: Date | string, now: Date | number): boolean {
  const heartbeatTime = heartbeatAt instanceof Date ? heartbeatAt.getTime() : new Date(heartbeatAt).getTime()
  const currentTime = now instanceof Date ? now.getTime() : now
  return Number.isFinite(heartbeatTime) && Math.max(0, currentTime - heartbeatTime) <= WORKER_HEARTBEAT_STALE_AFTER_MS
}
