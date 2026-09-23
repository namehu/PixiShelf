export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'buffering'
  | 'paused'
  | 'ended'
  | 'error'
  | 'destroyed'
export interface WebpSource {
  url: string
  resourceKey: string
  size?: number
  /** Honor the file's loop count; false/omitted plays exactly one cycle. */
  loop?: boolean
}
export interface PlayerSnapshot {
  status: PlayerStatus
  frameIndex: number | null
  presentedMs: number
  bufferedFrames: number
  receivedBytes: number
  inputComplete: boolean
}
export type PlayerErrorCode =
  | 'unsupported'
  | 'initialization'
  | 'budget'
  | 'metadata'
  | 'network'
  | 'auth'
  | 'invalid'
  | 'internal'
export interface PlayerFailure {
  code: PlayerErrorCode
  message: string
  recoverableByLegacy: boolean
}
export type PlayerEvent =
  | { type: 'state'; snapshot: PlayerSnapshot }
  | { type: 'first-frame' | 'ended' }
  | { type: 'error'; error: PlayerFailure }
export interface PlayerLimits {
  maxInputBytes: number
  maxPixels: number
  maxHeapBytes: number
  maxManagedBytes: number
}
const MiB = 1024 * 1024
export function playerLimits(mobile: boolean): PlayerLimits {
  return {
    maxInputBytes: (mobile ? 32 : 64) * MiB,
    maxPixels: mobile ? 4_000_000 : 8_000_000,
    maxHeapBytes: (mobile ? 128 : 256) * MiB,
    maxManagedBytes: (mobile ? 192 : 384) * MiB
  }
}
export interface Frame {
  pixels: ArrayBuffer
  width: number
  height: number
  durationMs: number
  index: number
}
export type WorkerCommand =
  | { type: 'start'; source: WebpSource; decoderUrl: string; limits: PlayerLimits }
  | { type: 'pull'; recycled?: ArrayBuffer }
  | { type: 'pause'; paused: boolean }
  | { type: 'destroy' }
export type WorkerEvent =
  | { type: 'frame'; frame: Frame }
  | { type: 'input'; receivedBytes: number; inputComplete: boolean }
  | { type: 'drained' }
  | { type: 'error'; error: PlayerFailure }
