const naturalFileNameCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

export function compareFileNamesNaturally(left: string, right: string): number {
  return naturalFileNameCollator.compare(left, right)
}
