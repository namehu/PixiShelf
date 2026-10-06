export const mediaClassificationCases = [
  ['page.jpg', 'IMAGE', false],
  ['page.PNG', 'IMAGE', true],
  ['page.webp', 'IMAGE', true],
  ['page.GIF', 'ANIMATION', true],
  ['page.apng', 'ANIMATION', true],
  ['page.svg', 'IMAGE', false],
  ['page.tiff', 'IMAGE', false],
  ['clip.mp4', 'VIDEO', false],
  ['clip.WEBM', 'VIDEO', false],
  ['clip.flv', 'VIDEO', false],
  ['page.avif', 'UNKNOWN', false],
  ['archive.bin', 'UNKNOWN', false]
] as const
