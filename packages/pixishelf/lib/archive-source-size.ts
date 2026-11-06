export function formatArchiveSourceSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '未知'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${index === 0 ? bytes : (bytes / 1024 ** index).toFixed(2)} ${units[index]}`
}
