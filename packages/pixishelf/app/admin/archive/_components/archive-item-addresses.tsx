'use client'

import { Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export function ArchiveItemAddresses({
  sourcePageUrl,
  lastDownloadUrl,
  lastDownloadAt,
  lastDownloadAttempt
}: {
  sourcePageUrl: string | null
  lastDownloadUrl: string | null
  lastDownloadAt: string | null
  lastDownloadAttempt: number | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
      <Address label="图片页地址" url={sourcePageUrl} empty="暂无有效图片页地址" />
      <Address label="下载地址" url={lastDownloadUrl} empty="尚未记录下载地址；重试收到媒体响应后会记录。" />
      {lastDownloadUrl && (
        <p>
          最近记录{lastDownloadAttempt != null ? ` · 尝试 ${lastDownloadAttempt}` : ''}
          {lastDownloadAt ? ` · ${new Date(lastDownloadAt).toLocaleString('zh-CN')}` : ''}
          。地址可能过期或需要原站访问条件，失效时请打开图片页或重试此图。
        </p>
      )}
    </div>
  )
}

function Address({ label, url, empty }: { label: string; url: string | null; empty: string }) {
  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`${label}已复制`)
    } catch {
      toast.error('复制失败，请手动选择地址复制')
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span>{label}</span>
        {url && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={copy} aria-label={`复制${label}`}>
              <Copy data-icon="inline-start" aria-hidden="true" />
              复制
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                aria-label={`打开${label}`}
              >
                <ExternalLink data-icon="inline-start" aria-hidden="true" />
                打开
              </a>
            </Button>
          </>
        )}
      </div>
      {url ? (
        <PrivacySensitiveText className="block select-text break-all">{url}</PrivacySensitiveText>
      ) : (
        <p>{empty}</p>
      )}
    </div>
  )
}
