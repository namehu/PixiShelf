import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, apiHandler, responseSuccess, responseUnauthorized } from '../api-handler'

vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))

const context = { params: Promise.resolve({}) }
const request = (body = '{}') => new NextRequest('http://localhost/api/test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body
})
const canonical = { responseContract: 'canonical' } as const

describe('apiHandler response contracts', () => {
  it.each([400, 401, 404, 409])('returns only canonical fields for an expected %s failure', async (status) => {
    const route = apiHandler(z.object({}), async () => { throw new ApiError('Request failed', status) }, canonical)
    const response = await route(request(), context)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ code: status, message: 'Request failed' })
  })

  it('keeps typed public error data and masks unexpected server failures', async () => {
    const route = apiHandler(z.object({}), async () => { throw new ApiError('Conflict', 409, { id: 1 }) }, canonical)
    expect(await (await route(request(), context)).json()).toEqual({ code: 409, message: 'Conflict', data: { id: 1 } })
    const failing = apiHandler(z.object({}), async () => { throw new Error('postgres://secret@private/path') }, canonical)
    const response = await failing(request(), context)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ code: 500, message: 'Internal Server Error', data: null })
  })

  it.each(['{', '', 'null', '[]', '42', '"text"'])('rejects malformed or non-object JSON %s before the handler', async (body) => {
    const handler = vi.fn(async () => ({}))
    const route = apiHandler(z.object({ type: z.string().default('full') }), handler, canonical)
    expect(await (await route(request(body), context)).json()).toEqual({ code: 400, message: 'Invalid Request Parameters' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('puts schema validation details under canonical data', async () => {
    const handler = vi.fn(async () => ({}))
    const route = apiHandler(z.object({ id: z.number() }), handler, canonical)
    expect(await (await route(request(), context)).json()).toEqual({
      code: 400, message: 'Invalid Request Parameters', data: { details: expect.stringContaining('id') }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('preserves schema inference, merge priority and canonical success', async () => {
    const route = apiHandler(z.object({ id: z.number() }), async (_req, data) => ({ doubled: data.id * 2 }), canonical)
    expect(await (await route(request('{"id":3}'), { params: Promise.resolve({ id: '1' }) })).json()).toEqual({
      code: 0, message: '', data: { doubled: 6 }
    })
  })

  it.each([
    new Response('event: queued\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    new NextResponse('event: complete\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
  ])('passes through Response and NextResponse streams unchanged', async (stream) => {
    const route = apiHandler(z.object({}), async () => stream, canonical)
    expect(await route(request(), context)).toBe(stream)
  })

  it('keeps legacy aliases and permissive JSON parsing until routes opt in', async () => {
    const route = apiHandler(z.object({}), async () => ({ queued: true }))
    expect(await (await route(request('{'), context)).json()).toEqual({
      code: 0, message: '', data: { queued: true }, success: true, errorCode: 0
    })
    const failing = apiHandler(z.object({}), async () => { throw new ApiError('Unauthorized', 401) })
    expect(await (await failing(request(), context)).json()).toEqual({
      code: 401, message: 'Unauthorized', success: false, errorCode: 401, error: 'Unauthorized'
    })
    const invalid = apiHandler(z.object({ id: z.number() }), async () => ({}))
    expect(await (await invalid(request(), context)).json()).toEqual({
      code: 400, message: 'Invalid Request Parameters', details: expect.any(String),
      success: false, errorCode: 400, error: 'Invalid Request Parameters'
    })
  })

  it('preserves the existing success and proxy authentication helpers', async () => {
    expect(await responseSuccess({ data: { id: 1 } }).json()).toEqual({ code: 0, message: 'success', data: { id: 1 } })
    expect(responseUnauthorized().status).toBe(401)
    expect(await responseUnauthorized().json()).toEqual({ code: 401, message: 'Unauthorized' })
  })
})
