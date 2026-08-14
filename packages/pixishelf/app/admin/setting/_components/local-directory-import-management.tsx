'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FolderSearch, Play, Square, UserPlus, FolderOpen, AlertCircle, HardDriveDownload } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import MultipleSelector, { type Option } from '@/components/shared/multiple-selector'
import type { LocalImportRunResult } from '@/schemas/local-import.dto'
import { confirm } from '@/components/shared/global-confirm'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { cn } from '@/lib/utils'

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
    () =>
      previewQuery.data?.artists.filter((artist) =>
        artist.works.some((work) => work.status === 'new' && !work.archiveManifest)
      ) ?? [],
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
    <div className="py-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-foreground">本地目录导入</h2>
          <p className="text-sm text-muted-foreground">
            扫描{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              scanPath/local-imports/艺术家/[分类...]/作品
            </code>
            ，已有作品将直接跳过。
          </p>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/10 px-6 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-lg">目录预览</CardTitle>
              <CardDescription>递归发现包含直属媒体文件的作品目录，不解析图片尺寸。</CardDescription>
            </div>
            <Button
              onClick={() => previewQuery.refetch()}
              disabled={previewQuery.isFetching || isRunning}
              className="shrink-0"
            >
              {previewQuery.isFetching ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <FolderSearch data-icon="inline-start" aria-hidden="true" />
              )}
              {previewQuery.data ? '重新扫描' : '扫描预览'}
            </Button>
          </CardHeader>
          <CardContent className="p-6">
            {previewQuery.data ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
                <Stat label="待导入" value={previewQuery.data.counts.new} highlight />
                <Stat label="艺术家" value={previewQuery.data.counts.artists} />
                <Stat label="作品目录" value={previewQuery.data.counts.works} />
                <Stat label="已有跳过" value={previewQuery.data.counts.existing} />
                <Stat label="无效目录" value={previewQuery.data.counts.invalid} />
                <Stat label="直属媒体" value={previewQuery.data.counts.media} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="rounded-full bg-muted/50 p-4 mb-4">
                  <FolderSearch className="size-8 text-muted-foreground/50" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">点击右上角“扫描预览”检查目录结构</p>
              </div>
            )}
          </CardContent>
        </Card>

        {importArtists.length > 0 && (
          <Card className="shadow-sm border-primary/20 overflow-hidden">
            <CardHeader className="border-b bg-primary/5 px-6 py-5">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-lg text-primary">艺术家映射</CardTitle>
              </div>
              <CardDescription className="text-primary/80">
                待导入的每个一级目录必须关联一个艺术家，请完成以下映射。
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {importArtists.map((artist) => (
                <div
                  key={artist.artistDirectory}
                  className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/5 transition-colors"
                >
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-medium text-foreground">{artist.artistDirectory}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="font-normal bg-primary/10 text-primary hover:bg-primary/10 border-primary/20"
                      >
                        {artist.works.filter((work) => work.status === 'new').length} 部待导入作品
                      </Badge>
                    </div>
                  </div>
                  <div className="flex w-full flex-col sm:w-auto sm:flex-row items-center gap-3">
                    <div className="w-full sm:w-[280px]">
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
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => createArtist(artist.artistDirectory)}
                      disabled={creatingDirectory === artist.artistDirectory}
                      className="w-full sm:w-auto shrink-0"
                    >
                      {creatingDirectory === artist.artistDirectory ? (
                        <Spinner data-icon="inline-start" aria-hidden="true" />
                      ) : (
                        <UserPlus data-icon="inline-start" aria-hidden="true" />
                      )}
                      按目录名创建
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/10 px-6 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">导入执行</CardTitle>
                {job && <AdminStatusBadge status={job.status} />}
              </div>
              <CardDescription>
                {scanBlocked
                  ? 'Pixiv 扫描正在运行，本地导入暂不可启动。'
                  : '任务可安全取消并重新运行，成功作品会在下次直接跳过。'}
              </CardDescription>
            </div>
            {isRunning ? (
              <Button
                variant="destructive"
                onClick={() =>
                  confirm({
                    title: '取消本地目录导入任务？',
                    description: '当前导入会停止；已经成功写入的作品会保留，下次运行时将自动跳过。',
                    confirmText: '确认取消',
                    variant: 'destructive',
                    onConfirm: () => cancelMutation.mutate()
                  })
                }
                disabled={job?.status === 'CANCELLING'}
                className="shrink-0"
              >
                {job?.status === 'CANCELLING' ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Square data-icon="inline-start" aria-hidden="true" />
                )}
                {job?.status === 'CANCELLING' ? '正在取消' : '取消任务'}
              </Button>
            ) : (
              <Button
                onClick={startImport}
                disabled={
                  !previewQuery.data ||
                  previewQuery.data.counts.new === 0 ||
                  missingMappings.length > 0 ||
                  scanBlocked ||
                  startMutation.isPending
                }
                className="shrink-0"
              >
                {startMutation.isPending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Play data-icon="inline-start" aria-hidden="true" />
                )}
                开始导入
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-6">
            {job ? (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-surface">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground flex items-center gap-2">
                      {isRunning ? (
                        <Spinner className="size-4 text-primary" aria-hidden="true" />
                      ) : (
                        <HardDriveDownload className="size-4 text-muted-foreground" aria-hidden="true" />
                      )}
                      {job.message || '等待任务更新…'}
                    </span>
                    <span className="font-medium text-muted-foreground">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                  {job.error && <p className="text-sm text-destructive font-medium mt-2">错误: {job.error}</p>}
                </div>

                {result && (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-5 pt-2">
                    <Stat label="导入成功" value={result.imported} />
                    <Stat label="跳过" value={result.skipped} />
                    <Stat label="失败" value={result.failed} />
                    <Stat label="新增媒体" value={result.newImages} />
                    <Stat label="耗时" value={`${Math.round(result.processingTime / 1000)}s`} />
                  </div>
                )}

                {result?.errors?.length ? (
                  <div className="mt-4 flex flex-col gap-2">
                    <p className="text-sm font-medium text-destructive">失败详情</p>
                    <div className="flex max-h-48 flex-col gap-1 overflow-auto rounded-md border border-destructive/20 bg-destructive/10 p-3 font-mono text-xs text-destructive">
                      {result.errors.map((error, i) => (
                        <div key={i} className="break-all">
                          {error}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="rounded-full bg-muted/50 p-4 mb-4">
                  <HardDriveDownload className="size-8 text-muted-foreground/50" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">尚未执行本地目录导入任务</p>
                <p className="text-xs text-muted-foreground mt-1">扫描目录并完成映射后，即可开始导入</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight = false,
  className = ''
}: {
  label: string
  value: number | string
  highlight?: boolean
  className?: string
}) {
  if (highlight) {
    return (
      <div className={cn('flex flex-col gap-1.5 rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm', className)}>
        <div className="text-xs font-medium text-primary/80">{label}</div>
        <div className="text-3xl font-bold tracking-tight text-primary">{value}</div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 shadow-sm', className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
    </div>
  )
}
