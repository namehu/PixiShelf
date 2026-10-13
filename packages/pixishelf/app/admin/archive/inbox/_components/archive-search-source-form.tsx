'use client'
import { useEffect } from 'react'
import {
  ARCHIVE_TITLE_MATCH_LABELS,
  MAX_ARCHIVE_TITLE_UPLOADERS,
  type ArchiveTitleQuery
} from '@pixishelf/job-contracts'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Spinner } from '@/components/ui/spinner'
import type { CreatorOption } from '@/components/creators/creator-picker'
import { ArchiveUploaderIdentityField, type SavedUploaderOption } from './archive-uploader-identity-field'
import { SourceCreatorField } from './source-creator-field'
import { useArchiveSearchSource, type ArchiveSearchDialogState } from './use-archive-search-source'

export function ArchiveSearchSourceForm({
  state,
  onClose,
  onSaved,
  sources = [],
  creators,
  onCreatorsChange,
  onPendingChange
}: {
  state: ArchiveSearchDialogState | null
  onClose: () => void
  onSaved: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
  creators: CreatorOption[]
  onCreatorsChange: (value: CreatorOption[]) => void
  onPendingChange?: (value: boolean) => void
}) {
  const {
    displayName,
    setDisplayName,
    keyword,
    setKeyword,
    matchMode,
    setMatchMode,
    identity,
    saving,
    uploaders,
    setUploaders,
    error,
    renameOnly,
    pending,
    addUploader,
    submit
  } = useArchiveSearchSource({ state, onClose, onSaved, artistIds: creators.map(({ id }) => id) })
  useEffect(() => {
    onPendingChange?.(pending)
  }, [pending, onPendingChange])
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FieldGroup className="min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain px-5 py-5">
        <Field data-disabled={renameOnly || pending} data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="search-source-keyword">标题关键词</FieldLabel>
          <Input
            id="search-source-keyword"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            required
            maxLength={160}
            disabled={renameOnly || pending}
            aria-invalid={Boolean(error)}
            aria-describedby="search-keyword-description"
          />
          <FieldDescription id="search-keyword-description">
            忽略大小写和首尾空白，保留括号与下划线。不支持正则、双引号、星号和百分号。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="search-source-name">来源名称</FieldLabel>
          <Input
            id="search-source-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required={renameOnly}
            placeholder={renameOnly ? undefined : '留空时使用标题关键词'}
            aria-describedby={renameOnly ? undefined : 'search-source-name-description'}
            maxLength={180}
            disabled={pending}
          />
          {!renameOnly ? (
            <FieldDescription id="search-source-name-description">仅用于显示，不影响搜索条件。</FieldDescription>
          ) : null}
        </Field>
        <Field data-disabled={renameOnly || pending}>
          <FieldLabel id="search-match-label">匹配方式</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={matchMode}
            onValueChange={(value) => {
              if (value) setMatchMode(value as ArchiveTitleQuery['matchMode'])
            }}
            disabled={renameOnly || pending}
            aria-labelledby="search-match-label"
          >
            {Object.entries(ARCHIVE_TITLE_MATCH_LABELS).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <details open={renameOnly || undefined} className="group border-t pt-4">
          <summary className="cursor-pointer rounded-sm py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            限定上传者（可选）{uploaders.length > 0 ? ` · ${uploaders.length} 位` : ''}
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            {uploaders.length ? (
              <Field>
                <FieldLabel>
                  已限定上传者（{uploaders.length}/{MAX_ARCHIVE_TITLE_UPLOADERS}）
                </FieldLabel>
                <ul className="flex flex-wrap gap-2" aria-label="已限定上传者">
                  {uploaders.map((uploader) => (
                    <li key={uploader.uid} className="flex items-center gap-1">
                      <Badge variant="secondary">
                        <PrivacySensitiveText>{uploader.displayName ?? `UID ${uploader.uid}`}</PrivacySensitiveText>
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={renameOnly || pending}
                        aria-label={`移除 UID ${uploader.uid}`}
                        onClick={() => setUploaders(uploaders.filter(({ uid }) => uid !== uploader.uid))}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
                <FieldDescription>匹配其中任意一个上传者；重复 UID 会自动去重。</FieldDescription>
              </Field>
            ) : null}
            <ArchiveUploaderIdentityField
              identity={identity}
              label={uploaders.length ? '继续添加上传者' : '限定上传者（可选）'}
              optional={!uploaders.length}
              sources={sources}
              disabled={renameOnly || pending}
            />
            <Button
              type="button"
              variant="outline"
              disabled={renameOnly || pending || !identity.draft.value.trim()}
              onClick={() => void addUploader()}
            >
              <Plus data-icon="inline-start" />
              添加上传者
            </Button>
          </div>
        </details>
        {!renameOnly ? <SourceCreatorField value={creators} onChange={onCreatorsChange} disabled={pending} /> : null}
        {error ? <FieldError role="alert">{error}</FieldError> : null}
      </FieldGroup>
      <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 border-t px-5 py-4 sm:flex sm:flex-row [&>button]:h-11">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          取消
        </Button>
        <Button type="submit" disabled={pending || (renameOnly ? !displayName.trim() : !keyword.trim())}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {renameOnly ? '保存名称' : saving && identity.pending ? '识别并保存中' : '保存搜索来源'}
        </Button>
      </DialogFooter>
    </form>
  )
}
