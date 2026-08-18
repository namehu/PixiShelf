export const WORKER_HEARTBEAT_STALE_AFTER_MS = 90_000

// worker 存活性按“上报距离”判断；只要最近一次心跳在阈值内视为鲜活，可用于就绪与排空判定。
export function isWorkerHeartbeatFresh(heartbeatAt: Date | string, now: Date | number): boolean {
  const heartbeatTime = heartbeatAt instanceof Date ? heartbeatAt.getTime() : new Date(heartbeatAt).getTime()
  const currentTime = now instanceof Date ? now.getTime() : now
  return Number.isFinite(heartbeatTime) && Math.max(0, currentTime - heartbeatTime) <= WORKER_HEARTBEAT_STALE_AFTER_MS
}
