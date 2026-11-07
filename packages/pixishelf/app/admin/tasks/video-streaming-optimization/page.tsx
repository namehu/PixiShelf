import type { Metadata } from 'next'
import { VideoStreamingOptimizationWorkspace } from './_components/video-streaming-optimization-workspace'

export const metadata: Metadata = {
  title: 'MP4 无损播放优化 - PixiShelf Admin',
  description: '按作品筛选并批量提交 MP4 无损播放优化'
}

export default function VideoStreamingOptimizationPage() {
  return <VideoStreamingOptimizationWorkspace />
}
