import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }))

vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/lib/trpc', () => ({ useTRPC: vi.fn() }))
vi.mock('../video-keyframe-section', () => ({ VideoKeyframeSection: () => null }))
vi.mock('../video-streaming-optimization-section', () => ({ VideoStreamingOptimizationSection: () => null }))

import {
  getStandaloneTaskActionLabel,
  requestPixivAiDerivedTagSync,
  requestStandaloneTaskTrigger,
  shouldPollStandaloneTasks
} from '../maintenance-card'
import { PixivAiDerivedTagSyncFeedback } from '../pixiv-ai-derived-tag-sync-feedback'
import { AnimationScanLiveFeedback } from '../animation-scan-live-feedback'
import { StandaloneTaskFeedback } from '../standalone-task-feedback'
import type { JobView, ScheduledTaskView } from '../task-ui'
import { VideoProbeTaskActions } from '../video-probe-task-actions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function task(overrides: Partial<ScheduledTaskView> = {}): ScheduledTaskView {
  return {
    key: 'derived_media_gc',
    type: 'DERIVED_MEDIA_GC',
    name: '清理派生媒体',
    description: 'test',
    enabled: false,
    scheduleMode: 'DAILY',
    time: '05:30',
    timezone: 'Asia/Shanghai',
    priority: 70,
    mutexKey: 'media-maintenance',
    lastTriggeredAt: null,
    lastTriggeredDate: null,
    lastJobId: null,
    lastJobStatus: null,
    nextRunAt: null,
    ...overrides
  }
}

