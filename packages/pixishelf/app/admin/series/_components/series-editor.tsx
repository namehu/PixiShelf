'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Undo2, Redo2, Save, Trash2, Pencil, ExternalLink, LibraryBig, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { PageState } from '@/components/layout/page-state'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { confirm } from '@/components/shared/global-confirm'
import type { SeriesArtworkRow } from '@/schemas/series-management'
import {
  changeDraft,
  undoDraft,
  redoDraft,
  moveDraft,
  sameOrder,
  naturalDraftOrder,
  type SeriesDraftHistory
} from './series-draft'
import { SeriesArtworkList, Cover } from './series-artwork-list'
import { SeriesAddArtworkSheet } from './series-add-artwork-sheet'
import { SeriesDialog } from './series-dialog'

export interface SeriesEditorHandle {
  dirty: boolean
  saving: boolean
  save: () => Promise<boolean>
  discard: () => void
}

export function SeriesEditor({
  seriesId,
  ref,
  onDelete
}: {
  seriesId: number
  ref: Ref<SeriesEditorHandle>
  onDelete: (id: number, title: string) => void
}) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const query = useQuery(trpc.series.getManagementDetail.queryOptions(seriesId, { refetchOnWindowFocus: false }))
  const [baseline, setBaseline] = useState<number[]>([])
  const [fingerprint, setFingerprint] = useState('')
  const [rowsById, setRowsById] = useState<Map<number, SeriesArtworkRow>>(new Map())
  const [draft, setDraft] = useState<SeriesDraftHistory>({ ids: [], past: [], future: [] })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [positionId, setPositionId] = useState<number | null>(null)
  const [position, setPosition] = useState('1')
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = !sameOrder(baseline, draft.ids)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const hydrate = (data: NonNullable<typeof query.data>) => {
    const ids = data.artworks.map((row) => row.id)
    setBaseline(ids)
    setFingerprint(data.membershipFingerprint)
    setRowsById(new Map(data.artworks.map((row) => [row.id, row])))
    setDraft({ ids, past: [], future: [] })
    setSelected(new Set())
    setConflict(false)
  }
  useEffect(() => {
    if (query.data && !dirtyRef.current) hydrate(query.data)
  }, [query.data])
  const mutation = useMutation(trpc.series.saveManagementChanges.mutationOptions())
  const explicitReorder = !sameOrder(draft.ids, naturalDraftOrder(draft.ids, rowsById))
  const save = async () => {
    if (saving || conflict) return false
    if (!dirty) return true
    setSaving(true)
    try {
      const result = await mutation.mutateAsync({
        seriesId,
        expectedFingerprint: fingerprint,
        finalArtworkIds: draft.ids,
        explicitReorder
      })
      // The commit succeeded even if the subsequent read fails. Never retry it with the old fingerprint.
      setBaseline(draft.ids)
      setFingerprint(result.membershipFingerprint)
      setDraft({ ids: draft.ids, past: [], future: [] })
      setSelected(new Set())
      toast.success('系列更改已保存')
      await client.invalidateQueries({ queryKey: trpc.series.list.queryKey() })
      await client.invalidateQueries({ queryKey: trpc.series.get.queryKey(seriesId) })
      try {
        const latest = await query.refetch()
        if (latest.data) hydrate(latest.data)
        else {
          setConflict(true)
          toast.error('更改已保存，但刷新失败，请重新加载')
        }
      } catch {
        setConflict(true)
      }
      return true
    } catch (error) {
      const e = error as { data?: { code?: string }; message?: string }
      if (e.data?.code === 'CONFLICT' || e.data?.code === 'NOT_FOUND') setConflict(true)
      toast.error(e.message || '保存失败，草稿已保留')
      return false
    } finally {
      setSaving(false)
    }
  }
  useImperativeHandle(ref, () => ({
    dirty,
    saving,
    save,
    discard: () => {
      if (query.data) hydrate(query.data)
    }
  }))
  const change = (ids: number[]) => {
    if (!saving) setDraft((state) => changeDraft(state, ids))
  }
  const remove = (ids: number[]) => {
    const removing = new Set(ids)
    change(draft.ids.filter((id) => !removing.has(id)))
    setSelected(new Set())
  }
  const add = (rows: SeriesArtworkRow[]) => {
    const map = new Map(rowsById)
    let rank = Math.max(query.data?.maxStoredSortOrder ?? 0, ...[...map.values()].map((row) => row.sortOrder))
    for (const row of rows) {
      if (map.has(row.id)) continue
      const recovered = query.data?.recoverableMembers.find((member) => member.artworkId === row.id)
      map.set(row.id, {
        ...row,
        sortOrder: recovered?.sortOrder ?? ++rank,
        provenance: recovered?.provenance ?? 'MANUAL',
        orderOverridden: recovered?.orderOverridden ?? false
      })
    }
    const ids = [...draft.ids, ...rows.map((row) => row.id).filter((id) => !draft.ids.includes(id))]
    setRowsById(map)
    change(explicitReorder ? ids : naturalDraftOrder(ids, map))
  }
  const allRows = draft.ids.map((id) => rowsById.get(id)!).filter(Boolean)
  const term = search.trim().toLocaleLowerCase()
  const filtered = allRows.filter(
    (row) => !term || `${row.title} ${row.author} ${row.id}`.toLocaleLowerCase().includes(term)
  )
  const allSelected = filtered.length > 0 && filtered.every((row) => selected.has(row.id))
  const added = draft.ids.filter((id) => !baseline.includes(id)).length
  const removed = baseline.filter((id) => !draft.ids.includes(id)).length
  const sourceRemoved = baseline.filter(
    (id) => !draft.ids.includes(id) && rowsById.get(id)?.provenance === 'SOURCE'
  ).length
  const reload = () =>
    confirm({
      title: '重新加载系列？',
      description: '当前草稿会被放弃，并读取最新成员与顺序。',
      confirmText: '放弃草稿并重载',
      onConfirm: async () => {
        const latest = await query.refetch()
        if (latest.data) hydrate(latest.data)
      }
    })
  if (query.isLoading) return <PageState variant="loading" title="正在加载系列" compact />
  if (!query.data) {
    return (
      <PageState
        variant="error"
        title="系列加载失败或不存在"
        description="请从左侧选择其他系列，或刷新页面重试。"
        compact
      />
    )
  }
  const series = query.data
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" aria-label="系列整理工作区">
      <div className="flex items-start gap-4 p-5">
        <Cover row={{ title: series.title, thumbnailUrl: series.coverImageUrl }} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <PrivacySensitiveText className="line-clamp-2 text-xl font-semibold tracking-tight">
              {series.title}
            </PrivacySensitiveText>
            <Badge variant="secondary">{draft.ids.length} 件作品</Badge>
            {series.pixivSource ? <Badge variant="outline">Pixiv · {series.pixivSource.externalId}</Badge> : null}
          </div>
          <PrivacySensitiveText className="hidden line-clamp-2 text-sm text-muted-foreground sm:block">
            {series.description || '将相关作品按阅读顺序整理在一起。'}
          </PrivacySensitiveText>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" disabled={saving} onClick={() => setEditOpen(true)} aria-label="编辑系列">
            <Pencil />
          </Button>
          <Button asChild variant="ghost" size="icon">
            <Link href={`/series/${seriesId}`} target="_blank" aria-label="浏览系列">
              <ExternalLink />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={saving}
            onClick={() => onDelete(seriesId, series.title)}
            aria-label="删除系列"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {conflict ? (
        <Alert className="mx-4 mb-3 w-auto">
          <AlertTitle>需要重新加载</AlertTitle>
          <AlertDescription>
            成员已变化或保存后刷新失败。草稿仍保留，请确认重载后重新整理。
            <Button variant="outline" size="sm" disabled={saving} onClick={reload}>
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-y bg-surface-muted px-4 py-3">
        <Input
          className="min-w-0 flex-1"
          aria-label="搜索系列内作品"
          placeholder="搜索作品、作者或 ID…"
          disabled={saving}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search ? (
          <Button variant="ghost" size="icon" onClick={() => setSearch('')} aria-label="清空作品搜索">
            <X />
          </Button>
        ) : null}
        <Button disabled={saving} onClick={() => setAddOpen(true)}>
          <Plus data-icon="inline-start" />
          添加作品
        </Button>
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
        <Checkbox
          aria-label="全选当前搜索结果"
          checked={allSelected ? true : filtered.some((r) => selected.has(r.id)) ? 'indeterminate' : false}
          disabled={saving || !filtered.length}
          onCheckedChange={(checked) =>
            setSelected((current) => {
              const next = new Set(current)
              for (const row of filtered) {
                if (checked === true) next.add(row.id)
                else next.delete(row.id)
              }
              return next
            })
          }
        />
        <span>{selected.size ? `已选 ${selected.size} 件` : `${filtered.length} 件作品`}</span>
        {selected.size ? (
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => remove([...selected])}>
            <Trash2 data-icon="inline-start" />
            从系列移除
          </Button>
        ) : null}
        {term ? (
          <span className="ml-auto">清空筛选后可调整顺序</span>
        ) : (
          <span className="ml-auto hidden sm:inline">拖动手柄，或使用位置移动</span>
        )}
      </div>
      {filtered.length ? (
        <SeriesArtworkList
          rows={filtered}
          fullIds={draft.ids}
          selected={selected}
          disabled={saving}
          sortingDisabled={Boolean(term)}
          searchKey={term}
          fill
          onSelect={(id, checked) =>
            setSelected((current) => {
              const next = new Set(current)
              if (checked) next.add(id)
              else next.delete(id)
              return next
            })
          }
          onOrder={change}
          onRemove={(id) => remove([id])}
          onPosition={(id) => {
            setPositionId(id)
            setPosition(String(draft.ids.indexOf(id) + 1))
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
          <PageState
            variant="empty"
            title={term ? '没有匹配作品' : '这个系列还没有作品'}
            description={term ? '清空搜索查看全部作品。' : '添加作品，开始编排阅读顺序。'}
            compact
          />
        </div>
      )}
      {sourceRemoved ? (
        <Alert className="mx-4 mb-2 w-auto shrink-0">
          <AlertDescription>
            保存后，{sourceRemoved} 件 Pixiv 来源作品将被排除，普通核对不会自动加回；可通过添加作品恢复。
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-background px-4 py-3" aria-live="polite">
        <div className="mr-auto flex w-full items-center gap-2 text-xs text-muted-foreground sm:w-auto">
          <LibraryBig className="size-4" />
          <span>
            {dirty ? `新增 ${added} · 移除 ${removed}${explicitReorder ? ' · 顺序已调整' : ''}` : '所有更改已保存'}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="撤销"
          disabled={saving || !draft.past.length}
          onClick={() => setDraft(undoDraft)}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="重做"
          disabled={saving || !draft.future.length}
          onClick={() => setDraft(redoDraft)}
        >
          <Redo2 />
        </Button>
        <Button
          variant="outline"
          disabled={saving || !dirty}
          onClick={() =>
            confirm({
              title: '放弃全部更改？',
              description: '尚未保存的增删和排序都会撤销。',
              confirmText: '放弃更改',
              onConfirm: () => hydrate(series)
            })
          }
        >
          放弃
        </Button>
        <Button className="ml-auto sm:ml-0" disabled={saving || !dirty || conflict} onClick={() => void save()}>
          <Save data-icon="inline-start" />
          {saving ? '保存中…' : '保存更改'}
        </Button>
      </div>
      <SeriesAddArtworkSheet open={addOpen} onOpenChange={setAddOpen} existingIds={draft.ids} onAdd={add} />
      <SeriesDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        series={{ ...series, coverImageUrl: series.storedCoverImageUrl }}
        onSuccess={() => {
          void query.refetch()
        }}
      />
      <Dialog
        open={positionId !== null}
        onOpenChange={(open) => {
          if (!open) setPositionId(null)
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>移动到指定位置</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="series-target-position">目标序号（1–{draft.ids.length}）</FieldLabel>
            <Input
              id="series-target-position"
              type="number"
              min={1}
              max={draft.ids.length}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              disabled={
                saving ||
                Boolean(term) ||
                !Number.isInteger(Number(position)) ||
                Number(position) < 1 ||
                Number(position) > draft.ids.length
              }
              onClick={() => {
                if (positionId !== null) change(moveDraft(draft.ids, positionId, Number(position)))
                setPositionId(null)
              }}
            >
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
