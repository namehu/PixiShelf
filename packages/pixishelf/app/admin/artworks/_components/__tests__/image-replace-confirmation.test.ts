import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  rememberImageReplaceConfirmationForSession,
  requestImageReplaceStart,
  shouldSkipImageReplaceConfirmation
} from '../image-replace-confirmation'

describe('image replace session confirmation', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('requires confirmation by default', () => {
    expect(shouldSkipImageReplaceConfirmation()).toBe(false)
  })

  it('skips later confirmations after remembering the choice for the session', () => {
    rememberImageReplaceConfirmationForSession()

    expect(shouldSkipImageReplaceConfirmation()).toBe(true)
  })

  it('requires confirmation again after the session storage is cleared', () => {
    rememberImageReplaceConfirmationForSession()
    sessionStorage.clear()

    expect(shouldSkipImageReplaceConfirmation()).toBe(false)
  })

  it('shows confirmation before starting when no session preference exists', () => {
    const startReplace = vi.fn().mockResolvedValue(undefined)
    const showConfirmation = vi.fn()

    requestImageReplaceStart(startReplace, showConfirmation)

    expect(showConfirmation).toHaveBeenCalledOnce()
    expect(startReplace).not.toHaveBeenCalled()
  })

  it('remembers the checked preference and starts from the confirmation action', async () => {
    const startReplace = vi.fn().mockResolvedValue(undefined)
    let controls: Parameters<Parameters<typeof requestImageReplaceStart>[1]>[0] | undefined

    requestImageReplaceStart(startReplace, (nextControls) => {
      controls = nextControls
    })
    controls?.onSkipChange(true)
    await controls?.onConfirm()

    expect(shouldSkipImageReplaceConfirmation()).toBe(true)
    expect(startReplace).toHaveBeenCalledOnce()
  })

  it('starts immediately without showing confirmation when the session preference exists', () => {
    rememberImageReplaceConfirmationForSession()
    const startReplace = vi.fn().mockResolvedValue(undefined)
    const showConfirmation = vi.fn()

    requestImageReplaceStart(startReplace, showConfirmation)

    expect(startReplace).toHaveBeenCalledOnce()
    expect(showConfirmation).not.toHaveBeenCalled()
  })
})
