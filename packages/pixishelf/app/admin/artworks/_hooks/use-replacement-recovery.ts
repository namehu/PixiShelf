import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ContentWriteAuthorization } from '@/schemas/media-content.dto'

type Config = { uploadTargetDir: string; targetRelDir: string; authorization: ContentWriteAuthorization }
export function useReplacementRecovery(userId: string | undefined, artworkId: number | undefined) {
  const key = userId && artworkId ? `pixishelf:replace:v1:${userId}:${artworkId}` : null
  const identity = useRef<{ sessionId: string; token: string; userId: string } | null>(null)
  const uploadAuthorizationRef = useRef<ContentWriteAuthorization | null>(null)
  const pendingCommitRef = useRef<string | null>(null)
  const [uploadConfig, setUploadConfig] = useState<Config | null>(null)
  const [recoverable, setRecoverable] = useState(false)
  const persistReplacement = (config = uploadConfig) => {
    if (!key || !identity.current) throw new Error('无法保存替换会话。')
    localStorage.setItem(
      key,
      JSON.stringify({
        identity: identity.current,
        config: config ?? JSON.parse(localStorage.getItem(key) ?? '{}').config ?? null,
        pendingCommit: pendingCommitRef.current
      })
    )
  }
  const forgetReplacement = () => {
    if (key) localStorage.removeItem(key)
    const sessionId = identity.current?.sessionId
    if (sessionId) {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const candidate = localStorage.key(index)
        if (!candidate?.startsWith('pixishelf:upload:v1:') && !candidate?.startsWith('pixishelf:chapter:v1:')) continue
        try {
          if (JSON.parse(localStorage.getItem(candidate) ?? '{}').sessionId === sessionId) {
            localStorage.removeItem(candidate)
          }
        } catch {
          /* Keep unknown recovery records. */
        }
      }
    }
    setRecoverable(false)
    pendingCommitRef.current = null
  }
  const replaceHeaders = () => {
    if (!userId) throw new Error('请登录后操作。')
    if (!identity.current) identity.current = { sessionId: crypto.randomUUID(), token: crypto.randomUUID(), userId }
    if (identity.current.userId !== userId) throw new Error('账户已切换，请刷新后重试。')
    persistReplacement()
    return {
      'x-expected-user-id': userId,
      'x-replace-session-id': identity.current.sessionId,
      'x-replace-token': identity.current.token,
      ...(uploadAuthorizationRef.current
        ? { 'x-replace-authorization': JSON.stringify(uploadAuthorizationRef.current) }
        : {})
    }
  }
  const resetRecovery = useCallback(() => {
    setUploadConfig(null)
    setRecoverable(false)
    uploadAuthorizationRef.current = null
    identity.current = null
    pendingCommitRef.current = null
  }, [])
  const restoreRecovery = useCallback(() => {
    if (!key) return
    const saved = localStorage.getItem(key)
    if (!saved) return
    try {
      const recovery = JSON.parse(saved)
      if (recovery.identity?.userId !== userId) return
      identity.current = recovery.identity
      uploadAuthorizationRef.current = recovery.config?.authorization ?? null
      setUploadConfig(recovery.config ?? null)
      pendingCommitRef.current = recovery.pendingCommit ?? null
      setRecoverable(true)
    } catch {
      toast.error('无法读取原替换会话，请保留恢复数据。')
    }
  }, [key, userId])
  return {
    uploadAuthorizationRef,
    uploadConfig,
    setUploadConfig,
    recoverable,
    setRecoverable,
    pendingCommitRef,
    persistReplacement,
    forgetReplacement,
    replaceHeaders,
    resetRecovery,
    restoreRecovery
  }
}
