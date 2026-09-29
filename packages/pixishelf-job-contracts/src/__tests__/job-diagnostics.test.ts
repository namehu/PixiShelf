import { describe, expect, it } from 'vitest'
import {
  extractJobDiagnostic,
  jobMediaDiagnosticEvidenceSchema,
  sanitizeDiagnosticText,
  sanitizeJobDiagnostic
} from '../job-diagnostics.js'

describe('safe job diagnostics', () => {
  const media = {
    headHex: '00000000',
    receivedBytes: 4,
    contentLength: 4,
    mimeType: 'image/png',
    expectedSha1: 'a'.repeat(40),
    actualSha1: 'b'.repeat(40),
    hashComplete: true
  }
  it('keeps bounded media evidence and a stable authored explanation above decoder causes', () => {
    const result = extractJobDiagnostic({
      code: 'MEDIA_INVALID',
      message: '图片内容已损坏',
      httpStatus: 200,
      mediaEvidence: media,
      cause: new Error('Input buffer contains unsupported image format')
    })
    expect(result.message).toBe('图片内容已损坏')
    expect(result.reasonKey).toBe('code:MEDIA_INVALID')
    expect(result.httpStatus).toBe(200)
    expect(result.evidence[0]?.media).toEqual(media)
    expect(sanitizeJobDiagnostic(result)).toEqual(result)
  })
  it.each(['image/png secret', 'image/<png>', 'image/png\r\nAuthorization: secret', 'https://secret.test'])(
    'rejects illegal MIME evidence %s',
    (mimeType) => {
      expect(jobMediaDiagnosticEvidenceSchema.safeParse({ ...media, mimeType }).success).toBe(false)
    }
  )
  it('rejects oversized heads and unlisted body or URL evidence without collecting raw objects', () => {
    for (const invalid of [
      { ...media, headHex: '00'.repeat(33) },
      { ...media, url: 'https://secret.test' },
      { ...media, body: 'private content' }
    ]) {
      expect(jobMediaDiagnosticEvidenceSchema.safeParse(invalid).success).toBe(false)
      expect(
        extractJobDiagnostic({ code: 'MEDIA_INVALID', mediaEvidence: invalid }).evidence.some((item) => item.media)
      ).toBe(false)
    }
  })
  it('preserves deepest non-media reason over a generic caller summary', () => {
    expect(
      extractJobDiagnostic(new Error('outer', { cause: new Error('Missing artwork id') }), { message: 'Task failed' })
        .message
    ).toBe('Missing artwork id')
  })
  it('hides absolute directories and retains only the filename', () => {
    expect(
      sanitizeDiagnosticText('failed https://archive.test/s/private-token/42-51 at /private/archive/item.webp')
    ).toBe('failed [地址已隐藏] at [路径已隐藏]/item.webp')
    expect(sanitizeDiagnosticText('ENOENT open C:\\private\\archive\\item.webp')).toBe(
      'ENOENT open [路径已隐藏]/item.webp'
    )
    expect(sanitizeDiagnosticText('failed \\\\server\\private\\item.webp')).toBe('failed [路径已隐藏]/item.webp')
    expect(sanitizeDiagnosticText('item.webp')).toBe('item.webp')
  })
  it('preserves a specific prose-only cause while removing SQL, URLs, credentials and stack frames', () => {
    expect(extractJobDiagnostic(new Error('Metadata JSON has no required artwork id')).message).toBe(
      'Metadata JSON has no required artwork id'
    )
    const result = extractJobDiagnostic(
      new Error(
        'Metadata invalid at https://user:secret@example.test/private?token=abc\nAuthorization: Bearer secret\nSELECT email FROM users\n at parser (private.ts:5)'
      )
    )
    expect(result.message).toContain('Metadata invalid')
    expect(result.message).not.toMatch(/secret|example.test|abc|SELECT|email|parser|private.ts/)
  })
  it('keeps ordered causes and does not mistake domain EXTERNAL codes for errno', () => {
    const error = Object.assign(new Error('External process failed'), {
      code: 'EXTERNAL_PROCESS_FAILED',
      cause: Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })
    })
    const result = extractJobDiagnostic(error, { code: 'EXTERNAL_PROCESS_FAILED' })
    expect(result.reasonKey).toBe('errno:ETIMEDOUT')
    expect(sanitizeJobDiagnostic(result)).toEqual(result)
    expect(result.evidence.map((item) => item.code)).toEqual(['EXTERNAL_PROCESS_FAILED', 'ETIMEDOUT'])
    expect(extractJobDiagnostic({ code: 'EXTERNAL_PROCESS_FAILED' }).reasonKey).toBe('code:EXTERNAL_PROCESS_FAILED')
  })
  it('reads archive HTTP status and host from error and nested causes', () => {
    const result = extractJobDiagnostic({
      code: 'ARCHIVE_DOWNLOAD_FAILED',
      cause: { message: 'Too many requests', httpStatus: 429, remoteHost: 'i.pximg.net:443' }
    })
    expect(result).toMatchObject({ httpStatus: 429, remoteHost: 'i.pximg.net:443', reasonKey: 'http:429' })
    expect(result.message).toContain('Too many requests')
  })
  it('keeps root errno, domain code and status without raw errors or credentials', () => {
    const cause = Object.assign(new Error('postgres://user:secret@db SELECT secret FROM users'), {
      code: 'ECONNRESET',
      errno: -104
    })
    const result = extractJobDiagnostic(
      Object.assign(new Error('Authorization: Bearer secret'), { code: 'DOWNLOAD_FAILED', status: 502, cause })
    )
    expect(result.code).toBe('ECONNRESET')
    expect(result.evidence).toContainEqual({ code: 'DOWNLOAD_FAILED', errno: undefined, httpStatus: 502 })
    expect(result.reasonKey).toBe('errno:ECONNRESET')
    expect(JSON.stringify(result)).not.toMatch(/secret|postgres|SELECT|Bearer|stack/)
  })
  it('bounds cyclic causes and throwing getters', () => {
    const error: { cause?: unknown; code: string } = { code: 'ENOSPC' }
    error.cause = error
    expect(extractJobDiagnostic(error).message).toContain('存储空间不足')
    expect(
      extractJobDiagnostic({
        get code() {
          throw new Error('secret')
        }
      }).code
    ).toBe('UNKNOWN_ERROR')
  })
  it('keeps validated hosts with ports and rejects credential addresses', () => {
    expect(extractJobDiagnostic(null, { remoteHost: 'example.test:443' }).remoteHost).toBe('example.test:443')
    expect(extractJobDiagnostic(null, { remoteHost: '[::1]:8443' }).remoteHost).toBe('[::1]:8443')
    expect(extractJobDiagnostic(null, { remoteHost: 'user:password@example.test' }).remoteHost).toBeNull()
    expect(sanitizeDiagnosticText('failure https://example.test/private?token=secret')).not.toContain('secret')
  })
})
