import sharp from 'sharp'
import { readMediaContentFile } from '../media-content/file-reader.ts'
import { MediaContentFileError } from '../media-content/roots.ts'
import { featureFromGray96, whiteBorderRectangle, insetRectangle, type VisualView } from './visual-experiment.ts'
import { VISUAL_LIMITS } from './visual-matching.ts'
export async function readVisualMedia(input: Parameters<typeof readMediaContentFile>[0]) {
  const { content, ...read } = await readMediaContentFile({ ...input, captureBytesLimit: VISUAL_LIMITS.bytes })
  if (!content) throw new MediaContentFileError('INVALID_FILE', 'Missing bounded visual input')
  sharp.cache(false); sharp.concurrency(1)
  const options = { limitInputPixels: VISUAL_LIMITS.pixels, failOn: 'error' as const }
  try {
    const metadata = await sharp(content, options).metadata()
    if ((metadata.pages ?? 1) !== 1 || !['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(metadata.format ?? ''))
      throw new Error('Not a supported single-frame raster')
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1)
    const width = (rotated ? metadata.height : metadata.width)!, height = (rotated ? metadata.width : metadata.height)!
    if (!width || !height) throw new Error('Missing size')
    const normalize = () => sharp(content, options).rotate().toColourspace('srgb').flatten({ background: 'white' })
    const gray = await normalize().resize(96, 96, { fit: 'fill', kernel: 'lanczos3' }).greyscale().raw().toBuffer()
    const views: VisualView[] = [{ name: 'original', feature: featureFromGray96(gray, width, height) }]
    const preview = await normalize().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    if (preview.info.channels !== 3) throw new Error('Invalid preview')
    const trim = whiteBorderRectangle(preview.data, preview.info.width, preview.info.height)
    const rectangles = [
      ...(trim.width !== preview.info.width || trim.height !== preview.info.height ? [{ name: 'white-trim', rectangle: trim }] : []),
      { name: 'trim-crop5', rectangle: insetRectangle(trim, 0.05) },
      { name: 'trim-crop10', rectangle: insetRectangle(trim, 0.1) }
    ]
    for (const { name, rectangle } of rectangles) {
      const pixels = await sharp(preview.data, { raw: { width: preview.info.width, height: preview.info.height, channels: 3 } })
        .extract(rectangle).resize(96, 96, { fit: 'fill', kernel: 'lanczos3' }).greyscale().raw().toBuffer()
      views.push({ name, feature: featureFromGray96(pixels, rectangle.width, rectangle.height) })
    }
    return { ...read, views }
  } catch {
    throw new MediaContentFileError('INVALID_FILE', 'Unsupported visual input')
  }
}
export type VisualRead = Awaited<ReturnType<typeof readVisualMedia>>
