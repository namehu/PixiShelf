import { archiveSubmittedSourceUrl } from '@/lib/archive-submitted-url'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export function ArchiveSubmittedSourceLink({ url }: { url: string }) {
  const href = archiveSubmittedSourceUrl(url)
  return (
    <PrivacySensitiveText as="p" className="break-all font-mono text-xs text-muted-foreground">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="hover:underline focus-visible:underline"
          title="在新标签页打开原站"
        >
          {url}
        </a>
      ) : (
        url
      )}
    </PrivacySensitiveText>
  )
}
