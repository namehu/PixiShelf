'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import MultipleSelector from '@/components/shared/multiple-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

export interface CreatorOption {
  id: number
  name: string
  kind?: string
}

export function CreatorPicker({
  value,
  onChange,
  maxSelected = 200
}: {
  value: CreatorOption[]
  onChange: (value: CreatorOption[]) => void
  maxSelected?: number
}) {
  const trpc = useTRPC()
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'PERSON' | 'GROUP'>('PERSON')
  const create = useMutation(
    trpc.artist.create.mutationOptions({
      onSuccess: (artist) => {
        onChange([...value, { id: artist.id, name: artist.name, kind: artist.kind }].slice(-maxSelected))
        setOpen(false)
        setName('')
        void queryClient.invalidateQueries({ queryKey: trpc.artist.queryPage.queryKey() })
      },
      onError: (error) => toast.error(error.message)
    })
  )
  return (
    <div className="flex flex-col gap-2">
      <MultipleSelector
        inputProps={{ 'aria-label': '搜索并选择艺术家或社团' }}
        value={value.map((v) => ({
          value: String(v.id),
          label: (v.kind === 'GROUP' ? '社团：' : '') + v.name,
          creatorName: v.name,
          kind: v.kind ?? 'PERSON'
        }))}
        defaultOptions={value.map((v) => ({
          value: String(v.id),
          label: v.name,
          creatorName: v.name,
          kind: v.kind ?? 'PERSON'
        }))}
        onSearch={async (search) => {
          const response = await client.artist.queryPage.query({ search, pageSize: 30 })
          return response.data.map((artist) => ({
            value: String(artist.id),
            label: (artist.kind === 'GROUP' ? '社团：' : '') + artist.name,
            creatorName: artist.name,
            kind: artist.kind
          }))
        }}
        onChange={(options) =>
          onChange(
            options.map((o) => ({
              id: Number(o.value),
              name: String(o.creatorName ?? o.label),
              kind: String(o.kind ?? 'PERSON')
            }))
          )
        }
        maxSelected={maxSelected}
        triggerSearchOnFocus
        placeholder="输入作者或社团名称，不知道可以留空"
      />
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        找不到？新建作者／社团
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建艺术家／社团</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-creator-name">名称</FieldLabel>
              <Input id="new-creator-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>类型</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as 'PERSON' | 'GROUP')}>
                <SelectTrigger aria-label="创作者类型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="PERSON">艺术家</SelectItem>
                    <SelectItem value="GROUP">社团</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate({ name: name.trim(), kind })}
            >
              创建并选择
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
