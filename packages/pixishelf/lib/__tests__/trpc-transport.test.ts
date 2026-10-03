import { createTRPCClient } from '@trpc/client'
import { expect, it, vi } from 'vitest'
import type { AppRouter } from '@/server'
import { createTRPCTransport } from '../trpc-transport'

it('resolves batched metadata while the independent statistics request is pending', async () => {
  let releaseCounts!: (response: Response) => void
  const pendingCounts = new Promise<Response>((resolve) => {
    releaseCounts = resolve
  })
  const requests: URL[] = []
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    requests.push(url)
    if (url.pathname.endsWith('/archiveSearch.catalogCounts')) return pendingCounts
    const result = url.pathname
      .split('/')
      .at(-1)!
      .split(',')
      .map(() => ({ result: { data: [] } }))
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
  })
  const client = createTRPCClient<AppRouter>({ links: [createTRPCTransport('http://localhost/api/trpc', transport)] })
  let countsFinished = false
  const counts = client.archiveSearch.catalogCounts.query({}).then(() => {
    countsFinished = true
  })
  await Promise.all([
    client.archiveSearch.listSources.query({ includeCounts: false }),
    client.archiveSearch.getSource.query({ sourceId: 'one', includeCounts: false })
  ])
  expect(countsFinished).toBe(false)
  expect(requests).toHaveLength(2)
  expect(requests.find((url) => url.pathname.endsWith('/archiveSearch.catalogCounts'))?.searchParams.has('batch')).toBe(
    false
  )
  const metadata = requests.find((url) => url.pathname.includes('listSources'))!
  expect(metadata.pathname).toContain('archiveSearch.getSource')
  expect(metadata.searchParams.get('batch')).toBe('1')
  releaseCounts(
    new Response(JSON.stringify({ result: { data: {} } }), { headers: { 'content-type': 'application/json' } })
  )
  await counts
  expect(countsFinished).toBe(true)
})
