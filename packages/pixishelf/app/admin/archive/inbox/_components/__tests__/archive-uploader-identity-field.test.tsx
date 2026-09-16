import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), saved: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ archiveUploader: { resolveIdentity: { mutationOptions: () => ({}) } } })
}))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutateAsync: mocks.resolve }) }))
import {
  ArchiveUploaderIdentityField,
  useArchiveUploaderIdentity,
  type SavedUploaderOption
} from '../archive-uploader-identity-field'

function Harness({ active = true, sources = [] }: { active?: boolean; sources?: SavedUploaderOption[] }) {
  const identity = useArchiveUploaderIdentity(active)
  return (
    <>
      <ArchiveUploaderIdentityField identity={identity} sources={sources} />
      <button onClick={async () => mocks.saved(await identity.getIdentity())}>保存</button>
    </>
  )
}
const match = (name: string, uid: string) => ({
  outcome: 'MATCHED',
  uploaderName: name,
  uploaderUid: uid,
  existingSource: null,
  evidenceExternalId: '1'
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('name-first uploader identity field', () => {
  it('retries an unresolved name without requiring an input change', async () => {
    mocks.resolve
      .mockResolvedValueOnce({ outcome: 'UNRESOLVED', reason: 'UNAVAILABLE', message: '暂时无法识别' })
      .mockResolvedValueOnce(match('Alice', '123'))
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    await act(() => vi.advanceTimersByTimeAsync(1000))
    fireEvent.click(screen.getByRole('button', { name: '重试识别' }))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('已识别：Alice')
  })

  it('debounces names and reuses the pending match when saving', async () => {
    let finish!: (value: unknown) => void
    mocks.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    await act(() => vi.advanceTimersByTimeAsync(999))
    expect(mocks.resolve).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByRole('status').textContent).toContain('正在识别')
    fireEvent.click(screen.getByText('保存'))
    expect(mocks.saved).not.toHaveBeenCalled()
    await act(async () => {
      finish(match('Alice', '123'))
    })
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(mocks.saved).toHaveBeenCalledWith(expect.objectContaining({ value: 'Alice', resolvedUid: '123' }))
    expect(screen.queryByLabelText('上传者 UID')).toBeNull()
  })

  it('ignores an old response after the name changes', async () => {
    const finishes: ((value: unknown) => void)[] = []
    mocks.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        })
    )
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    await act(() => vi.advanceTimersByTimeAsync(1000))
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Bob' } })
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await act(async () => {
      finishes[1]!(match('Bob', '456'))
      finishes[0]!(match('Alice', '123'))
    })
    expect(screen.getByRole('status').textContent).toContain('Bob')
    fireEvent.click(screen.getByText('保存'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.saved).toHaveBeenCalledWith(expect.objectContaining({ value: 'Bob', resolvedUid: '456' }))
  })

  it('keeps a numeric name as a name and falls back after the deadline', async () => {
    mocks.resolve.mockImplementation(() => new Promise(() => {}))
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: '12345' } })
    fireEvent.click(screen.getByText('保存'))
    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(mocks.resolve).toHaveBeenCalledWith({ name: '12345' })
    expect(mocks.saved).toHaveBeenCalledWith({ mode: 'NAME', value: '12345' })
    expect(screen.getByRole('status').textContent).toContain('按名称搜索')
  })

  it('does not resolve after closing before the debounce expires', async () => {
    const view = render(<Harness />)
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    view.rerender(<Harness active={false} />)
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('waits for IME composition to finish before starting the debounce', async () => {
    mocks.resolve.mockResolvedValue(match('上传者', '123'))
    render(<Harness />)
    const input = screen.getByLabelText('上传者名称')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '上传者' } })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(mocks.resolve).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(mocks.resolve).toHaveBeenCalledWith({ name: '上传者' })
  })

  it('ignores an in-flight result after closing and reopening under StrictMode', async () => {
    const finishes: ((value: unknown) => void)[] = []
    mocks.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        })
    )
    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>
    )
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    await act(() => vi.advanceTimersByTimeAsync(1000))
    view.rerender(
      <StrictMode>
        <Harness active={false} />
      </StrictMode>
    )
    view.rerender(
      <StrictMode>
        <Harness />
      </StrictMode>
    )
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Bob' } })
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await act(async () => {
      finishes[1]!(match('Bob', '456'))
      finishes[0]!(match('Alice', '123'))
    })
    fireEvent.click(screen.getByText('保存'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mocks.saved).toHaveBeenCalledWith(expect.objectContaining({ resolvedUid: '456' }))
  })

  it.each(['Alice', 'Alice "Art"'])(
    'selects known uploader %s without interpreting its label as query syntax',
    async (displayName) => {
      render(
        <Harness
          sources={[
            {
              id: 'one',
              sourceKind: 'UPLOADER',
              displayName,
              identityValue: 'Alice',
              uploaderUid: '123',
              status: 'ARCHIVED'
            }
          ]}
        />
      )
      fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Ali' } })
      fireEvent.click(screen.getByRole('button', { name: `${displayName}（已停用）` }))
      fireEvent.click(screen.getByText('保存'))
      await act(() => vi.advanceTimersByTimeAsync(2000))
      expect(mocks.resolve).not.toHaveBeenCalled()
      expect(mocks.saved).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'UID', value: '123', resolvedUid: '123', sourceId: 'one', displayName })
      )
      expect(screen.queryByLabelText('上传者 UID')).toBeNull()
    }
  )
})
