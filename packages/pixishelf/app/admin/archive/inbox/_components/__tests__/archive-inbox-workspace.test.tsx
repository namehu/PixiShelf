import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ArchiveInboxWorkspace } from '../archive-inbox-workspace'

vi.mock('../archive-delete-failed-dialog', () => ({
  ArchiveDeleteFailedResultProvider: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('../archive-inbox', () => ({ ArchiveInbox: () => <div>收件内容</div> }))
vi.mock('../archive-uploader-sources', () => ({
  ArchiveUploaderSources: ({ active }: { active: boolean }) => (active ? <div>来源内容</div> : null)
}))
afterEach(cleanup)

describe('archive workspace tab navigation', () => {
  it('defaults to discovery first and keeps an explicit queue URL when switching', async () => {
    const onUrlUpdate = vi.fn()
    render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={onUrlUpdate}>
        <ArchiveInboxWorkspace />
      </NuqsTestingAdapter>
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['发现来源', '收件队列'])
    expect(screen.getByRole('tab', { name: '发现来源' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '收件队列' }), { button: 0, ctrlKey: false })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '收件队列' }).getAttribute('aria-selected')).toBe('true')
    )
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tab')).toBe('inbox'))
    fireEvent.mouseDown(screen.getByRole('tab', { name: '发现来源' }), { button: 0, ctrlKey: false })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '发现来源' }).getAttribute('aria-selected')).toBe('true')
    )
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('tab')).toBe(false))
  })
  it.each(['?tab=inbox', '?itemId=item-1', '?tab=uploaders&itemId=item-1'])(
    'preserves queue deep links: %s',
    (searchParams) => {
      render(
        <NuqsTestingAdapter searchParams={searchParams}>
          <ArchiveInboxWorkspace />
        </NuqsTestingAdapter>
      )
      expect(screen.getByRole('tab', { name: '收件队列' }).getAttribute('aria-selected')).toBe('true')
      expect(screen.getByText('收件内容')).toBeTruthy()
    }
  )
})
