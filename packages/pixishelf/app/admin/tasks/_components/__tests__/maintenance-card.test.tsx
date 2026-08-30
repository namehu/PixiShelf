import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }))

vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/lib/trpc', () => ({ useTRPC: vi.fn() }))
vi.mock('../video-keyframe-section', () => ({ VideoKeyframeSection: () => null }))
vi.mock('../video-streaming-optimization-section', () => ({ VideoStreamingOptimizationSection: () => null }))

import {
  getStandaloneTaskActionLabel,
  PixivAiDerivedTagSyncFeedback,
  requestPixivAiDerivedTagSync,
  requestStandaloneTaskTrigger,
  shouldPollStandaloneTasks,
  StandaloneTaskFeedback
} from '../maintenance-card'
import type { ScheduledTaskView } from '../task-ui'
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
    expect(shouldPollStandaloneTasks([task({ lastJobStatus: 'RUNNING' })])).toBe(true)
    expect(shouldPollStandaloneTasks([task({ lastJobStatus: 'COMPLETED' })])).toBe(false)
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
