import {
  controlCentralVideoProcessingJob,
  enqueueCentralVideoStreamingOptimization
} from '@/services/video-processing-central-service'
export async function enqueueVideoOptimization(imageId: number, requestedByUserId: string) {
  {
    const queued = await enqueueCentralVideoStreamingOptimization({ imageId, requestedByUserId })
    return { ...queued, queuePosition: null }
  }
}
export async function cancelVideoOptimization(jobId: string) {
  {
    const result = await controlCentralVideoProcessingJob(jobId, 'cancel')
    return result ? { changed: true, job: result } : null
  }
}
