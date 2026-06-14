import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SystemSettingsPanel } from '@/app/admin/setting/_components/system-settings-panel'

const testState = vi.hoisted(() => ({
  mutationCalls: [] as any[],
  setQueryData: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@/components/shared/multiple-selector', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <div>
      <div data-testid={`selected-tags-${placeholder}`}>
        {(value || []).map((item: any) => (
          <span key={item.value}>{item.label}</span>
        ))}
      </div>
      <button type="button" onClick={() => onChange([{ value: '3', label: 'tag-c' }])}>
        choose {placeholder}
      </button>
    </div>
  )
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    setting: {
      getSystemSettings: {
        queryOptions: () => ({ queryKey: ['setting', 'getSystemSettings'] }),
        queryKey: () => ['setting', 'getSystemSettings']
      },
      updateSystemSettings: {
        mutationOptions: (options: any) => ({ ...options, kind: 'updateSystemSettings' })
      }
    },
    tag: {
      getByIds: {
        queryOptions: (input: any) => ({ queryKey: ['tag', 'getByIds', input.ids] })
      }
    }
  }),
  useTRPCClient: () => ({
    tag: {
      list: {
        query: vi.fn()
      }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: testState.setQueryData
  }),
  useQuery: (options: any) => {
    const queryKey = options?.queryKey ?? []

    if (queryKey[0] === 'setting') {
      return {
        data: {
          settings: {
            replace_default_tag_ids: [1, 2],
            local_import_default_tag_ids: [4]
          }
        },
        isLoading: false
      }
    }

    return {
      data: {
        items: [
          { id: 1, name: 'tag-a' },
          { id: 2, name: 'tag-b' },
          { id: 4, name: 'tag-local' }
        ]
      },
      isLoading: false
    }
  },
  useMutation: (options: any) => ({
    isPending: false,
    mutate: (payload: any) => {
      testState.mutationCalls.push(payload)
      options.onSuccess?.({
        settings: payload
      })
    }
  })
}))

describe('SystemSettingsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    testState.mutationCalls.length = 0
    testState.setQueryData.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders saved default tags and saves changed tag ids', () => {
    render(<SystemSettingsPanel />)

    expect(screen.getByText('tag-a')).toBeTruthy()
    expect(screen.getByText('tag-b')).toBeTruthy()
    expect(screen.getByText('tag-local')).toBeTruthy()

    fireEvent.click(screen.getByText('choose 搜索并选择全量替换默认标签...'))
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(testState.mutationCalls).toEqual([
      {
        replace_default_tag_ids: [3],
        local_import_default_tag_ids: [4]
      }
    ])
  })
})
