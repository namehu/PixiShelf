import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TagCoverThumbnail } from '../tag-cover'

type MockImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean
  priority?: boolean
}

vi.mock('next/image', () => ({
  default: (props: MockImageProps) => {
    const imageProps = { ...props }
    delete imageProps.fill
    delete imageProps.priority
    return <img {...imageProps} />
  }
}))

afterEach(cleanup)

describe('TagCoverThumbnail', () => {
  it('shows a dash when the cover has never been generated', () => {
    render(<TagCoverThumbnail tag={{ name: '初音ミク', image: '' }} checked={false} onPreview={vi.fn()} />)

    expect(screen.getByLabelText('标签 初音ミク 尚未生成封面').textContent).toBe('-')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows an empty placeholder when a checked tag has no cover', () => {
    render(<TagCoverThumbnail tag={{ name: '初音ミク', image: '' }} checked onPreview={vi.fn()} />)

    expect(screen.getByLabelText('标签 初音ミク 没有封面').textContent).toBe('')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the cover preview from the thumbnail', () => {
    const onPreview = vi.fn()
    const tag = { name: '初音ミク', image: '/api/pixiv-data/tags/cover.webp' }
    render(<TagCoverThumbnail tag={tag} checked onPreview={onPreview} />)

    fireEvent.click(screen.getByRole('button', { name: '查看标签 初音ミク 的封面' }))

    expect(onPreview).toHaveBeenCalledWith(tag)
    expect(screen.queryByText('有封面')).toBeNull()
  })

  it('falls back to the empty placeholder when the cover file cannot be read', () => {
    const { container } = render(
      <TagCoverThumbnail
        tag={{ name: '初音ミク', image: '/api/pixiv-data/tags/missing.webp' }}
        checked
        onPreview={vi.fn()}
      />
    )

    fireEvent.error(container.querySelector('img')!)

    expect(screen.getByLabelText('标签 初音ミク 没有封面').textContent).toBe('')
  })
})
