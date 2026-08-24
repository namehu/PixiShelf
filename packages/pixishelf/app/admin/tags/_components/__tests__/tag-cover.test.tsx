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
  it('shows an explicit empty state when a tag has no cover', () => {
    render(<TagCoverThumbnail tag={{ name: '初音ミク', image: '' }} onPreview={vi.fn()} />)

    expect(screen.getByText('无封面')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the cover preview from the thumbnail', () => {
    const onPreview = vi.fn()
    const tag = { name: '初音ミク', image: '/api/pixiv-data/tags/cover.webp' }
    render(<TagCoverThumbnail tag={tag} onPreview={onPreview} />)

    fireEvent.click(screen.getByRole('button', { name: '查看标签 初音ミク 的封面' }))

    expect(onPreview).toHaveBeenCalledWith(tag)
    expect(screen.getByText('有封面')).toBeTruthy()
  })

  it('distinguishes a missing file from a tag without cover metadata', () => {
    const { container } = render(
      <TagCoverThumbnail tag={{ name: '初音ミク', image: '/api/pixiv-data/tags/missing.webp' }} onPreview={vi.fn()} />
    )

    fireEvent.error(container.querySelector('img')!)

    expect(screen.getByText('读取失败')).toBeTruthy()
  })
})
