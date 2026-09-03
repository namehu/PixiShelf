import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ArchiveTaskStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
type ArchiveTaskKind = 'NEW' | 'UPDATE'

export interface TaskFilters {
  status: ArchiveTaskStatus | 'ALL'
  providerKey: string
  kind: ArchiveTaskKind | 'ALL'
  submissionId: string
  search: string
}

export function TaskFiltersForm({
  value,
  appliedValue,
  onChange,
  onImmediateChange,
  onSubmit,
  onReset
}: {
  value: TaskFilters
  appliedValue: TaskFilters
  onChange: (value: TaskFilters) => void
  onImmediateChange: (patch: Partial<TaskFilters>) => void
  onSubmit: () => void
  onReset: () => void
}) {
  const dirty = JSON.stringify(value) !== JSON.stringify(appliedValue)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[10rem_10rem_12rem_minmax(12rem,1fr)_minmax(14rem,1.5fr)_auto]">
        <Field>
          <FieldLabel htmlFor="archive-task-status">状态</FieldLabel>
          <Select
            value={value.status}
            onValueChange={(status) => onImmediateChange({ status: status as TaskFilters['status'] })}
          >
            <SelectTrigger id="archive-task-status" className="w-full">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ALL">全部状态</SelectItem>
                <SelectItem value="PENDING">排队中</SelectItem>
                <SelectItem value="RUNNING">下载中</SelectItem>
                <SelectItem value="PAUSED">已暂停</SelectItem>
                <SelectItem value="CANCELLING">正在取消</SelectItem>
                <SelectItem value="COMPLETED">已发布</SelectItem>
                <SelectItem value="FAILED">失败</SelectItem>
                <SelectItem value="CANCELLED">已取消</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="archive-task-kind">归档类型</FieldLabel>
          <Select value={value.kind} onValueChange={(kind) => onImmediateChange({ kind: kind as TaskFilters['kind'] })}>
            <SelectTrigger id="archive-task-kind" className="w-full">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ALL">全部类型</SelectItem>
                <SelectItem value="NEW">首次归档</SelectItem>
                <SelectItem value="UPDATE">更新归档</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="archive-task-provider">来源站点</FieldLabel>
          <Input
            id="archive-task-provider"
            name="archive-task-provider"
            value={value.providerKey}
            onChange={(event) => onChange({ ...value, providerKey: event.target.value })}
            placeholder="如 e-hentai…"
            autoComplete="off"
            maxLength={50}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="archive-task-submission">本次加入 ID</FieldLabel>
          <Input
            id="archive-task-submission"
            name="archive-task-submission"
            value={value.submissionId}
            onChange={(event) => onChange({ ...value, submissionId: event.target.value })}
            placeholder="精确匹配本次加入 ID…"
            autoComplete="off"
            maxLength={128}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="archive-task-search">标题或来源</FieldLabel>
          <Input
            id="archive-task-search"
            name="archive-task-search"
            value={value.search}
            onChange={(event) => onChange({ ...value, search: event.target.value })}
            placeholder="搜索标题、作品 ID 或来源…"
            autoComplete="off"
            maxLength={500}
          />
        </Field>
        <Field className="justify-end">
          <FieldLabel className="sr-only">筛选操作</FieldLabel>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!dirty}>
              <Search data-icon="inline-start" aria-hidden="true" />
              筛选
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!hasTaskFilters(value)} onClick={onReset}>
              清除
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </form>
  )
}

export function normalizeTaskFilters(value: TaskFilters): TaskFilters {
  return {
    ...value,
    providerKey: value.providerKey.trim(),
    submissionId: value.submissionId.trim(),
    search: value.search.trim()
  }
}

export function hasTaskFilters(value: TaskFilters): boolean {
  return (
    value.status !== 'ALL' ||
    value.kind !== 'ALL' ||
    Boolean(value.providerKey.trim() || value.submissionId.trim() || value.search.trim())
  )
}
