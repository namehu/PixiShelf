'use client'
import { useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Edit, Trash, Plus, ExternalLink } from 'lucide-react'
import { SeriesDialog } from './series-dialog'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import Link from 'next/link'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export default function SeriesManagement() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 500)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSeries, setEditingSeries] = useState<any>(null)

  const { data, isLoading } = useQuery(
    trpc.series.list.queryOptions({
      page,
      pageSize: 20,
      query: debouncedQuery
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

  const handleDelete = (id: number) => {
    if (confirm('确定删除该系列吗？')) {
      deleteMutation.mutate(id)
    }
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
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">系列管理</h2>
        <Button onClick={handleCreate}>
          <Plus className="w-4 h-4 mr-2" />
          新建系列
        </Button>
      </div>

      <div className="flex gap-4">
        <Input
          placeholder="搜索系列..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>封面</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>作品数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  加载中...
                </TableCell>
              </TableRow>
            ) : (
              data?.items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Avatar className="w-10 h-10 rounded">
                      <AvatarImage src={item.coverImageUrl || ''} />
                      <AvatarFallback>{item.title[0]}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/series/${item.id}`} className="hover:underline font-medium">
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell>{item.artworkCount}</TableCell>
                  <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Link href={`/admin/series/${item.id}`}>
                      <Button variant="ghost" size="icon">
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDelete(item.id)}>
                      <Trash className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
            {!isLoading && (!data?.items || data.items.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <SeriesDialog open={dialogOpen} onOpenChange={setDialogOpen} series={editingSeries} onSuccess={() => {}} />
    </div>
  )
}
