import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ArtworkInfoForm } from '@/app/admin/artworks/_components/artwork-info-form'

const mutationCalls = vi.hoisted(() => ({
  create: [] as any[],
  update: [] as any[],
  invalidateQueries: vi.fn()
}))

vi.mock('lucide-react', () => ({
  Save: () => <span data-testid="save-icon" />
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@/store/admin/useRecentTags', () => ({
  useRecentTags: () => ({
    addTag: vi.fn()
  })
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: any) => <label>{children}</label>
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className }: any) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  )
}))

vi.mock('@/components/shared/pro-date-picker', () => ({
  ProDatePicker: ({ value }: any) => {
    const displayValue =
      value instanceof Date
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : ''

    return <input aria-label="发布日期" readOnly value={displayValue} />
  }
}))

vi.mock('@/components/shared/multiple-selector', () => ({
  default: ({ value, placeholder }: any) => (
    <div data-testid={placeholder}>
      {(value || []).map((item: any) => (
        <span key={item.value}>{item.label}</span>
      ))}
    </div>
  )
}))

vi.mock('@/app/admin/artworks/_components/recent-tags-list', () => ({
  RecentTagsList: () => <div data-testid="recent-tags" />
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artwork: {
      create: {
        mutationOptions: (options: any) => ({ ...options, kind: 'create' })
      },
      update: {
        mutationOptions: (options: any) => ({ ...options, kind: 'update' })
      },
      list: {
        queryKey: () => ['artwork', 'list']
      }
    }
  }),
  useTRPCClient: () => ({
    artist: {
      queryPage: {
        query: vi.fn()
      }
    },
    tag: {
      list: {
        query: vi.fn()
      }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mutationCalls.invalidateQueries
  }),
  useMutation: (options: any) => ({
    isPending: false,
    mutate: (payload: any) => {
      if (options.kind === 'create') {
        mutationCalls.create.push(payload)
        options.onSuccess?.({ id: 99, title: payload.title })
        return
      }
      mutationCalls.update.push(payload)
      options.onSuccess?.()
    }
  })
}))

describe('ArtworkInfoForm', () => {
  beforeEach(() => {
    mutationCalls.create.length = 0
    mutationCalls.update.length = 0
    mutationCalls.invalidateQueries.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('prefills copied artwork draft and submits through create mutation', () => {
    const onSuccess = vi.fn()

    render(
      <ArtworkInfoForm
        data={null}
        initialData={{
          title: '复制源作品',
          description: '复制源描述',
          sourceDate: '2026-06-05 00:00:00',
          artist: { id: 12, name: '源艺术家' },
          tags: [
            { id: 1, name: 'tag-a' },
            { id: 2, name: 'tag-b' }
          ]
        }}
        onSuccess={onSuccess}
      />
    )

    expect(screen.getByDisplayValue('复制源作品')).toBeTruthy()
    expect(screen.getByDisplayValue('复制源描述')).toBeTruthy()
    expect(screen.getByDisplayValue('2026-06-05')).toBeTruthy()
    expect(screen.getByText('源艺术家')).toBeTruthy()
    expect(screen.getByText('tag-a')).toBeTruthy()
    expect(screen.getByText('tag-b')).toBeTruthy()

    fireEvent.click(screen.getByText('创建作品'))

    expect(mutationCalls.update).toEqual([])
    expect(mutationCalls.create).toEqual([
      {
        title: '复制源作品',
        description: '复制源描述',
        artistId: 12,
        tags: [1, 2],
        sourceDate: '2026-06-05',
        source: 'LOCAL_CREATED'
      }
    ])
    expect(onSuccess).toHaveBeenCalledWith({ id: 99, title: '复制源作品' })
  })
})
