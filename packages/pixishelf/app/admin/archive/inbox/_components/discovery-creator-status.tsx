import { Badge } from '@/components/ui/badge'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

type Creator = { id: number; name: string }
export function DiscoveryCreatorStatus({
  effectiveCreators,
  pendingCreators
}: {
  effectiveCreators?: Creator[]
  pendingCreators?: Creator[]
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {!effectiveCreators?.length && !pendingCreators?.length ? (
        <span className="text-xs text-muted-foreground">未绑定艺术家</span>
      ) : null}
      {(effectiveCreators ?? []).map((creator) => (
        <Badge key={creator.id} className="max-w-full" variant="secondary">
          已绑定：
          <PrivacySensitiveText className="min-w-0 whitespace-normal break-words">{creator.name}</PrivacySensitiveText>
        </Badge>
      ))}
      {(pendingCreators ?? []).map((creator) => (
        <Badge key={creator.id} variant="outline">
          待生效：
          <PrivacySensitiveText className="min-w-0 whitespace-normal break-words">{creator.name}</PrivacySensitiveText>
        </Badge>
      ))}
    </div>
  )
}

export function CatalogStatusBadge({
  item
}: {
  item: {
    comparisonKnown: boolean
    workflowStage:
      | 'NEW'
      | 'UPDATE_AVAILABLE'
      | 'REPLACEMENT'
      | 'INBOX'
      | 'READY'
      | 'DOWNLOADING'
      | 'ARCHIVED'
      | 'FAILED'
      | 'CANCELLED'
      | 'DUPLICATE'
  }
}) {
  const states = {
    NEW: { label: '新归档', variant: 'success' as const },
    UPDATE_AVAILABLE: { label: '可能更新', variant: 'info' as const },
    REPLACEMENT: { label: '替代版本', variant: 'warning' as const },
    INBOX: { label: '等待解析', variant: 'warning' as const },
    READY: { label: '待确认下载', variant: 'info' as const },
    DOWNLOADING: { label: '下载中', variant: 'warning' as const },
    ARCHIVED: { label: item.comparisonKnown ? '已归档' : '已归档 · 待校验', variant: 'muted' as const },
    FAILED: { label: '处理失败', variant: 'destructive' as const },
    CANCELLED: { label: '已取消', variant: 'muted' as const },
    DUPLICATE: { label: '身份重复', variant: 'warning' as const }
  }
  const state = states[item.workflowStage]
  return <Badge variant={state.variant}>{state.label}</Badge>
}
