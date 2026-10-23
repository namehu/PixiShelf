export const VIEWER_PLAYBACK_RATES = [1, 1.25, 1.5, 2, 3] as const
export type ViewerPlaybackRate = (typeof VIEWER_PLAYBACK_RATES)[number]