describe('maintenance standalone tasks', () => {
  it('offers incremental probing and has-audio recalibration as distinct actions', () => {
    const onTrigger = vi.fn()
    const videoTask = task({ key: 'video_media_probe', type: 'VIDEO_MEDIA_PROBE', name: '视频媒体探测' })

    render(<VideoProbeTaskActions task={videoTask} isPending={false} triggeringTaskKey={null} onTrigger={onTrigger} />)

    fireEvent.click(screen.getByRole('button', { name: '增量执行' }))
    fireEvent.click(screen.getByRole('button', { name: '校准现有有音频' }))

    expect(onTrigger).toHaveBeenNthCalledWith(1, videoTask, 'INCREMENTAL')
    expect(onTrigger).toHaveBeenNthCalledWith(2, videoTask, 'RECHECK_HAS_AUDIO')
  })

  it('starts the Pixiv AI dry run immediately and confirms the formal backfill', () => {
    const dryRun = vi.fn()
    const formal = vi.fn()

    requestPixivAiDerivedTagSync(true, dryRun)
    expect(dryRun).toHaveBeenCalledOnce()
    expect(mocks.confirm).not.toHaveBeenCalled()

    requestPixivAiDerivedTagSync(false, formal)
    expect(formal).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: '执行 Pixiv AI 标签历史回填？', confirmText: '执行回填' })
    )
    mocks.confirm.mock.calls[0]![0].onConfirm()
    expect(formal).toHaveBeenCalledOnce()
  })

  it('shows Pixiv AI audit and applied reconciliation counters', () => {
    render(
      <PixivAiDerivedTagSyncFeedback
        result={{
          dryRun: false,
          scannedArtworks: 10_200,
          aiGeneratedArtworks: 420,
          unknownAiArtworks: 3,
          wouldCreateDerivedRelations: 20,
          wouldConvertSourceRelations: 390,
          wouldConvertLegacyRelations: 2,
          wouldRemoveStaleDerivedRelations: 4,
          protectedManualRelations: 1,
          protectedOtherSourceRelations: 2,
          appliedCreatedRelations: 20,
          appliedConvertedRelations: 392,
          appliedRemovedRelations: 4,
          finalDerivedRelations: 415
        }}
      />
    )

    for (const text of ['正式回填', '10200', '420', '计划新增', '实际新增', '415']) {
      expect(screen.getByText(text, { exact: false })).toBeTruthy()
    }
  })

  it('requires destructive confirmation before running registered due GC', () => {
    const onTrigger = vi.fn()

    requestStandaloneTaskTrigger(task(), onTrigger)

    expect(onTrigger).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '执行到期清理？',
        description: expect.stringContaining('无引用且已到期的已登记派生文件'),
        confirmText: '执行到期清理',
        variant: 'destructive'
      })
    )
    mocks.confirm.mock.calls[0]![0].onConfirm()
    expect(onTrigger).toHaveBeenCalledOnce()
  })

  it('labels reconciliation as read-only and starts it without destructive confirmation', () => {
    mocks.confirm.mockClear()
    const reconciliation = task({ key: 'derived_media_gc_reconciliation' })
    const onTrigger = vi.fn()

    expect(getStandaloneTaskActionLabel(reconciliation)).toBe('开始只读核对')
    requestStandaloneTaskTrigger(reconciliation, onTrigger)

    expect(onTrigger).toHaveBeenCalledOnce()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('keeps polling while a latest maintenance job is active and stops at terminal state', () => {
    for (const status of ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING']) {
      expect(shouldPollStandaloneTasks([task({ lastJobStatus: status })])).toBe(true)
    }
    expect(shouldPollStandaloneTasks([task({ lastJobStatus: 'COMPLETED' })])).toBe(false)
  })

  it('renders aggregate live animation metrics without marking them privacy-sensitive', () => {
    const job: JobView = {
      id: 'animation-1',
      type: 'WEBP_ANIMATION_SCAN',
      status: 'RUNNING',
      progress: 40,
      progressData: {
        version: 1,
        kind: 'animation-scan',
        stage: 'SCANNING',
        initializedItems: 5_000,
        totalItems: 4_000,
        attemptedItems: 1_200,
        succeededItems: 1_190,
        failedItems: 10,
        animatedItems: 80,
        staticItems: 1_110,
        remainingItems: 2_800,
        activeProbes: 4,
        concurrencyLimit: 4,
        itemsPerSecond: 12.5,
        etaSeconds: 224,
        sampledAt: new Date().toISOString()
      }
    }

    const view = render(<AnimationScanLiveFeedback job={job} />)

    for (const value of ['1200 / 4000', '80', '1110', '10', '4 / 4', '12.5 items/s', '2800', '4 分钟']) {
      expect(screen.getByText(value)).toBeTruthy()
    }
    expect(view.container.querySelector('[data-privacy-sensitive]')).toBeNull()
  })

  it('hides ETA while paused and keeps showing the last live sample age', () => {
    render(
      <AnimationScanLiveFeedback
        job={{
          id: 'animation-paused',
          status: 'PAUSED',
          progress: 40,
          progressData: {
            version: 1,
            kind: 'animation-scan',
            stage: 'SCANNING',
            initializedItems: 100,
            totalItems: 100,
            attemptedItems: 40,
            succeededItems: 40,
            failedItems: 0,
            animatedItems: 4,
            staticItems: 36,
            remainingItems: 60,
            activeProbes: 0,
            concurrencyLimit: 4,
            itemsPerSecond: 4,
            etaSeconds: 15,
            sampledAt: new Date().toISOString()
          }
        }}
      />
    )

    expect(screen.getByText('采样中')).toBeTruthy()
    expect(screen.getByText('任务已暂停；最近存活更新在 0 秒前')).toBeTruthy()
  })

  it('shows the live sample age while animation candidates are initializing', () => {
    render(
      <AnimationScanLiveFeedback
        job={{
          id: 'animation-initializing',
          status: 'RUNNING',
          progress: 2,
          progressData: {
            version: 1,
            kind: 'animation-scan',
            stage: 'INITIALIZING',
            initializedItems: 500,
            totalItems: 2_000,
            attemptedItems: 0,
            succeededItems: 0,
            failedItems: 0,
            animatedItems: 0,
            staticItems: 0,
            remainingItems: 2_000,
            activeProbes: 0,
            concurrencyLimit: 4,
            itemsPerSecond: 0,
            etaSeconds: null,
            sampledAt: new Date().toISOString()
          }
        }}
      />
    )

    expect(screen.getByText('正在初始化，已完成 500 个候选；最近存活更新在 0 秒前')).toBeTruthy()
  })

  it('hides a stale ETA and identifies a stalled live sample', () => {
    render(
      <AnimationScanLiveFeedback
        job={{
          id: 'animation-stalled',
          status: 'RUNNING',
          progress: 40,
          progressData: {
            version: 1,
            kind: 'animation-scan',
            stage: 'SCANNING',
            initializedItems: 100,
            totalItems: 100,
            attemptedItems: 40,
            succeededItems: 40,
            failedItems: 0,
            animatedItems: 4,
            staticItems: 36,
            remainingItems: 60,
            activeProbes: 0,
            concurrencyLimit: 4,
            itemsPerSecond: 4,
            etaSeconds: 15,
            sampledAt: new Date(Date.now() - 7_000).toISOString()
          }
        }}
      />
    )

    expect(screen.getByText('采样中')).toBeTruthy()
    expect(screen.getByText(/探测暂未推进；最近存活更新在 [78] 秒前/)).toBeTruthy()
  })

  it('hides ETA after an animation task becomes terminal', () => {
    render(
      <AnimationScanLiveFeedback
        job={{
          id: 'animation-cancelled',
          status: 'CANCELLED',
          progress: 40,
          progressData: {
            version: 1,
            kind: 'animation-scan',
            stage: 'SCANNING',
            initializedItems: 100,
            totalItems: 100,
            attemptedItems: 40,
            succeededItems: 40,
            failedItems: 0,
            animatedItems: 4,
            staticItems: 36,
            remainingItems: 60,
            activeProbes: 0,
            concurrencyLimit: 4,
            itemsPerSecond: 4,
            etaSeconds: 15,
            sampledAt: new Date().toISOString()
          }
        }}
      />
    )

    expect(screen.getByText('采样中')).toBeTruthy()
    expect(screen.queryByText('15 秒')).toBeNull()
  })

  it('shows only the mode while an active task has no result yet', () => {
    render(
      <StandaloneTaskFeedback
        task={task({ lastJobId: 'gc-running', lastJobStatus: 'RUNNING', lastJobMode: 'FORMAL', lastJobResult: null })}
      />
    )

    expect(screen.getByText('正式执行', { exact: false })).toBeTruthy()
    expect(screen.getByText('运行中', { exact: false })).toBeTruthy()
    expect(screen.queryByText('选中：', { exact: false })).toBeNull()
  })

  it('shows mode and all GC result counters directly', () => {
    render(
      <StandaloneTaskFeedback
        task={task({
          lastJobId: 'gc-job-1',
          lastJobStatus: 'COMPLETED',
          lastJobMode: 'PREVIEW',
          lastJobResult: {
            selected: 7,
            deleted: 1,
            missing: 2,
            referenced: 3,
            failed: 4,
            reconciliationScanned: 12,
            untrackedCandidates: 5
          }
        })}
      />
    )

    for (const text of [
      '预览（只读）',
      '选中：',
      '删除：',
      '缺失：',
      '仍被引用：',
      '失败：',
      '核对扫描：',
      '未登记候选：'
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeTruthy()
    }
  })

  it.each([
    ['trigger_log_retention_cleanup', 'TRIGGER_LOG_RETENTION_CLEANUP', '删除日志：', { deletedLogs: 9 }],
    ['scan_run_retention_cleanup', 'SCAN_RUN_RETENTION_CLEANUP', '删除扫描记录：', { deletedRuns: 6 }],
    [
      'archive_intake_retention_cleanup',
      'ARCHIVE_INTAKE_RETENTION_CLEANUP',
      '删除收件记录：',
      {
        deletedBulkOperations: 2,
        deletedIntakeItems: 4,
        deletedSubmissions: 1,
        deletedPreviewSessions: 3
      }
    ]
  ])('shows the latest %s result', (key, type, label, result) => {
    render(
      <StandaloneTaskFeedback
        task={task({ key, type, lastJobId: `${key}-job`, lastJobMode: 'FORMAL', lastJobResult: result })}
      />
    )

    expect(screen.getByText('正式执行', { exact: false })).toBeTruthy()
    expect(screen.getByText(label, { exact: false })).toBeTruthy()
    if (key === 'archive_intake_retention_cleanup') {
      expect(screen.getByText('删除批量操作：', { exact: false })).toBeTruthy()
      expect(screen.getByText('删除收件批次：', { exact: false })).toBeTruthy()
      expect(screen.getByText('删除过期预览：', { exact: false })).toBeTruthy()
    }
  })
})
