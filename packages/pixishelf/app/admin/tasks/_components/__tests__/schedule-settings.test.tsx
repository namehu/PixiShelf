import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getScheduledTaskUpdate,
  isScheduledTaskPriorityValid,
  ScheduleSettings,
  type ScheduledTaskView,
  type TaskDraft
} from '../task-ui'

const task: ScheduledTaskView = {
  key: 'video_media_probe',
  type: 'VIDEO_MEDIA_PROBE',
  name: '视频媒体探测',
  description: '探测视频',
  enabled: true,
  scheduleMode: 'DAILY',
  time: '04:00',
  timezone: 'Asia/Shanghai',
  priority: 70,
  mutexKey: 'media-maintenance',
  lastTriggeredAt: null,
  lastTriggeredDate: null,
  lastJobId: null,
  lastJobStatus: null,
  nextRunAt: '2026-08-18 00:00 Asia/Shanghai'
}

const draft: TaskDraft = { enabled: true, time: '06:30', priority: '70' }

describe('ScheduleSettings cutover semantics', () => {
  afterEach(cleanup)

  it('replaces per-task time editing with the global Shanghai execution window in central mode', () => {
    const centralTask: ScheduledTaskView = {
      ...task,
      executionWindow: {
        timezone: 'Asia/Shanghai',
        startAt: '2026-08-17T16:00:00.000Z',
        endAt: '2026-08-18T00:00:00.000Z'
      }
    }
    render(
      <ScheduleSettings task={centralTask} draft={draft} onDraftChange={vi.fn()} onSave={vi.fn()} isSaving={false} />
    )

    expect(screen.getByText('中央串行窗口 · 上海时间 00:00–08:00')).toBeTruthy()
    expect(screen.getByText('全局窗口 00:00–08:00')).toBeTruthy()
    expect(screen.queryByLabelText('执行时间')).toBeNull()
    expect((screen.getByRole('button', { name: '保存计划' }) as HTMLButtonElement).disabled).toBe(true)
    expect(getScheduledTaskUpdate(centralTask, draft)).toEqual({
      key: task.key,
      enabled: true,
      priority: 70
    })
  })

  it('keeps the daily time input in legacy mode', () => {
    render(<ScheduleSettings task={task} draft={draft} onDraftChange={vi.fn()} onSave={vi.fn()} isSaving={false} />)

    expect(screen.getByLabelText('执行时间')).toHaveProperty('value', '06:30')
    expect((screen.getByRole('button', { name: '保存计划' }) as HTMLButtonElement).disabled).toBe(false)
    expect(getScheduledTaskUpdate(task, draft)).toMatchObject({ time: '06:30' })
  })

  it('accepts persisted priority 70 without an initial validation error', () => {
    const centralTask: ScheduledTaskView = {
      ...task,
      executionWindow: {
        timezone: 'Asia/Shanghai',
        startAt: '2026-08-17T16:00:00.000Z',
        endAt: '2026-08-18T00:00:00.000Z'
      }
    }
    render(
      <ScheduleSettings
        task={centralTask}
        draft={{ ...draft, time: task.time }}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
      />
    )
    const input = screen.getByLabelText('优先级') as HTMLInputElement
    expect(input.value).toBe('70')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(screen.queryByText(/请输入 0–999 的整数/)).toBeNull()
    expect(getScheduledTaskUpdate(centralTask, { ...draft, priority: '70' })).toMatchObject({ priority: 70 })
  })

  it('enforces 0–999 for scheduled priority in both central and legacy modes', () => {
    expect(isScheduledTaskPriorityValid('-1')).toBe(false)
    expect(isScheduledTaskPriorityValid('0')).toBe(true)
    expect(isScheduledTaskPriorityValid('999')).toBe(true)
    expect(isScheduledTaskPriorityValid('1000')).toBe(false)

    for (const executionWindow of [
      undefined,
      {
        timezone: 'Asia/Shanghai' as const,
        startAt: '2026-08-17T16:00:00.000Z',
        endAt: '2026-08-18T00:00:00.000Z'
      }
    ]) {
      for (const [value, valid] of [
        ['-1', false],
        ['0', true],
        ['999', true],
        ['1000', false]
      ] as const) {
        const { unmount } = render(
          <ScheduleSettings
            task={{ ...task, executionWindow }}
            draft={{ ...draft, time: task.time, priority: value }}
            onDraftChange={vi.fn()}
            onSave={vi.fn()}
            isSaving={false}
          />
        )
        const input = screen.getByLabelText('优先级') as HTMLInputElement
        expect(input.min).toBe('0')
        expect(input.max).toBe('999')
        expect(input.getAttribute('name')).toBe(`${task.key}-priority`)
        expect(input.autocomplete).toBe('off')
        expect(input.inputMode).toBe('numeric')
        expect(input.getAttribute('aria-invalid')).toBe(valid ? 'false' : 'true')
        expect((screen.getByRole('button', { name: '保存计划' }) as HTMLButtonElement).disabled).toBe(!valid)
        if (valid) {
          expect(getScheduledTaskUpdate({ ...task, executionWindow }, { ...draft, priority: value }).priority).toBe(
            Number(value)
          )
        }
        unmount()
      }
    }
  })
})
