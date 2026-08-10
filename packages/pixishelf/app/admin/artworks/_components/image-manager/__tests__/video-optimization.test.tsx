import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageVideoOptimizationEntry } from '../video-optimization'
import type { ImageListItem } from '../../types'

const mp4Image: ImageListItem = {
  id: 9,
  path: '/artist/work/video.mp4',
  sortOrder: 0,
  width: 1920,
  height: 1080,
  size: 100,
  mediaType: 'video'
}

describe('ImageVideoOptimizationEntry', () => {
  it('marks non-MP4 videos as requiring a separate transcode mode', () => {
    render(
      <ImageVideoOptimizationEntry
        image={{ ...mp4Image, path: '/artist/work/video.webm' }}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('需转码')).toBeTruthy()
  })

  it('shows live progress and cancels the exact row job', () => {
    const onCancel = vi.fn()
    const job = { id: 'job-9', status: 'RUNNING', progress: 48, targetImageId: 9 }
    render(<ImageVideoOptimizationEntry image={mp4Image} job={job} onStart={vi.fn()} onCancel={onCancel} />)

    expect(screen.getByText('48%')).toBeTruthy()
    fireEvent.click(screen.getByTitle('取消任务'))
    expect(onCancel).toHaveBeenCalledWith(job)
  })

  it('shows the failure reason and retries from the same row', () => {
    const onStart = vi.fn()
    render(
      <ImageVideoOptimizationEntry
        image={mp4Image}
        job={{ id: 'job-9', status: 'FAILED', progress: 20, error: 'Invalid MP4 index', targetImageId: 9 }}
        onStart={onStart}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Invalid MP4 index')).toBeTruthy()
    fireEvent.click(screen.getByText('失败，重试'))
    expect(onStart).toHaveBeenCalledWith(mp4Image)
  })
})
