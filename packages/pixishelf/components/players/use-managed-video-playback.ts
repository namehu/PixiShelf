'use client'

import { useEffect, useRef } from 'react'
import type Artplayer from 'artplayer'

/**
 * 在现有播放器上控制播放资格，避免离屏/回屏时重建实例、丢失进度和音量。
 * active 为 undefined 时不接管；paused 表示用户主动暂停，不能随可见性恢复而清除。
 */
export function useManagedVideoPlayback(
  art: Artplayer | null,
  active: boolean | undefined,
  paused: boolean,
  failed: boolean,
  onIntent?: (playing: boolean) => void
) {
  const latest = useRef({ active, paused, failed, onIntent })
  latest.current = { active, paused, failed, onIntent }
  const automatic = useRef(new WeakMap<Artplayer, symbol>())
  const mounted = useRef(false)
  const currentPlayer = useRef(art)
  currentPlayer.current = art
  const programmaticPause = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const pause = (player: Artplayer) => {
    // Artplayer 的 pause() 同步发出自身的 pause 事件；此标记不用于原生 video 的异步事件。
    // 离屏等程序暂停不能被记成用户主动暂停，否则回到视口后将无法自动续播。
    programmaticPause.current = true
    try {
      player.pause()
    } finally {
      programmaticPause.current = false
    }
  }

  useEffect(() => {
    if (!art || active === undefined) return
    if (!active || paused || failed) {
      pause(art)
      return
    }
    let cancelled = false
    const attempt = Symbol()
    automatic.current.set(art, attempt)
    const eligible = () => !cancelled && latest.current.active && !latest.current.paused && !latest.current.failed
    const play = async () => {
      try {
        await art.play()
      } catch (error) {
        // 仅为仍有效的浏览器策略拒绝做一次静音重试；资源错误不能靠静音解决。
        if (
          eligible() &&
          error &&
          typeof error === 'object' &&
          'name' in error &&
          error.name === 'NotAllowedError' &&
          !art.muted
        ) {
          art.muted = true
          try {
            await art.play()
          } catch {
            /* 静音仍被拒绝时交还手动播放入口，不循环重试。 */
          }
        }
      } finally {
        // 同一实例可能已开始新一轮播放，旧 Promise 不得清除新请求的自动播放标记。
        if (automatic.current.get(art) === attempt) automatic.current.delete(art)
        if (
          mounted.current &&
          currentPlayer.current === art &&
          (!latest.current.active || latest.current.paused || latest.current.failed)
        ) {
          pause(art)
        }
      }
    }
    void play()
    return () => {
      cancelled = true
      pause(art)
    }
  }, [art, active, paused, failed])

  return {
    onPlay: (player: Artplayer) => {
      const managed = latest.current.active !== undefined
      const auto = managed && automatic.current.has(player)
      // play() 成功事件可能晚于离屏、手动暂停或实例替换，必须在这里再次核验资格。
      if (
        managed &&
        (!mounted.current ||
          player !== currentPlayer.current ||
          !latest.current.active ||
          latest.current.failed ||
          (auto && latest.current.paused))
      ) {
        pause(player)
        return { allowed: false, automatic: auto }
      }
      // 手动重新播放可解除暂停记忆；自动播放成功不能代替用户作出这一决定。
      if (managed && !auto) latest.current.onIntent?.(true)
      return { allowed: true, automatic: auto }
    },
    onPause: () => {
      if (mounted.current && latest.current.active && !programmaticPause.current && !latest.current.failed) {
        latest.current.onIntent?.(false)
      }
    }
  }
}
