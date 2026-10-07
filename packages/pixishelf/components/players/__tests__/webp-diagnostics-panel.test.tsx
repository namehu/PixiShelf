import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebpDiagnosticsPanel, type WebpDiagnosticResult } from '../webp-diagnostics-panel'

const mocks = vi.hoisted(() => ({ instances: [] as MockPlayer[], manifest: vi.fn() }))
class MockPlayer {
  listener: (event: { type: string }) => void = () => {}
  options: unknown
  constructor(_canvas: unknown, options: unknown) {
    this.options = options
    mocks.instances.push(this)
  }
  subscribe(fn: typeof this.listener) {
    this.listener = fn
  }
  load = vi.fn().mockResolvedValue(undefined)
  play = vi.fn()
  destroy = vi.fn()
  getDiagnostics = vi.fn(() => ({ version: 1, runId: 'anonymous', status: 'playing' }))
}
vi.mock('@pixishelf/webp-player', () => ({ WebpPlayer: MockPlayer }))
vi.mock('@/store/use-webp-player-store', () => ({
  useWebpPlayerStore: { getState: () => ({ loadManifest: mocks.manifest }) }
}))
const onStart = vi.fn(),
  onRunning = vi.fn(),
  onVisible = vi.fn(),
  onResult = vi.fn()
const props = () => ({
  src: '/api/media/example.webp',
  canvas: { current: document.createElement('canvas') },
  results: [] as WebpDiagnosticResult[],
  onStart,
  onRunning,
  onVisible,
  onResult
})
async function start(label = '新调度') {
  fireEvent.click(screen.getByRole('button', { name: 'WebP 性能诊断' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }))
    await vi.dynamicImportSettled()
  })
  return mocks.instances[0]!
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.instances.length = 0
  mocks.manifest.mockResolvedValue({ version: '0123456789abcdef' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('temporary WebP diagnostics', () => {
  it('runs a separate single cycle and reports completion exactly once', async () => {
    render(<WebpDiagnosticsPanel {...props()} />)
    const player = await start()
    expect(onStart).toHaveBeenCalledOnce()
    expect(player.load).toHaveBeenCalledWith(expect.objectContaining({ loop: false }))
    act(() => {
      player.listener({ type: 'ended' })
      player.listener({ type: 'ended' })
    })
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'completed' }))
    expect(player.destroy).toHaveBeenCalledOnce()
    expect(onRunning).toHaveBeenLastCalledWith(false)
  })
  it('does not expose the canvas in no-draw mode and can stop manually', async () => {
    render(<WebpDiagnosticsPanel {...props()} />)
    const player = await start('新调度 · 不绘制')
    act(() => player.listener({ type: 'first-frame' }))
    expect(onVisible).not.toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '停止测试' }))
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'manual' }))
  })
  it.each(['hidden', 'timeout', 'media-change-or-close'] as const)('retains a partial report on %s', async (reason) => {
    const view = render(<WebpDiagnosticsPanel {...props()} />)
    const player = await start()
    if (reason === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      act(() => document.dispatchEvent(new Event('visibilitychange')))
    } else if (reason === 'timeout') act(() => vi.advanceTimersByTime(120_000))
    else view.unmount()
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: reason }))
    expect(player.destroy).toHaveBeenCalledOnce()
  })
  it('cancels a pending manifest load without starting a late player', async () => {
    let resolve!: (value: unknown) => void
    mocks.manifest.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const view = render(<WebpDiagnosticsPanel {...props()} />)
    await start()
    view.unmount()
    await act(async () => resolve({ version: '0123456789abcdef' }))
    expect(mocks.instances).toHaveLength(0)
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'media-change-or-close', report: null }))
  })
  it('falls back to selectable text when clipboard or download fails', async () => {
    const results = [{ outcome: 'completed', report: null }] as WebpDiagnosticResult[]
    render(<WebpDiagnosticsPanel {...props()} results={results} />)
    fireEvent.click(screen.getByRole('button', { name: 'WebP 性能诊断' }))
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '复制报告（1）' })))
    expect((screen.getByRole('textbox', { name: '手动复制诊断报告' }) as HTMLTextAreaElement).value).toContain(
      'completed'
    )
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('unsupported')
    })
    fireEvent.click(screen.getByRole('button', { name: '下载 JSON' }))
    expect(screen.getByRole('status').textContent).toContain('无法下载')
  })
})
