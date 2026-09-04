'use client'
import { useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowDown, ArrowUp, Trash, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { AddArtworkDialog } from './add-artwork-dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { confirm } from '@/components/shared/global-confirm'
import { PageState } from '@/components/layout/page-state'
import { AdminTableFrame, AdminWorkbench } from '../../../_components/admin-workbench'
import { Badge } from '@/components/ui/badge'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface Props {
  seriesId: number
}

export default function SeriesDetailAdmin({ seriesId }: Props) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const { data: series, isLoading, isError } = useQuery(trpc.series.get.queryOptions(seriesId))

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
    const artwork = series?.artworks.find((item) => item.id === artworkId)
    const sourceOwned = artwork?.seriesMembership.provenance === 'SOURCE'
    confirm({
      title: '从系列中移除该作品？',
      description: sourceOwned
        ? '作品本身不会被删除。该 Pixiv 来源成员会被本地排除，之后的普通核对不会自动加回。'
        : '作品本身不会被删除，只会解除与当前系列的关联。',
      confirmText: '确认移除',
      onConfirm: () => removeMutation.mutate({ seriesId, artworkId })
    })
  }

  // 简化版排序：上下移动当前作品
  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (!series?.artworks) return
    const newArtworks = [...series.artworks]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newArtworks.length) return

    // 交换相邻两项的顺序
    const temp = newArtworks[index]
    newArtworks[index] = newArtworks[targetIndex]
    newArtworks[targetIndex] = temp

    // 提交变更后的新顺序给服务端
    reorderMutation.mutate({
      seriesId,
      artworkIds: newArtworks.map((a: any) => a.id)
    })
  }

  if (isLoading) {
    return (
      <AdminWorkbench title="系列详情" description="正在读取系列内容。">
        <PageState variant="loading" title="正在加载系列" compact />
      </AdminWorkbench>
    )
  }
  if (isError) {
    return (
      <AdminWorkbench title="系列详情" description="管理系列内作品和显示顺序。">
        <PageState variant="error" title="系列加载失败" description="请刷新页面重试。" compact />
      </AdminWorkbench>
    )
  }
  if (!series) {
    return (
      <AdminWorkbench title="系列详情" description="管理系列内作品和显示顺序。">
        <PageState variant="empty" title="系列不存在" description="该系列可能已被删除。" compact />
      </AdminWorkbench>
    )
  }

  return (
    <AdminWorkbench
      title={<PrivacySensitiveText>{series.title}</PrivacySensitiveText>}
      eyebrow="系列管理"
      description={
        series.description ? <PrivacySensitiveText>{series.description}</PrivacySensitiveText> : '管理系列内作品和显示顺序。'
      }
      actions={
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          添加作品
        </Button>
      }
    >
      <AdminTableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">排序</TableHead>
              <TableHead>缩略图</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>关系来源</TableHead>
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
                        className="size-7"
                        disabled={index === 0}
                        onClick={() => handleMove(index, 'up')}
                        aria-label={`将 ${artwork.title} 上移`}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === series.artworks.length - 1}
                        onClick={() => handleMove(index, 'down')}
                        aria-label={`将 ${artwork.title} 下移`}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Avatar className="size-12 rounded">
                    <AvatarImage src={artwork.thumbnailUrl || ''} alt={artwork.title} />
                    <AvatarFallback>?</AvatarFallback>
                  </Avatar>
                </TableCell>
                <TableCell>
                  <PrivacySensitiveText>{artwork.title}</PrivacySensitiveText>
                </TableCell>
                <TableCell>
                  <MembershipBadge membership={artwork.seriesMembership} />
                </TableCell>
                <TableCell>{artwork.id}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => handleRemove(artwork.id)}
                    aria-label={`从系列移除 ${artwork.title}`}
                  >
                    <Trash aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {series.artworks.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  暂无作品
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </AdminTableFrame>

      <AddArtworkDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        seriesId={seriesId}
        existingArtworkIds={series.artworks.map((a: any) => a.id)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: trpc.series.get.queryKey(seriesId) })}
      />
    </AdminWorkbench>
  )
}

function MembershipBadge({
  membership
}: {
  membership: { provenance: 'SOURCE' | 'MANUAL' | 'LEGACY'; orderOverridden: boolean }
}) {
  if (membership.provenance === 'SOURCE') {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">Pixiv 来源</Badge>
        {membership.orderOverridden ? <Badge variant="outline">本地排序</Badge> : null}
      </div>
    )
  }
  if (membership.provenance === 'MANUAL') return <Badge variant="outline">手工添加</Badge>
  return <Badge variant="muted">历史关系</Badge>
}
