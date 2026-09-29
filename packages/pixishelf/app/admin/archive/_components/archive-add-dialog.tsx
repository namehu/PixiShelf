'use client'

import { useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { ClipboardPasteIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { SourcePreviewButton } from '@/components/source-preview/source-preview-button'
import { archiveClientErrorMessage } from './archive-client-error'
import { analyzeArchiveUrlInput } from './archive-intake-view-state'
import { ArchiveIntakeOptions, DEFAULT_ARCHIVE_INTAKE_OPTIONS } from '../inbox/_components/archive-intake-options'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type ArchiveIntakeCreateResult = RouterOutputs['archiveInbox']['create']

export interface ArchiveAddDialogProps {
  trigger?: ReactNode
  onCreated?: (result: ArchiveIntakeCreateResult) => void
}

export function ArchiveAddDialog({ trigger, onCreated }: ArchiveAddDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [options, setOptions] = useState(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
  const valueRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [clipboardPending, setClipboardPending] = useState(false)
  const [clipboardFeedback, setClipboardFeedback] = useState<string | null>(null)
  const clipboardRequestId = useRef(0)
  const manualPasteRequested = useRef(false)
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey)
  const analysis = useMemo(() => analyzeArchiveUrlInput(value), [value])
  const tooMany = analysis.nonEmptyCount > 100
  const inputSummary = archiveUrlInputSummary(analysis)
  const previewUrl =
    analysis.nonEmptyCount === 1 && isSourcePreviewInput(analysis.lines[0]?.value)
      ? analysis.lines[0]?.value
      : undefined
  const createMutation = useMutation(
    trpc.archiveInbox.create.mutationOptions({
      onSuccess: async (result) => {
        toast.success('链接已加入收件箱', {
          description: `新增 ${result.acceptedCount} · 重复 ${result.duplicateCount} · 无效 ${result.invalidCount} · 拒绝 ${result.rejectedCount}`
        })
        setOpen(false)
        clipboardRequestId.current += 1
        manualPasteRequested.current = false
        valueRef.current = ''
        setClipboardPending(false)
        setClipboardFeedback(null)
        setValue('')
        setIdempotencyKey(createIdempotencyKey())
        onCreated?.(result)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() })
        ])
      },
      onError: (error) =>
        toast.error('加入收件箱失败', {
          description: archiveClientErrorMessage(error, '链接暂时无法加入，请稍后重试。')
        })
    })
  )

  const updateValue = (nextValue: string) => {
    manualPasteRequested.current = false
    valueRef.current = nextValue
    setValue(nextValue)
    setClipboardFeedback(null)
    setIdempotencyKey(createIdempotencyKey())
  }

  const applyClipboardText = (clipboardText: string) => {
    if (!clipboardText.trim()) {
      setClipboardFeedback('剪贴板里没有文字，请复制链接后重试。')
      return false
    }

    manualPasteRequested.current = false
    const nextValue = appendClipboardText(valueRef.current, clipboardText)
    valueRef.current = nextValue
    setValue(nextValue)
    setIdempotencyKey(createIdempotencyKey())
    setClipboardFeedback(`已粘贴 · ${archiveUrlInputSummary(analyzeArchiveUrlInput(nextValue))}`)
    return true
  }

  const prepareManualPaste = () => {
    manualPasteRequested.current = true
    const feedback = clipboardFallbackMessage()
    setClipboardFeedback(feedback)
    textareaRef.current?.focus()
    toast.info('无法一键读取剪贴板', { description: feedback })
  }

  const pasteFromClipboard = async () => {
    const requestId = ++clipboardRequestId.current
    setClipboardPending(true)
    setClipboardFeedback(null)

    try {
      if (!navigator.clipboard?.readText) throw new Error('浏览器不支持读取剪贴板')
      const clipboardText = await navigator.clipboard.readText()
      if (requestId !== clipboardRequestId.current) return
      applyClipboardText(clipboardText)
    } catch {
      if (requestId !== clipboardRequestId.current) return
      prepareManualPaste()
    } finally {
      if (requestId === clipboardRequestId.current) setClipboardPending(false)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!manualPasteRequested.current) return
    const clipboardText = event.clipboardData.getData('text/plain')
    if (!clipboardText.trim()) return
    event.preventDefault()
    applyClipboardText(clipboardText)
  }

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) setOptions(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
    if (!nextOpen && !createMutation.isPending) {
      clipboardRequestId.current += 1
      manualPasteRequested.current = false
      setClipboardPending(false)
      setClipboardFeedback(null)
      valueRef.current = ''
      setValue('')
      setIdempotencyKey(createIdempotencyKey())
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            添加链接
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[min(90vh,42rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>添加作品链接</DialogTitle>
          <DialogDescription>从剪贴板粘贴，或手动输入多个链接，每行一个。</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!analysis.nonEmptyCount || tooMany) return
            createMutation.mutate({
              idempotencyKey,
              ...options,
              urls: analysis.lines.map((line) => line.raw)
            })
          }}
        >
          <FieldGroup>
            <Field data-invalid={tooMany || undefined}>
              <FieldLabel htmlFor="archive-intake-urls">作品链接</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  ref={textareaRef}
                  id="archive-intake-urls"
                  name="archive-intake-urls"
                  aria-invalid={tooMany || undefined}
                  rows={6}
                  maxLength={204_800}
                  value={value}
                  onChange={(event) => updateValue(event.target.value)}
                  onPaste={handlePaste}
                  placeholder="粘贴画廊页或图片页链接"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={createMutation.isPending}
                />
                <InputGroupAddon align="block-start" className="border-b">
                  <InputGroupButton
                    variant="secondary"
                    size="sm"
                    className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                    onClick={() => void pasteFromClipboard()}
                    disabled={clipboardPending || createMutation.isPending}
                  >
                    {clipboardPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <ClipboardPasteIcon data-icon="inline-start" aria-hidden="true" />
                    )}
                    {clipboardPending ? '正在读取…' : '从剪贴板粘贴'}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription role="status" aria-live="polite">
                {clipboardFeedback ?? inputSummary}
              </FieldDescription>
              {tooMany ? <FieldError>一次最多添加 100 行，请分次提交。</FieldError> : null}
            </Field>
          </FieldGroup>

          <ArchiveIntakeOptions
            value={options}
            onChange={(nextOptions) => {
              setOptions(nextOptions)
              setIdempotencyKey(createIdempotencyKey())
            }}
            disabled={createMutation.isPending}
          />

          <DialogFooter>
            {previewUrl ? (
              <SourcePreviewButton
                source={{ kind: 'url', url: previewUrl }}
                variant="secondary"
                className="min-h-11 sm:min-h-9"
                disabled={createMutation.isPending}
                onOpened={() => changeOpen(false)}
              >
                仅预览
              </SourcePreviewButton>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => changeOpen(false)}
              disabled={createMutation.isPending}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="min-h-11 sm:min-h-9"
              disabled={!analysis.nonEmptyCount || tooMany || clipboardPending || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {createMutation.isPending
                ? '正在加入…'
                : analysis.nonEmptyCount
                  ? `加入 ${analysis.nonEmptyCount} 条`
                  : '加入收件箱'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function createIdempotencyKey() {
  return `archive-intake:create:${createBrowserUuid()}`
}

function appendClipboardText(currentValue: string, clipboardText: string) {
  const next = clipboardText.trim()
  if (!currentValue.trim()) return next
  return `${currentValue.replace(/\s+$/, '')}\n${next}`
}

function archiveUrlInputSummary(analysis: ReturnType<typeof analyzeArchiveUrlInput>) {
  if (!analysis.nonEmptyCount) return '支持已接入来源的公开画廊页和图片页链接。'

  const issues = [
    analysis.invalidCount ? `${analysis.invalidCount} 条格式待检查` : null,
    analysis.duplicateCount ? `${analysis.duplicateCount} 条重复` : null
  ].filter(Boolean)

  return issues.length
    ? `${analysis.nonEmptyCount} 条链接 · ${issues.join(' · ')}`
    : `${analysis.nonEmptyCount} 条链接可加入`
}

function clipboardFallbackMessage() {
  const reason =
    window.isSecureContext === false ? '当前访问地址不是安全连接，无法一键读取剪贴板' : '浏览器未允许一键读取剪贴板'
  return `${reason}；已定位输入框，请按 Ctrl+V 或使用系统粘贴。`
}

function isSourcePreviewInput(input: string | undefined) {
  if (!input) return false
  try {
    const url = new URL(input)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.toLowerCase() === 'e-hentai.org' &&
      (/^\/g\/[1-9]\d*\/[A-Za-z0-9]+\/?$/.test(url.pathname) ||
        /^\/s\/[A-Za-z0-9]+\/[1-9]\d*-[1-9]\d*\/?$/.test(url.pathname))
    )
  } catch {
    return false
  }
}
