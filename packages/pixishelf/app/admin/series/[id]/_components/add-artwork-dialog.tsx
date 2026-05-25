'use client'
import { useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDebounce } from '@/hooks/useDebounce'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useMutation } from '@tanstack/react-query'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  seriesId: number
  existingArtworkIds: number[]
  onSuccess: () => void
}

export function AddArtworkDialog({ open, onOpenChange, seriesId, existingArtworkIds, onSuccess }: Props) {
  const trpc = useTRPC()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 500)

  const { data, isLoading } = useQuery(
    trpc.artwork.list.queryOptions(
      {
        search: debouncedQuery,
        pageSize: 10
      },
      {
        enabled: open
      }
    )
  )

  const addMutation = useMutation(
    trpc.series.addArtwork.mutationOptions({
      onSuccess: () => {
        toast.success('添加成功')
        onSuccess()
      }
    })
  )

  const handleAdd = (artworkId: number) => {
    addMutation.mutate({ seriesId, artworkId })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>添加作品到系列</DialogTitle>
        </DialogHeader>
        <div className="p-1">
          <Input placeholder="搜索作品标题..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {isLoading ? (
            <div className="p-4 text-center">加载中...</div>
          ) : (
            <div className="space-y-2">
              {data?.items.map((item: any) => {
                const isAdded = existingArtworkIds.includes(item.id)
                return (
                  <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-muted rounded border">
                    <Avatar className="w-12 h-12 rounded">
                      <AvatarImage src={item.thumbnailUrl || ''} />
                      <AvatarFallback>?</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-medium truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground">ID: {item.id}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={isAdded ? 'secondary' : 'default'}
                      disabled={isAdded || addMutation.isPending}
                      onClick={() => handleAdd(item.id)}
                    >
                      {isAdded ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </Button>
                  </div>
                )
              })}
              {data?.items.length === 0 && <div className="p-4 text-center text-muted-foreground">未找到作品</div>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
