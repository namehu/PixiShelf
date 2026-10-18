'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useViewerStore } from '@/store/viewer-store'

interface AutoMediaOptions {
  mediaKey: string
  active: boolean
  ready: boolean
  failed: boolean
  timed: boolean
  blocked: boolean
  timingBlocked: boolean
  isBlocked: () => boolean
  advance: () => void
}

/** One cancellable completion per active media visit. Never infer completion from reading progress. */
export function useViewerAutoMedia(options: AutoMediaOptions) {
  const status = useViewerStore((state) => state.autoBrowseStatus)
  const session = useViewerStore((state) => state.autoBrowseSession)
  const interval = useViewerStore((state) => state.autoBrowseInterval)
  const latest = useRef(options)
  latest.current = options
  const identity = `${session}:${options.mediaKey}:${options.active}`
  const visit = useRef({ identity, token: {} })
  if (visit.current.identity !== identity) visit.current = { identity, token: {} }
  const token = visit.current.token
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [completed, setCompleted] = useState<object | null>(null)
  const advanced = useRef<object | null>(null)
  const selected = status === 'running' || status === 'paused'
  const running = options.active && status === 'running' && !options.blocked

  const complete = useCallback(() => {
    if (!alive.current || token !== visit.current.token || !latest.current.active) return
    if (useViewerStore.getState().autoBrowseStatus !== 'running') return
    setCompleted(token)
  }, [token])
  const cancelCompletion = useCallback(() => {
    advanced.current = null
    setCompleted(null)
  }, [])

  useEffect(() => {
    if (!options.active || !selected) return
    const store = useViewerStore.getState()
    if (options.failed) {
      store.pauseAutoBrowse('media-error')
      store.setAutoBrowseWait(null)
    } else if (store.autoBrowseWait !== 'page') {
      store.setAutoBrowseWait(options.ready ? null : 'media')
    }
  }, [options.active, options.failed, options.ready, selected, status])

  useEffect(() => {
    if (status === 'paused' && options.timed && advanced.current !== token) setCompleted(null)
  }, [status, options.timed, token])

  useEffect(() => {
    if (
      !options.active ||
      status !== 'running' ||
      options.timingBlocked ||
      !options.ready ||
      options.failed ||
      !options.timed ||
      completed === token
    ) {
      return
    }
    const timer = window.setTimeout(complete, interval * 1000)
    return () => window.clearTimeout(timer)
  }, [
    options.active,
    status,
    options.timingBlocked,
    options.ready,
    options.failed,
    options.timed,
    interval,
    token,
    complete,
    completed
  ])

  useEffect(() => {
    if (!running || options.failed || completed !== token || advanced.current === token) return
    // Let final playback observations commit before navigating away; no network wait.
    const timer = window.setTimeout(() => {
      if (!alive.current || token !== visit.current.token || !latest.current.active || latest.current.isBlocked()) {
        return
      }
      if (useViewerStore.getState().autoBrowseStatus !== 'running') return
      advanced.current = token
      latest.current.advance()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [running, options.failed, options.blocked, completed, token])

  return { selected, running, complete, cancelCompletion }
}
