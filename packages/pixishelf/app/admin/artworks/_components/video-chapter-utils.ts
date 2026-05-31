import { buildCanonicalChapterFileName, getVideoBaseNameFromChapterFile } from '@/utils/artwork/video-chapter-files'

export interface ReplaceVideoPreviewLike {
  id: string
  originalName: string
  newName: string
}

export interface ChapterUploadItemLike {
  id: string
  originalName: string
}

export interface MatchedChapterUploadPlan {
  chapterId: string
  chapterOriginalName: string
  videoId: string
  videoOriginalName: string
  videoNewName: string
  chapterNewName: string
}

export interface ConflictingChapterUploadPlan {
  videoId: string
  videoOriginalName: string
  chapterIds: string[]
  chapterOriginalNames: string[]
}

export function buildReplaceChapterUploadPlan(
  videos: ReplaceVideoPreviewLike[],
  chapterFiles: ChapterUploadItemLike[]
): {
  matched: MatchedChapterUploadPlan[]
  unmatched: ChapterUploadItemLike[]
  conflicting: ConflictingChapterUploadPlan[]
} {
  const videoBaseNameMap = new Map<string, ReplaceVideoPreviewLike>()

  for (const video of videos) {
    const extIndex = video.originalName.lastIndexOf('.')
    const baseName = extIndex >= 0 ? video.originalName.slice(0, extIndex) : video.originalName
    videoBaseNameMap.set(baseName, video)
  }

  const matched: MatchedChapterUploadPlan[] = []
  const unmatched: ChapterUploadItemLike[] = []
  const matchedByVideoId = new Map<string, MatchedChapterUploadPlan[]>()

  for (const chapterFile of chapterFiles) {
    const videoBaseName = getVideoBaseNameFromChapterFile(chapterFile.originalName)
    if (!videoBaseName) {
      unmatched.push(chapterFile)
      continue
    }

    const matchedVideo = videoBaseNameMap.get(videoBaseName)
    if (!matchedVideo) {
      unmatched.push(chapterFile)
      continue
    }

    const plan = {
      chapterId: chapterFile.id,
      chapterOriginalName: chapterFile.originalName,
      videoId: matchedVideo.id,
      videoOriginalName: matchedVideo.originalName,
      videoNewName: matchedVideo.newName,
      chapterNewName: buildCanonicalChapterFileName(matchedVideo.newName)
    }
    matched.push(plan)
    matchedByVideoId.set(matchedVideo.id, [...(matchedByVideoId.get(matchedVideo.id) || []), plan])
  }

  const conflicting: ConflictingChapterUploadPlan[] = []
  const filteredMatched: MatchedChapterUploadPlan[] = []

  for (const [videoId, plans] of matchedByVideoId.entries()) {
    if (plans.length > 1) {
      conflicting.push({
        videoId,
        videoOriginalName: plans[0]!.videoOriginalName,
        chapterIds: plans.map((item) => item.chapterId),
        chapterOriginalNames: plans.map((item) => item.chapterOriginalName)
      })
      continue
    }

    filteredMatched.push(plans[0]!)
  }

  return {
    matched: filteredMatched,
    unmatched,
    conflicting
  }
}
