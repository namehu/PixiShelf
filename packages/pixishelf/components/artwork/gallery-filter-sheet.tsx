'use client'
import { useRef, useState } from 'react'
import { BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthUser } from '@/components/auth'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useArtworkQuickFilters } from '@/hooks/use-artwork-quick-filters'
import { FilterSheet, type FilterSheetProps } from './filter-sheet'
import { QuickFilterList } from './quick-filter-list'
import { SSheet } from '@/components/shared/s-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import {
  quickFilterNameSchema,
  type QuickFilterScope,
  type ArtworkQuerySnapshot,
  type ArtworkQuickFilter
} from '@/schemas/artwork-quick-filter.dto'

type Props = FilterSheetProps & {
  scope?: QuickFilterScope
  initialTab?: 'conditions' | 'saved'
  onApplySnapshot: (query: ArtworkQuerySnapshot) => void
}
export function GalleryFilterSheet(props: Props) {
  const userId = useAuthUser()?.id
  return props.open && userId ? (
    <Content key={`${userId}:${props.scope?.kind === 'artist' ? props.scope.artistId : 'global'}`} {...props} />
  ) : null
}
function Content(props: Props) {
  const api = useArtworkQuickFilters(true, props.scope)
  const navigationEnabled = props.scope?.kind !== 'artist'
  const desktop = useMediaQuery('(min-width: 640px)')
  const [tab, setTab] = useState(props.initialTab ?? 'conditions')
  const [ordinary, setOrdinary] = useState<ArtworkQuerySnapshot | null>(null)
  const [editing, setEditing] = useState<ArtworkQuickFilter | null>(null)
  const [rename, setRename] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [pin, setPin] = useState(true)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; action: () => void } | null>(
    null
  )
  const getter = useRef<(() => ArtworkQuerySnapshot) | null>(null)
  const input = editing?.query ?? ordinary
  function snapshot() {
    return getter.current!()
  }
  function safely(action: () => void) {
    try {
      setError('')
      action()
    } catch {
      setError('筛选条件无效，请检查日期范围和输入内容。')
    }
  }
  function endEdit() {
    setEditing(null)
    setRename(false)
    setError('')
    setTab('saved')
  }
  function guard(action: () => void) {
    if (api.busy) return
    let dirty = false
    if (editing) {
      try {
        dirty = name !== editing.name || JSON.stringify(snapshot()) !== JSON.stringify(editing.query)
      } catch {
        dirty = true
      }
    }
    if (dirty) setConfirmation({ title: '放弃未保存的修改？', description: '快捷筛选仍保留上次保存的条件。', action })
    else action()
  }
  async function save() {
    const validated = quickFilterNameSchema.safeParse(name)
    if (!validated.success) {
      setError(validated.error.issues[0]?.message ?? '名称无效')
      return
    }
    let query: ArtworkQuerySnapshot
    try {
      query = snapshot()
    } catch {
      setError('筛选条件无效，请检查日期范围。')
      return
    }
    setError('')
    const ok = editing
      ? await api.update({ id: editing.id, revision: editing.revision, name: validated.data, query })
      : await api.create({ name: validated.data, query, pin: navigationEnabled && pin })
    if (ok) {
      toast.success(editing ? '快捷筛选已更新' : '快捷筛选已保存')
      setSaving(false)
      if (editing) endEdit()
    }
  }
  return (
    <FilterSheet
      {...props}
      {...(input
        ? {
            currentSearch: input.search,
            currentMediaKinds: input.mediaKinds,
            currentSortBy: input.sortBy,
            currentArtist: input.artist,
            currentTags: input.tags,
            currentSources: input.sources,
            currentHasAudio: input.hasAudio,
            currentReadingStatuses: input.readingStatuses,
            currentRatingLevels: input.ratingLevels,
            currentExcludedArtists: input.excludedArtists,
            startDate: input.startDate,
            endDate: input.endDate,
            createdStartDate: input.createdStartDate,
            createdEndDate: input.createdEndDate,
            randomSeed: undefined
          }
        : {})}
      renderFrame={({ content, footer, getSnapshot }) => {
        getter.current = getSnapshot
        const naming = saving || !!editing
        return (
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (!editing && !saving) setTab(value as typeof tab)
            }}
          >
            <SSheet
              open
              onOpenChange={(open) => {
                if (!open) guard(() => props.onOpenChange(false))
              }}
              side={desktop ? 'right' : 'bottom'}
              preventOpenAutoFocus
              className="h-[90dvh] max-h-[90dvh] rounded-t-xl sm:h-full sm:max-h-dvh sm:max-w-md sm:rounded-none [&>.overflow-y-auto]:min-h-0 [&>.overflow-y-auto]:overscroll-contain [&>[data-slot=sheet-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))]"
              title={
                editing ? (
                  <span>
                    编辑：<PrivacySensitiveText>{editing.name}</PrivacySensitiveText>
                  </span>
                ) : (
                  '筛选作品'
                )
              }
              description={
                editing
                  ? '保存修改只更新快捷筛选，不改变当前作品列表。'
                  : navigationEnabled
                    ? '组合常用条件，保存为自己的浏览入口。'
                    : '快捷筛选仅在当前艺术家详情页中使用。'
              }
              headerExtra={
                <div className="px-4 pb-3">
                  <TabsList className="w-full">
                    <TabsTrigger value="conditions" disabled={naming}>
                      筛选条件
                    </TabsTrigger>
                    <TabsTrigger value="saved" disabled={naming}>
                      快捷筛选
                    </TabsTrigger>
                  </TabsList>
                </div>
              }
              footer={
                tab === 'conditions' ? (
                  naming ? (
                    <div className="flex w-full gap-3">
                      <Button
                        variant="outline"
                        className="min-h-11 flex-1"
                        disabled={api.busy}
                        onClick={() => (editing ? guard(endEdit) : setSaving(false))}
                      >
                        取消
                      </Button>
                      <Button className="min-h-11 flex-[2]" disabled={api.busy} onClick={() => void save()}>
                        {api.busy ? '保存中…' : editing ? '保存修改' : '保存快捷筛选'}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex w-full flex-col gap-2">
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        disabled={api.loading || api.busy || api.items.length >= 100}
                        onClick={() =>
                          safely(() => {
                            snapshot()
                            setName('')
                            setPin(api.navigation.ids.length < 10)
                            setSaving(true)
                          })
                        }
                      >
                        <BookmarkPlus data-icon="inline-start" />
                        {api.items.length >= 100 ? '已保存 100 条，请先删除部分筛选' : '保存为快捷筛选'}
                      </Button>
                      {footer}
                    </div>
                  )
                ) : (
                  <p className="w-full text-center text-xs text-muted-foreground">
                    已保存 {api.items.length}/100 条 · 点击即可应用
                  </p>
                )
              }
            >
              {(error || api.error) && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    {error || api.error}
                    {api.error && (
                      <Button variant="link" onClick={api.refresh}>
                        刷新列表
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <TabsContent value="conditions" forceMount hidden={tab !== 'conditions'}>
                {naming && (
                  <FieldGroup className="mb-6 gap-4">
                    <Field>
                      <FieldLabel htmlFor="quick-filter-name">快捷筛选名称</FieldLabel>
                      <Input
                        id="quick-filter-name"
                        autoFocus
                        value={name}
                        maxLength={40}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="例如：未读漫画"
                        disabled={api.busy}
                      />
                    </Field>
                    {!editing && navigationEnabled && (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="quick-filter-pin">
                          加入导航{api.navigation.ids.length >= 10 ? '（已满 10 项）' : ''}
                        </FieldLabel>
                        <Switch
                          id="quick-filter-pin"
                          checked={pin}
                          onCheckedChange={setPin}
                          disabled={api.busy || api.navigation.ids.length >= 10}
                        />
                      </Field>
                    )}
                  </FieldGroup>
                )}
                {!!editing?.invalidReferences?.length && (
                  <Alert className="mb-4">
                    <AlertDescription>
                      <PrivacySensitiveText>
                        已失效：{editing.invalidReferences.join('、')}。请移除或重新选择后保存。
                      </PrivacySensitiveText>
                    </AlertDescription>
                  </Alert>
                )}
                <div hidden={rename} aria-busy={api.busy}>
                  <fieldset disabled={api.busy} className="min-w-0">
                    {content}
                  </fieldset>
                </div>
              </TabsContent>
              <TabsContent value="saved" forceMount hidden={tab !== 'saved'}>
                {api.loading ? (
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <QuickFilterList
                    navigationEnabled={navigationEnabled}
                    items={api.items}
                    ids={api.navigation.ids}
                    busy={api.busy}
                    onApply={(item) => {
                      props.onApplySnapshot(item.query)
                      props.onOpenChange(false)
                    }}
                    onEdit={(item, renameOnly) =>
                      safely(() => {
                        setOrdinary(snapshot())
                        setEditing(item)
                        setRename(!!renameOnly)
                        setName(item.name)
                        setTab('conditions')
                      })
                    }
                    onDelete={(item) =>
                      setConfirmation({
                        title: '删除快捷筛选？',
                        description: navigationEnabled
                          ? '删除后会同时移出导航，当前作品列表不受影响。'
                          : '删除后无法恢复，当前作品列表不受影响。',
                        action: () => {
                          void api.remove(item.id, item.revision)
                        }
                      })
                    }
                    onOrder={(ids) => {
                      void api.setNavigation(ids)
                    }}
                  />
                )}
              </TabsContent>
            </SSheet>
            <AlertDialog
              open={!!confirmation}
              onOpenChange={(open) => {
                if (!open) setConfirmation(null)
              }}
            >
              <AlertDialogContent>
                <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      confirmation?.action()
                      setConfirmation(null)
                    }}
                  >
                    确认
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Tabs>
        )
      }}
    />
  )
}
