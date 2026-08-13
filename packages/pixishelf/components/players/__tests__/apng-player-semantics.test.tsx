import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ApngPlayer from '../apng-player'

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />
}))

vi.mock('@/utils/combination-static', () => ({
  combinationApiResource: (src: string) => src
}))

afterEach(cleanup)

describe('ApngPlayer semantics', () => {
  it('uses a native labelled button for playback', () => {
    render(<ApngPlayer src="/sample.png" alt="示例动画" />)

    const button = screen.getByRole('button', { name: '播放或暂停动画：示例动画' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('img', { name: '示例动画' })).toBeTruthy()
  })
})
