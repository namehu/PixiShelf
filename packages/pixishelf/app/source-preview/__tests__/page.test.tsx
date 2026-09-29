import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sourcePreviewPage from '../page'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`)
  })
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/components/layout/page-back-button', () => ({
  default: () => <button type="button">返回上一页</button>
}))
vi.mock('@/components/source-preview/source-preview-reader', () => ({
  SourcePreviewReader: ({ previewId }: { previewId: string }) => <div data-testid="reader">{previewId}</div>
}))

describe('SourcePreviewPage', () => {
  beforeEach(() => {
    mocks.getSession.mockReset()
    mocks.notFound.mockClear()
    mocks.redirect.mockClear()
  })

  it('authenticates on the server and renders only an opaque preview id', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await sourcePreviewPage({ searchParams: Promise.resolve({ preview: 'opaque_123-abc' }) })
    render(result)

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '返回上一页' })).toBeTruthy()
    expect(screen.getByTestId('reader').textContent).toBe('opaque_123-abc')
  })

  it('redirects an unauthenticated opaque preview without accepting a source URL', async () => {
    mocks.getSession.mockResolvedValue(null)
    await expect(
      sourcePreviewPage({ searchParams: Promise.resolve({ preview: 'opaque_123' }) })
    ).rejects.toThrow('REDIRECT:/login?redirect=%2Fsource-preview%3Fpreview%3Dopaque_123')
  })

  it.each(['https://example.test/g/1/token', 'has space', '', 'a'.repeat(129)])(
    'rejects a non-opaque preview query: %s',
    async (preview) => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
      await expect(sourcePreviewPage({ searchParams: Promise.resolve({ preview }) })).rejects.toThrow('NOT_FOUND')
    }
  )
})
