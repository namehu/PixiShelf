'use client'
import { useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Trash, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { AddArtworkDialog } from './add-artwork-dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface Props {
  seriesId: number
}

export default function SeriesDetailAdmin({ seriesId }: Props) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const { data: series, isLoading } = useQuery(trpc.series.get.queryOptions(seriesId))

  const removeMutation = useMutation(
    trpc.series.removeArtwork.mutationOptions({
      onSuccess: () => {
        toast.success('已移除')
        queryClient.invalidateQueries({ queryKey: trpc.series.get.queryKey(seriesId) })
      }
    })
  )

  const reorderMutation = useMutation(
    trpc.series.reorderArtworks.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.series.get.queryKey(seriesId) })
      }
    })
  )

  const handleRemove = (artworkId: number) => {
    if (confirm('确定从系列中移除该作品吗？')) {
      removeMutation.mutate({ seriesId, artworkId })
    }
  }

  // Simplified Reorder: Move Up/Down
  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (!series?.artworks) return
    const newArtworks = [...series.artworks]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newArtworks.length) return

    // Swap
    const temp = newArtworks[index]
    newArtworks[index] = newArtworks[targetIndex]
    newArtworks[targetIndex] = temp

    // Save
    reorderMutation.mutate({
      seriesId,
      artworkIds: newArtworks.map((a: any) => a.id)
    })
  }

  if (isLoading) return <div>加载中...</div>
  if (!series) return <div>系列不存在</div>

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">系列详情: {series.title}</h2>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          添加作品
        </Button>
      </div>

      <div className="border rounded-md p-4 bg-muted/20">
        <p className="text-sm text-muted-foreground">{series.description}</p>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">排序</TableHead>
              <TableHead>缩略图</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.artworks.map((artwork: any, index: number) => (
              <TableRow key={artwork.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {index + 1}
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === 0}
                        onClick={() => handleMove(index, 'up')}
                      >
                        ▲
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === series.artworks.length - 1}
                        onClick={() => handleMove(index, 'down')}
                      >
                        ▼
                      </Button>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Avatar className="w-12 h-12 rounded">
                    <AvatarImage src={artwork.thumbnailUrl || ''} />
                    <AvatarFallback>?</AvatarFallback>
                  </Avatar>
                </TableCell>
                <TableCell>{artwork.title}</TableCell>
                <TableCell>{artwork.id}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleRemove(artwork.id)}>
                    <Trash className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {series.artworks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  暂无作品
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AddArtworkDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        seriesId={seriesId}
        existingArtworkIds={series.artworks.map((a: any) => a.id)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: trpc.series.get.queryKey(seriesId) })}
      />
    </div>
  )
}
