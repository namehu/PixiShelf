'use client'
import { useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Edit, Trash, Plus, ExternalLink, LibraryBig } from 'lucide-react'
import { SeriesDialog } from './series-dialog'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from 'sonner'
import Link from 'next/link'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AdminSectionHeader, AdminTableFrame } from '../../_components/admin-workbench'
import { confirm } from '@/components/shared/global-confirm'
import { PageState } from '@/components/layout/page-state'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PixivSeriesReconciliationDialog } from './pixiv-series-reconciliation-dialog'

export default function SeriesManagement() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [page] = useState(1)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 500)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pixivDialogOpen, setPixivDialogOpen] = useState(false)
  const [editingSeries, setEditingSeries] = useState<any>(null)
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'PIXIV' | 'LOCAL'>('ALL')
  const [pixivStatus, setPixivStatus] = useState<'UNCHECKED' | 'SUCCESS' | 'PARTIAL' | 'NO_DATA' | 'FAILED' | 'ALL'>(
    'ALL'
  )

  const { data, isLoading } = useQuery(
    trpc.series.list.queryOptions({
      page,
      pageSize: 20,
      query: debouncedQuery,
      source: sourceFilter,
      pixivStatus: pixivStatus === 'ALL' ? undefined : pixivStatus
    })
  )

  const deleteMutation = useMutation(
    trpc.series.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        queryClient.invalidateQueries({ queryKey: trpc.series.list.queryKey() })
      }
    })
  )

  const handleDelete = (id: number, title: string) => {
    confirm({
      title: `删除系列“${title}”？`,
      description: '系列记录会被永久删除；作品本身仍保留在图库中。',
      confirmText: '确认删除',
      variant: 'destructive',
      onConfirm: () => deleteMutation.mutate(id)
    })
  }

  const handleEdit = (item: any) => {
    setEditingSeries(item)
    setDialogOpen(true)
  }

  const handleCreate = () => {
    setEditingSeries(null)
    setDialogOpen(true)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSectionHeader
        title="系列列表"
        description="按标题查找系列，进入详情可调整系列内作品。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPixivDialogOpen(true)}>
              <LibraryBig data-icon="inline-start" aria-hidden="true" />
              核对 Pixiv 系列
            </Button>
            <Button onClick={handleCreate}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              新建系列
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          name="series-search"
          aria-label="搜索系列"
          autoComplete="off"
          placeholder="搜索系列…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as typeof sourceFilter)}>
          <SelectTrigger className="w-[150px]" aria-label="筛选系列来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ALL">全部来源</SelectItem>
              <SelectItem value="PIXIV">Pixiv 来源</SelectItem>
              <SelectItem value="LOCAL">本地整理</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={pixivStatus} onValueChange={(value) => setPixivStatus(value as typeof pixivStatus)}>
          <SelectTrigger className="w-[160px]" aria-label="筛选 Pixiv 系列状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ALL">全部核对状态</SelectItem>
              <SelectItem value="UNCHECKED">待检查</SelectItem>
              <SelectItem value="SUCCESS">成功</SelectItem>
              <SelectItem value="PARTIAL">部分成功</SelectItem>
              <SelectItem value="NO_DATA">无数据</SelectItem>
              <SelectItem value="FAILED">失败</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <AdminTableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>封面</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>核对状态</TableHead>
              <TableHead>作品数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  正在加载…
                </TableCell>
              </TableRow>
            ) : (
              data?.items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Avatar className="size-10 rounded">
                      <AvatarImage src={item.coverImageUrl || ''} alt={item.title} />
                      <AvatarFallback>{item.title[0]}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/series/${item.id}`} className="hover:underline font-medium">
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {item.sourceKind === 'PIXIV' ? (
                      <Badge variant="secondary">Pixiv · {item.pixivSource?.externalId}</Badge>
                    ) : (
                      <Badge variant="outline">本地</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <PixivSeriesStatusBadge source={item.pixivSource} />
                  </TableCell>
                  <TableCell>{item.artworkCount}</TableCell>
                  <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(item)}
                      aria-label={`编辑系列 ${item.title}`}
                    >
                      <Edit aria-hidden="true" />
                    </Button>
                    <Button asChild variant="ghost" size="icon">
                      <Link href={`/admin/series/${item.id}`} aria-label={`管理系列 ${item.title}`}>
                        <ExternalLink aria-hidden="true" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => handleDelete(item.id, item.title)}
                      aria-label={`删除系列 ${item.title}`}
                    >
                      <Trash aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
            {!isLoading && (!data?.items || data.items.length === 0) && (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <PageState variant="empty" title="暂无系列" description="新建系列后可在这里组织作品。" compact />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </AdminTableFrame>

      <SeriesDialog open={dialogOpen} onOpenChange={setDialogOpen} series={editingSeries} onSuccess={() => {}} />
      <PixivSeriesReconciliationDialog
        open={pixivDialogOpen}
        onOpenChange={setPixivDialogOpen}
        onStatusChanged={() => queryClient.invalidateQueries({ queryKey: trpc.series.list.queryKey() })}
      />
    </div>
  )
}

function PixivSeriesStatusBadge({
  source
}: {
  source: { status: 'SUCCESS' | 'PARTIAL' | 'NO_DATA' | 'FAILED' | null; lastError: string | null } | null
}) {
  if (!source) return <span className="text-muted-foreground">—</span>
  if (!source.status) return <Badge variant="outline">待检查</Badge>
  const display = {
    SUCCESS: { label: '成功', variant: 'success' as const },
    PARTIAL: { label: '部分成功', variant: 'warning' as const },
    NO_DATA: { label: '无数据', variant: 'muted' as const },
    FAILED: { label: '失败', variant: 'destructive' as const }
  }[source.status]
  return (
    <Badge variant={display.variant} title={source.lastError ?? undefined}>
      {display.label}
    </Badge>
  )
}
