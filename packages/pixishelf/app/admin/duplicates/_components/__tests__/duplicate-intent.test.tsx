import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDuplicateIntent } from '../use-duplicate-intent'
import { DuplicateDeleteConsent } from '../duplicate-delete-consent'

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function Intent({
  request,
  onSuccess
}: {
  request: (key: string) => Promise<string>
  onSuccess: (data: string) => void
}) {
  const intent = useDuplicateIntent()
  return (
    <>
      <button
        disabled={intent.pending.has('save')}
        onClick={() => void intent.execute('save', 'review-1', request, onSuccess)}
      >
        保存
      </button>
      {intent.failed.has('save') ? <p>未保存</p> : null}
    </>
  )
}

describe('duplicate intent and confirmation scopes', () => {
  it('deduplicates rapid requests and reuses an unconfirmed key', async () => {
    let reject!: (error: Error) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          })
      )
      .mockResolvedValue('saved')
    const onSuccess = vi.fn()
    render(<Intent request={request} onSuccess={onSuccess} />)
    fireEvent.click(screen.getByText('保存'))
    fireEvent.click(screen.getByText('保存'))
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('unknown')))
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('saved'))
    expect(request.mock.calls[0]![0]).toBe(request.mock.calls[1]![0])
  })
  it('ignores a late response after account scope replacement', async () => {
    let resolve!: (data: string) => void
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const onSuccess = vi.fn()
    const view = render(<Intent key="account-a" request={request} onSuccess={onSuccess} />)
    fireEvent.click(screen.getByText('保存'))
    view.rerender(<Intent key="account-b" request={request} onSuccess={onSuccess} />)
    await act(async () => resolve('old'))
    expect(onSuccess).not.toHaveBeenCalled()
    expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(false)
  })
  it('requires all confirmations and clears them for a different operation version', () => {
    const onConfirm = vi.fn()
    const content = (key: string) => (
      <DuplicateDeleteConsent key={key} copyCount={2} busy={false} disabled={false} onConfirm={onConfirm} />
    )
    const view = render(content('operation-v1'))
    const submit = screen.getByRole('button', { name: '永久删除 2 部副本' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    const checks = screen.getAllByRole('checkbox')
    checks.slice(0, -1).forEach((check) => fireEvent.click(check))
    expect(submit.disabled).toBe(true)
    fireEvent.click(checks.at(-1)!)
    fireEvent.click(submit)
    expect(onConfirm).toHaveBeenCalledWith()
    view.rerender(content('operation-v2'))
    expect((screen.getByRole('button', { name: '永久删除 2 部副本' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
