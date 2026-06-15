'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FolderSearch, Loader2, Play, Square, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { SCard } from '@/components/shared/s-card'
import MultipleSelector, { type Option } from '@/components/shared/multiple-selector'
import type { LocalImportRunResult } from '@/schemas/local-import.dto'

const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'RUNNING', 'CANCELLING'])

interface LocalImportStatusView {
  job: {
    status: string
    progress: number
    message: string | null
    error: string | null
    result: unknown
  } | null
  activity: {
    scan: unknown | null
    localImport: unknown | null
  }
}

export default function LocalDirectoryImportManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const [mappings, setMappings] = useState<Record<string, Option | undefined>>({})
  const [creatingDirectory, setCreatingDirectory] = useState<string | null>(null)

  const previewQuery = useQuery(trpc.localImport.preview.queryOptions(undefined, { enabled: false }))
  const statusQuery = useQuery(
    trpc.localImport.status.queryOptions(undefined, {
      refetchInterval: (query) => {
        const status = query.state.data?.job?.status
        return status && ACTIVE_JOB_STATUSES.has(status) ? 1500 : 5000
      }
    })
  )
  const saveMappingsMutation = useMutation(trpc.localImport.saveMappings.mutationOptions())
  const startMutation = useMutation(
    trpc.localImport.start.mutationOptions({
      onSuccess: () => {
        toast.success('本地目录导入任务已启动')
        void statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.localImport.cancel.mutationOptions({
      onSuccess: () => void statusQuery.refetch()
    })
  )

  useEffect(() => {
    const artists = previewQuery.data?.artists
    if (!artists) return
    setMappings((current) => {
      const next = { ...current }
      for (const artist of artists) {
        if (artist.mapping) {
          next[artist.artistDirectory] = {
            value: String(artist.mapping.artistId),
            label: artist.mapping.artistName
          }
        }
      }
      return next
    })
  }, [previewQuery.data])

  const importArtists = useMemo(
    () => previewQuery.data?.artists.filter((artist) => artist.works.some((work) => work.status === 'new')) ?? [],
    [previewQuery.data]
  )
  const missingMappings = importArtists.filter((artist) => !mappings[artist.artistDirectory])
  const statusData = statusQuery.data as unknown as LocalImportStatusView | undefined
  const job = statusData?.job
  const isRunning = Boolean(job && ACTIVE_JOB_STATUSES.has(job.status))
  const scanBlocked = Boolean(statusData?.activity.scan)
  const result = (job?.result ?? null) as LocalImportRunResult | null

  const searchArtists = async (value: string): Promise<Option[]> => {
    const response = await trpcClient.artist.queryPage.query({
      cursor: 1,
      pageSize: 20,
      search: value
    })
    return response.data.map((artist) => ({ value: String(artist.id), label: artist.name }))
  }

  const createArtist = async (artistDirectory: string) => {
    setCreatingDirectory(artistDirectory)
    try {
      const artist = await trpcClient.artist.create.mutate({
        name: artistDirectory,
        avatar: null
      })
      setMappings((current) => ({
        ...current,
        [artistDirectory]: { value: String(artist.id), label: artist.name }
      }))
      toast.success(`已创建艺术家：${artist.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建艺术家失败')
    } finally {
      setCreatingDirectory(null)
    }
  }

  const startImport = async () => {
    if (missingMappings.length > 0) {
      toast.error('请先完成所有待导入艺术家的映射')
      return
    }
    const mappingPayload = importArtists.map((artist) => ({
      artistDirectory: artist.artistDirectory,
      artistId: Number(mappings[artist.artistDirectory]!.value)
    }))
    if (mappingPayload.length > 0) {
      await saveMappingsMutation.mutateAsync({ mappings: mappingPayload })
    }
    await startMutation.mutateAsync()
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">本地目录导入</h1>
          <p className="mt-2 text-neutral-600">
            扫描 <code className="rounded bg-neutral-100 px-1.5 py-0.5">scanPath/local-imports/艺术家/作品</code>
            ，已有作品将直接跳过。
          </p>
        </div>

        <SCard
          title="目录预览"
          description="只读取两层目录和直属媒体文件名，不解析图片尺寸。"
          extra={
            <Button onClick={() => previewQuery.refetch()} disabled={previewQuery.isFetching || isRunning}>
              {previewQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderSearch className="mr-2 h-4 w-4" />}
              扫描预览
            </Button>
          }
        >
          {previewQuery.data ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <Stat label="艺术家" value={previewQuery.data.counts.artists} />
              <Stat label="作品目录" value={previewQuery.data.counts.works} />
              <Stat label="待导入" value={previewQuery.data.counts.new} />
              <Stat label="已有跳过" value={previewQuery.data.counts.existing} />
              <Stat label="无效目录" value={previewQuery.data.counts.invalid} />
              <Stat label="直属媒体" value={previewQuery.data.counts.media} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">点击“扫描预览”检查目录结构。</p>
          )}
        </SCard>

        {importArtists.length > 0 && (
          <SCard title="艺术家映射" description="待导入的每个一级目录必须关联一个艺术家。">
            <div className="space-y-3">
              {importArtists.map((artist) => (
                <div key={artist.artistDirectory} className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-[220px_1fr_auto]">
                  <div>
                    <div className="font-medium">{artist.artistDirectory}</div>
                    <div className="text-xs text-muted-foreground">
                      {artist.works.filter((work) => work.status === 'new').length} 部待导入作品
                    </div>
                  </div>
                  <MultipleSelector
                    value={mappings[artist.artistDirectory] ? [mappings[artist.artistDirectory]!] : []}
                    onChange={(options) =>
                      setMappings((current) => ({ ...current, [artist.artistDirectory]: options[0] }))
                    }
                    onSearch={searchArtists}
                    triggerSearchOnFocus
                    maxSelected={1}
                    hideClearAllButton
                    placeholder="搜索已有艺术家"
                    emptyIndicator={<p className="text-center text-sm text-muted-foreground">未找到艺术家</p>}
                  />
                  <Button
                    variant="outline"
                    onClick={() => createArtist(artist.artistDirectory)}
                    disabled={creatingDirectory === artist.artistDirectory}
                  >
                    {creatingDirectory === artist.artistDirectory ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="mr-2 h-4 w-4" />
                    )}
                    按目录名创建
                  </Button>
                </div>
              ))}
            </div>
          </SCard>
        )}

        <SCard
          title="导入任务"
          description={scanBlocked ? 'Pixiv 扫描正在运行，本地导入暂不可启动。' : '任务可安全取消并重新运行，成功作品会在下次直接跳过。'}
          extra={job ? <Badge variant="outline">{job.status}</Badge> : null}
          footer={
            isRunning ? (
              <Button variant="destructive" onClick={() => cancelMutation.mutate()} disabled={job?.status === 'CANCELLING'}>
                <Square className="mr-2 h-4 w-4" />
                {job?.status === 'CANCELLING' ? '正在取消' : '取消任务'}
              </Button>
            ) : (
              <Button
                onClick={startImport}
                disabled={!previewQuery.data || previewQuery.data.counts.new === 0 || missingMappings.length > 0 || scanBlocked || startMutation.isPending}
              >
                <Play className="mr-2 h-4 w-4" />
                开始导入
              </Button>
            )
          }
        >
          {job ? (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>{job.message || '等待任务更新'}</span>
                  <span>{job.progress}%</span>
                </div>
                <Progress value={job.progress} />
              </div>
              {result && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Stat label="导入成功" value={result.imported} />
                  <Stat label="跳过" value={result.skipped} />
                  <Stat label="失败" value={result.failed} />
                  <Stat label="新增媒体" value={result.newImages} />
                  <Stat label="耗时" value={`${Math.round(result.processingTime / 1000)}s`} />
                </div>
              )}
              {job.error && <p className="text-sm text-destructive">{job.error}</p>}
              {result?.errors?.length ? (
                <div className="max-h-48 overflow-auto rounded-md bg-neutral-50 p-3 text-xs text-neutral-700">
                  {result.errors.map((error) => <div key={error}>{error}</div>)}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">尚未执行本地目录导入任务。</p>
          )}
        </SCard>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-neutral-50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}
