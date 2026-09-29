import { Badge } from '@/components/ui/badge'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

type Creator = { id: number; name: string }
export function DiscoveryCreatorStatus({
  effectiveCreators,
  pendingCreators,
  maxVisible
}: {
  effectiveCreators?: Creator[]
  pendingCreators?: Creator[]
  maxVisible?: number
}) {
  const effective = effectiveCreators ?? []
  const pending = pendingCreators ?? []
  const limit = maxVisible ?? effective.length + pending.length
  const hidden = Math.max(0, effective.length + pending.length - limit)
  return (
    <div className="flex flex-wrap gap-1">
      {!effectiveCreators?.length && !pendingCreators?.length ? (
        <span className="text-xs text-muted-foreground">未绑定艺术家</span>
      ) : null}
      {effective.slice(0, limit).map((creator) => (
        <Badge key={creator.id} className="max-w-full" variant="secondary">
          已绑定：
          <PrivacySensitiveText className="min-w-0 whitespace-normal break-words">{creator.name}</PrivacySensitiveText>
        </Badge>
      ))}
      {pending.slice(0, Math.max(0, limit - effective.length)).map((creator) => (
        <Badge key={creator.id} variant="outline">
          待生效：
          <PrivacySensitiveText className="min-w-0 whitespace-normal break-words">{creator.name}</PrivacySensitiveText>
        </Badge>
      ))}
      {hidden > 0 && <span className="text-xs text-muted-foreground">另 {hidden} 位</span>}
    </div>
  )
}
