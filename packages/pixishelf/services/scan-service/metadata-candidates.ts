export type MetadataFormat = 'txt' | 'json'

export interface MetadataCandidateFile {
  name: string
  artworkId: string
  path: string
  createdAt: Date
  metadataFormat: MetadataFormat
}

export function getMetadataFormatFromFilename(filename: string): MetadataFormat | null {
  const lowerName = filename.toLowerCase()
  if (lowerName.endsWith('-meta.json') || /_p\d+-meta\.json$/i.test(lowerName)) return 'json'
  if (lowerName.endsWith('-meta.txt') || /_p\d+-meta\.txt$/i.test(lowerName)) return 'txt'
  return null
}

export function selectPreferredMetadataFiles(
  files: MetadataCandidateFile[],
  onDuplicate?: (message: string) => void
): MetadataCandidateFile[] {
  const groups = new Map<string, MetadataCandidateFile[]>()

  for (const file of files) {
    const existing = groups.get(file.artworkId) || []
    existing.push(file)
    groups.set(file.artworkId, existing)
  }

  const selectedFiles: MetadataCandidateFile[] = []
  for (const [artworkId, candidates] of groups) {
    const sortedCandidates = [...candidates].sort((a, b) => {
      if (a.metadataFormat !== b.metadataFormat) return a.metadataFormat === 'json' ? -1 : 1
      return a.path.localeCompare(b.path)
    })
    const selected = sortedCandidates[0]
    if (!selected) continue

    const samePriorityDuplicates = sortedCandidates.filter(
      (candidate) => candidate !== selected && candidate.metadataFormat === selected.metadataFormat
    )
    if (samePriorityDuplicates.length > 0) {
      const duplicatePaths = [selected, ...samePriorityDuplicates].map((candidate) => candidate.path).join('\n ')
      onDuplicate?.(`Duplicate artworkId found: ${artworkId}\n ${duplicatePaths}`)
    }

    selectedFiles.push(selected)
  }

  return selectedFiles
}
