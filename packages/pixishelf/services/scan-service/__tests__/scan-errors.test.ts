import { describe, expect, it } from 'vitest'
import {
  formatInvalidMetadataPathError,
  formatScanHttpErrorText,
  formatScanUserError,
  getRawErrorMessage,
  isScanCancelledError
} from '../scan-errors'

describe('scan error formatting', () => {
  it('formats cancellation consistently for user-visible scan errors', () => {
    expect(formatScanUserError(new Error('Scan cancelled'))).toBe('扫描已取消')
    expect(isScanCancelledError('扫描已取消')).toBe(true)
    expect(isScanCancelledError('Scan cancelled')).toBe(true)
  })

  it('keeps raw error details available for logs while returning a stable user message', () => {
    const error = new Error('Database cleanup failed: permission denied on table "Artwork"')

    expect(getRawErrorMessage(error)).toBe('Database cleanup failed: permission denied on table "Artwork"')
    expect(formatScanUserError(error)).toBe('清空数据库失败，请查看日志')
  })

  it('explains that an empty force-scan source leaves existing data unchanged', () => {
    expect(formatScanUserError('Force scan aborted: no metadata files found')).toBe(
      '强制扫描已中止：扫描目录中未发现 Pixiv 元数据文件，原有数据未修改'
    )
  })

  it('formats incomplete force rebuilds as failures', () => {
    expect(formatScanUserError('Force scan failed to rebuild 2 of 10 discovered artworks')).toBe(
      '强制扫描未能完整重建所有作品，请查看扫描日志'
    )
  })

  it('normalizes batch failures without exposing nested implementation details', () => {
    expect(formatScanUserError('Failed to process batch 3: Unique constraint failed on Image.path')).toBe(
      '部分作品处理失败，请查看扫描日志'
    )
  })

  it('formats invalid metadata paths in Chinese while keeping the skipped path actionable', () => {
    expect(formatInvalidMetadataPathError('../evil/999-meta.txt')).toBe(
      '发现越界的元数据路径，已跳过: ../evil/999-meta.txt'
    )
  })

  it('extracts user-visible scan errors from JSON HTTP error responses', () => {
    expect(formatScanHttpErrorText('{"error":"扫描路径未配置，请先在设置中配置扫描目录"}')).toBe(
      '扫描路径未配置，请先在设置中配置扫描目录'
    )
    expect(formatScanHttpErrorText('SCAN_PATH is not configured')).toBe('扫描路径未配置，请先在设置中配置扫描目录')
  })
})
