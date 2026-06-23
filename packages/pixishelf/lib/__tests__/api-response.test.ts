import { describe, expect, it } from 'vitest'
import { apiError, apiJson, apiSuccess } from '../api-response'

describe('api-response helpers', () => {
  it('keeps legacy success response shape while preserving typed payload fields', async () => {
    const response = apiSuccess({ meta: [{ path: '/artist/work/image.jpg' }] })

    await expect(response.json()).resolves.toEqual({
      success: true,
      meta: [{ path: '/artist/work/image.jpg' }]
    })
    expect(response.status).toBe(200)
  })

  it('keeps legacy error response shape with optional details', async () => {
    const response = apiError('Duplicate files detected', { status: 400, details: ['/a.jpg'] })

    await expect(response.json()).resolves.toEqual({
      error: 'Duplicate files detected',
      details: ['/a.jpg']
    })
    expect(response.status).toBe(400)
  })

  it('returns arbitrary typed JSON without adding success fields', async () => {
    const response = apiJson({ exists: true, size: 12 })

    await expect(response.json()).resolves.toEqual({
      exists: true,
      size: 12
    })
    expect(response.status).toBe(200)
  })
})
