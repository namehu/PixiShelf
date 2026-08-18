// 仅在当前会话内持久化“本次会话不再提示”偏好，关闭标签页后即失效，下一次进入需重新确认。
const IMAGE_REPLACE_CONFIRMATION_SESSION_KEY = 'pixishelf:admin:artworks:skip-image-replace-confirmation'

// SSR 与存储受限场景共用入口：若 window/sessionStorage 不可用，直接回退到“仍需确认”的安全路径。
function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function shouldSkipImageReplaceConfirmation(): boolean {
  const storage = getSessionStorage()
  if (!storage) return false

  try {
    return storage.getItem(IMAGE_REPLACE_CONFIRMATION_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberImageReplaceConfirmationForSession(): void {
  const storage = getSessionStorage()
  if (!storage) return

  try {
    storage.setItem(IMAGE_REPLACE_CONFIRMATION_SESSION_KEY, '1')
  } catch {
    // 存储不可用时继续执行替换，但下次仍显示确认弹窗。
  }
}

interface ImageReplaceConfirmationControls {
  onSkipChange: (skip: boolean) => void
  onConfirm: () => Promise<void>
}

// 说明：该方法是一次“是否展示确认弹窗”的网关。命中 session flag 则直接执行替换；否则展示确认框并在弹窗关闭前用闭包记录“本次不再提示”。 
// 只有用户点击确认时才写入 sessionStorage，避免取消或未完成操作时产生误记忆。
export function requestImageReplaceStart(
  startReplace: () => Promise<void>,
  showConfirmation: (controls: ImageReplaceConfirmationControls) => void
): void {
  if (shouldSkipImageReplaceConfirmation()) {
    void startReplace()
    return
  }

  // 在同一次确认弹窗交互周期内保留用户的勾选态，避免引入额外状态容器。
  let skipForSession = false
  showConfirmation({
    onSkipChange: (skip) => {
      skipForSession = skip
    },
    onConfirm: async () => {
      if (skipForSession) rememberImageReplaceConfirmationForSession()
      await startReplace()
    }
  })
}
