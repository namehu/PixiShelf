import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseDateFromFilename, parseDateFromMetadata, parseFileDate } from './date-parser'
// @ts-ignore
import ExifReader from 'exifreader'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

// Mock ExifReader
vi.mock('exifreader', () => {
  return {
    default: {
      load: vi.fn()
    }
  }
})

describe('Date Parser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseDateFromFilename', () => {
    const testCases = [
      // YYYY-MM-DD variants
      { filename: '2026-02-01 ペリカ(Perlica) (1).mp4', expected: '2026-02-01' },
      { filename: 'IMG_2025_12_31.jpg', expected: '2025-12-31' },
      { filename: '2024.01.15_backup.zip', expected: '2024-01-15' },
      { filename: 'photo 2023 05 20.png', expected: '2023-05-20' },

      // YYYYMMDD
      { filename: '20260303_capture.png', expected: '2026-03-03' },
      { filename: 'VID_20251111_123456.mp4', expected: '2025-11-11' },

      // DD-MM-YYYY
      { filename: '31-12-2024-party.jpg', expected: '2024-12-31' },
      { filename: '01.02.2025 report.pdf', expected: '2025-02-01' },

      // Invalid
      { filename: 'random-file.txt', expected: null },
      { filename: 'version_1.2.3.png', expected: null }, // 可能会误判，取决于正则严谨度，1.2.3 不满4位年份
      { filename: '202-01-01.jpg', expected: null }
    ]

    testCases.forEach(({ filename, expected }) => {
      it(`should parse "${filename}" correctly`, () => {
        const result = parseDateFromFilename(filename)
        if (expected) {
          expect(result).not.toBeNull()
          expect(dayjs(result).format('YYYY-MM-DD')).toBe(expected)
        } else {
          expect(result).toBeNull()
        }
      })
    })
  })

  describe('parseDateFromMetadata', () => {
    it('should parse DateTimeOriginal from EXIF', async () => {
      const file = new File([''], 'test.jpg', { type: 'image/jpeg' })
      const mockTags = {
        exif: {
          DateTimeOriginal: { description: '2025:12:25 10:30:00' }
        }
      }
      vi.mocked(ExifReader.load).mockResolvedValue(mockTags)

      const result = await parseDateFromMetadata(file)
      expect(result).not.toBeNull()
      expect(dayjs(result).format('YYYY-MM-DD HH:mm:ss')).toBe('2025-12-25 10:30:00')
    })

    it('should fallback to CreateDate', async () => {
      const file = new File([''], 'test.jpg', { type: 'image/jpeg' })
      const mockTags = {
        exif: {
          CreateDate: { description: '2024:01:01 12:00:00' }
        }
      }
      vi.mocked(ExifReader.load).mockResolvedValue(mockTags)

      const result = await parseDateFromMetadata(file)
      expect(result).not.toBeNull()
      expect(dayjs(result).format('YYYY-MM-DD HH:mm:ss')).toBe('2024-01-01 12:00:00')
    })

    it('should return null for non-image files', async () => {
      const file = new File([''], 'video.mp4', { type: 'video/mp4' })
      const result = await parseDateFromMetadata(file)
      expect(result).toBeNull()
      expect(ExifReader.load).not.toHaveBeenCalled()
    })
  })

  describe('parseFileDate (Integration)', () => {
    const defaultDate = new Date('2020-01-01')

    it('should prioritize filename', async () => {
      const file = new File([''], '2026-02-01.jpg', { type: 'image/jpeg' })
      // Even if metadata exists
      vi.mocked(ExifReader.load).mockResolvedValue({
        exif: { DateTimeOriginal: { description: '2025:12:25 10:30:00' } }
      })

      const result = await parseFileDate(file, defaultDate)
      expect(result.source).toBe('filename')
      expect(dayjs(result.date).format('YYYY-MM-DD')).toBe('2026-02-01')
    })

    it('should fallback to metadata if filename fails', async () => {
      const file = new File([''], 'image.jpg', { type: 'image/jpeg' })
      vi.mocked(ExifReader.load).mockResolvedValue({
        exif: { DateTimeOriginal: { description: '2025:12:25 10:30:00' } }
      })

      const result = await parseFileDate(file, defaultDate)
      expect(result.source).toBe('metadata')
      expect(dayjs(result.date).format('YYYY-MM-DD')).toBe('2025-12-25')
    })

    it('should fallback to default if both fail and no lastModified', async () => {
      const file = new File([''], 'unknown.txt', { type: 'text/plain' })
      Object.defineProperty(file, 'lastModified', { value: undefined })
      const result = await parseFileDate(file, defaultDate)
      expect(result.source).toBe('default')
      expect(result.date).toEqual(defaultDate)
    })

    it('should fallback to file-attribute (lastModified) if metadata and filename fail', async () => {
      const lastMod = new Date('2023-05-01').getTime()
      const file = new File([''], 'video.mp4', { type: 'video/mp4', lastModified: lastMod })

      const result = await parseFileDate(file, defaultDate)
      expect(result.source).toBe('file-attribute')
      expect(dayjs(result.date).format('YYYY-MM-DD')).toBe('2023-05-01')
    })
  })
})
