'use client'

import DOMPurify from 'isomorphic-dompurify'
import { memo, useMemo, type FC } from 'react'
import { cn } from '@/lib/utils'

interface ArtworkDescriptionProps {
  description?: string | null
  className?: string
}

const isHtmlContent = (text: string) =>
  /<\/?\s*(p|div|br|span|h[1-6]|ul|ol|li|table|tr|td|th|b|i|strong|em|u|a|img|blockquote|code|pre)\b[^>]*>/i.test(text)

const TextWithLinks: FC<{ text: string }> = ({ text }) => {
  const content = useMemo(() => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return text.split(urlRegex).map((part, index) =>
      part.match(urlRegex) ? (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline-offset-4 hover:underline"
        >
          {part}
        </a>
      ) : (
        part
      )
    )
  }, [text])

  return <p className="whitespace-pre-wrap break-words">{content}</p>
}

const RichTextContent: FC<{ html: string }> = ({ html }) => {
  const sanitizedHtml = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        ADD_ATTR: ['target', 'rel', 'class', 'style']
      }),
    [html]
  )

  return (
    <div
      className="prose prose-sm max-w-none break-words prose-a:text-primary prose-a:underline-offset-4 prose-a:hover:underline prose-img:max-w-full prose-img:rounded-md [&_a]:break-all"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
}

const ArtworkDescription: FC<ArtworkDescriptionProps> = ({ description, className }) => {
  const content = useMemo(() => {
    if (!description) return null
    return isHtmlContent(description) ? <RichTextContent html={description} /> : <TextWithLinks text={description} />
  }, [description])

  if (!description) return null

  return (
    <section aria-labelledby="artwork-description-heading" className={cn('border-t border-border pt-6', className)}>
      <h2 id="artwork-description-heading" className="mb-3 text-base font-semibold text-foreground sm:text-lg">
        描述
      </h2>
      <div className="max-w-full overflow-hidden text-sm leading-7 text-muted-foreground">{content}</div>
    </section>
  )
}

export default memo(ArtworkDescription)
