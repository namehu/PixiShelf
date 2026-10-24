import type Artplayer from 'artplayer'

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element
  webkitExitFullscreen?: () => void | Promise<void>
}
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>
}

/** 全屏整个播放器以保留缩放与控件；不进入仅支持视频的系统播放器。 */
export async function toggleVideoFullscreen(art: Pick<Artplayer, 'template' | 'fullscreenWeb'>) {
  const player = art.template.$player as FullscreenElement
  const doc = player.ownerDocument as FullscreenDocument
  if (art.fullscreenWeb) {
    art.fullscreenWeb = false
    return
  }

  try {
    if (doc.fullscreenElement === player) {
      await doc.exitFullscreen()
    } else if (doc.webkitFullscreenElement === player) {
      await doc.webkitExitFullscreen?.()
    } else if (doc.fullscreenEnabled && player.requestFullscreen) {
      await player.requestFullscreen()
    } else if (doc.webkitFullscreenEnabled && player.webkitRequestFullscreen) {
      await player.webkitRequestFullscreen()
    } else {
      art.fullscreenWeb = true
    }
  } catch {
    // 权限或设备限制可能拒绝容器全屏；卸载后不能再移动旧播放器。
    if (player.isConnected && doc.fullscreenElement !== player && doc.webkitFullscreenElement !== player) {
      art.fullscreenWeb = true
    }
  }
}
