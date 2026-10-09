import type { ComponentProps, ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtuosoMockContext } from 'react-virtuoso'
import { ArchiveUploaderSourceList } from '../archive-uploader-source-list'
import { source } from './archive-uploader-sources-fixtures'

vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  )
}))

afterEach(cleanup)

describe('source list virtualization', () => {
  it('renders a bounded window without a table header or content-selection footer', async () => {
    const sources: ComponentProps<typeof ArchiveUploaderSourceList>['sources'] = Array.from(
      { length: 500 },
      (_, index) => ({
        ...source,
        id: `source-${index}`,
        displayName: `来源 ${index}`,
        latestRun: null,
        titleQuery: null,
        sourceKind: 'UPLOADER',
        defaultCreators: [],
        status: 'ACTIVE',
        identityKind: 'UID',
        uidBindingState: 'BOUND',
        latestCoverage: 'CURRENT',
        historyCoverage: 'HAS_MORE',
        lastScanAt: source.lastScanAt.toISOString(),
        lastSuccessAt: source.lastSuccessAt.toISOString(),
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString()
      })
    )
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 112 }}>
        <ArchiveUploaderSourceList sources={sources} selectedSourceId={null} onSelect={vi.fn()} onCopyUid={vi.fn()} />
      </VirtuosoMockContext.Provider>
    )
    await waitFor(() => expect(screen.getByText('来源 0')).toBeTruthy())
    expect(document.querySelectorAll('[data-source-id]').length).toBeLessThan(30)
    expect(screen.queryByText('来源 499')).toBeNull()
    expect(screen.queryByText('来源与条件')).toBeNull()
    expect(screen.queryByText(/单次最多选择/)).toBeNull()
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0)
  })
})
