import * as React from 'react'

export function useMediaQuery(query: string) {
  const media = React.useMemo(
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null),
    [query]
  )
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      media?.addEventListener('change', onChange)
      return () => media?.removeEventListener('change', onChange)
    },
    [media]
  )
  const getSnapshot = React.useCallback(() => media?.matches ?? false, [media])

  // 客户端返回页面时首帧就使用真实断点，避免先挂载手机版再销毁重建桌面版。
  // 服务端及水合首帧仍使用相同默认值，保持 HTML 一致。
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
