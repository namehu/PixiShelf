export interface PixivAiDerivedTagSyncResult {
  dryRun?: boolean
  scannedArtworks?: number
  aiGeneratedArtworks?: number
  nonAiArtworks?: number
  unknownAiArtworks?: number
  wouldCreateDerivedRelations?: number
  wouldConvertSourceRelations?: number
  wouldConvertLegacyRelations?: number
  wouldRemoveStaleDerivedRelations?: number
  protectedManualRelations?: number
  protectedOtherSourceRelations?: number
  appliedCreatedRelations?: number
  appliedConvertedRelations?: number
  appliedRemovedRelations?: number
  finalDerivedRelations?: number
}

export function PixivAiDerivedTagSyncFeedback({ result }: { result: PixivAiDerivedTagSyncResult | null }) {
  if (!result) return null
  const converted = (result.wouldConvertSourceRelations ?? 0) + (result.wouldConvertLegacyRelations ?? 0)
  const protectedRelations = (result.protectedManualRelations ?? 0) + (result.protectedOtherSourceRelations ?? 0)
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          模式：
          <strong className="font-medium text-foreground">{result.dryRun ? '只读预检' : '正式回填'}</strong>
        </span>
        <span>
          已核对：<strong className="font-medium text-foreground">{result.scannedArtworks ?? 0}</strong>
        </span>
        <span>
          AI 作品：<strong className="font-medium text-foreground">{result.aiGeneratedArtworks ?? 0}</strong>
        </span>
        <span>
          状态未知：<strong className="font-medium text-foreground">{result.unknownAiArtworks ?? 0}</strong>
        </span>
      </div>
      <p>
        计划新增 <strong className="font-medium text-foreground">{result.wouldCreateDerivedRelations ?? 0}</strong>，
        转换 <strong className="font-medium text-foreground">{converted}</strong>，移除过期{' '}
        <strong className="font-medium text-foreground">{result.wouldRemoveStaleDerivedRelations ?? 0}</strong>
        ；保护人工或其他来源 <strong className="font-medium text-foreground">{protectedRelations}</strong>。
      </p>
      {!result.dryRun ? (
        <p>
          实际新增 <strong className="font-medium text-foreground">{result.appliedCreatedRelations ?? 0}</strong>， 转换{' '}
          <strong className="font-medium text-foreground">{result.appliedConvertedRelations ?? 0}</strong>，移除{' '}
          <strong className="font-medium text-foreground">{result.appliedRemovedRelations ?? 0}</strong>；最终派生关系{' '}
          <strong className="font-medium text-foreground">{result.finalDerivedRelations ?? 0}</strong>。
        </p>
      ) : null}
    </div>
  )
}
