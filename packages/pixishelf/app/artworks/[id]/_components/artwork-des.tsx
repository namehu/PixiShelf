'use client'

import DOMPurify from 'isomorphic-dompurify'
import { FileTextIcon } from 'lucide-react'
import { FC, memo, useMemo } from 'react'

interface IArtworkDesProps {
  description?: string | null
  className?: string
}

// 检测是否为 HTML 内容
const isHtmlContent = (text: string): boolean => {
  if (!text) return false
  // 匹配常见的块级或格式化标签
  const htmlRegex =
    /<\/?\s*(p|div|br|span|h[1-6]|ul|ol|li|table|tr|td|th|b|i|strong|em|u|a|img|blockquote|code|pre)\b[^>]*>/i
  return htmlRegex.test(text)
}

// 纯文本与链接混合渲染组件
const TextWithLinks: FC<{ text: string }> = ({ text }) => {
  const content = useMemo(() => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return text.split(urlRegex).map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline break-all transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        )
      }
      return part
    })
  }, [text])

  return <p className="whitespace-pre-wrap break-words">{content}</p>
}

// 富文本渲染组件
const RichTextContent: FC<{ html: string }> = ({ html }) => {
  const sanitizedHtml = useMemo(() => {
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel', 'class', 'style']
    })
  }, [html])

  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert break-words
        prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
        dark:prose-a:text-blue-400 dark:hover:prose-a:text-blue-300
        prose-img:rounded-lg prose-img:max-w-full
        [&_a]:break-all"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      onClick={(e) => {
        // 防止链接点击冒泡
        if ((e.target as HTMLElement).closest('a')) {
          e.stopPropagation()
        }
      }}
    />
  )
}

const Component: FC<IArtworkDesProps> = (props) => {
  const { description, className } = props

  const content = useMemo(() => {
    if (!description) return null

    if (isHtmlContent(description)) {
      return <RichTextContent html={description} />
    }

    return <TextWithLinks text={description} />
  }, [description])

  if (!description) {
    return null
  }

  return (
    <div className={`${className}`}>
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <FileTextIcon className="w-5 h-5" />
        描述
      </h3>
      <div className="bg-white dark:bg-card/50 rounded-lg text-gray-700 dark:text-gray-300 leading-relaxed max-w-full overflow-hidden">
        {content}
      </div>
    </div>
  )
}

const ArtworkDes = memo(Component)
export default ArtworkDes
