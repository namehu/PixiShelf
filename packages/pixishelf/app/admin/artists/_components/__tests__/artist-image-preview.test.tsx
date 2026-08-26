import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArtistAvatarThumbnail,
  ArtistBackgroundThumbnail,
  ArtistImagePreviewDialog
} from '../artist-image-preview'

afterEach(cleanup)

describe('artist image preview', () => {
  it('opens avatar preview from a loaded avatar thumbnail', () => {
    const onPreview = vi.fn()

    render(<ArtistAvatarThumbnail name="初音未来" image="/avatar.webp" onPreview={onPreview} />)
    fireEvent.click(screen.getByRole('button', { name: '查看艺术家 初音未来 的头像' }))

    expect(onPreview).toHaveBeenCalledWith({
      name: '初音未来',
      image: '/avatar.webp',
      type: 'avatar'
    })
  })

  it('opens background preview from a loaded background thumbnail', () => {
    const onPreview = vi.fn()

    render(<ArtistBackgroundThumbnail name="初音未来" image="/background.webp" onPreview={onPreview} />)
    fireEvent.click(screen.getByRole('button', { name: '查看艺术家 初音未来 的背景图' }))

    expect(onPreview).toHaveBeenCalledWith({
      name: '初音未来',
      image: '/background.webp',
      type: 'background'
    })
  })

  it('keeps failed background images non-interactive', () => {
    const { container } = render(
      <ArtistBackgroundThumbnail name="初音未来" image="/missing.webp" onPreview={vi.fn()} />
    )

    fireEvent.error(container.querySelector('img')!)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByLabelText('艺术家 初音未来 没有背景图')).toBeTruthy()
  })

  it('renders the selected image in an accessible dialog', () => {
    render(
      <ArtistImagePreviewDialog
        target={{ name: '初音未来', image: '/background.webp', type: 'background' }}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '初音未来的背景图' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '艺术家 初音未来 的背景图' }).getAttribute('src')).toBe(
      '/background.webp'
    )
  })
})
