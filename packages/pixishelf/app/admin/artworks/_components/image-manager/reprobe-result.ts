export type VideoReprobeResult =
  | { mode: 'QUEUED'; reused: boolean }
  | { mode: 'COMPLETED'; metadata: { hasAudio: boolean } }

export function describeVideoReprobeResult(result: VideoReprobeResult) {
  if (result.mode === 'QUEUED') {
    return {
      message: result.reused ? '已复用队列中的视频重探测任务' : '视频重探测任务已加入队列',
      refreshMedia: false
    }
  }
  return {
    message: `视频重新探测完成：${result.metadata.hasAudio ? '有音频' : '无音频'}`,
    refreshMedia: true
  }
}
