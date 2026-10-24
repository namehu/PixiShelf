'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserUuid } from '@/lib/browser-uuid'

/** Each mounted account/resource scope owns its keys and rejects late callbacks after leaving it. */
export function useDuplicateIntent() {
  const alive = useRef(true)
  const locks = useRef(new Set<string>())
  const intents = useRef(new Map<string, { signature: string; idempotencyKey: string }>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      intents.current.clear()
    }
  }, [])

  async function execute<T>(
    key: string,
    signature: string,
    request: (idempotencyKey: string) => Promise<T>,
    onSuccess: (data: T) => void,
    onError?: () => void
  ) {
    if (!alive.current || locks.current.has(key)) return
    locks.current.add(key)
    setPending(new Set(locks.current))
    setFailed((current) => new Set([...current].filter((item) => item !== key)))
    try {
      let intent = intents.current.get(key)
      if (intent?.signature !== signature) {
        intent = { signature, idempotencyKey: createBrowserUuid() }
        intents.current.set(key, intent)
      }
      const data = await request(intent.idempotencyKey)
      if (!alive.current) return
      intents.current.delete(key)
      onSuccess(data)
    } catch {
      if (!alive.current) return
      setFailed((current) => new Set(current).add(key))
      onError?.()
    } finally {
      locks.current.delete(key)
      if (alive.current) setPending(new Set(locks.current))
    }
  }
  return { execute, pending, failed }
}
