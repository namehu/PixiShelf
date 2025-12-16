import { FileTextIcon } from 'lucide-react'
import { FC, memo, useMemo } from 'react'

interface IArtworkDesProps {
  description?: string | null
  className?: string
}

const Component: FC<IArtworkDesProps> = (props) => {
  const { description, className } = props

  const renderedContent = useMemo(() => {
    // 正则表达式匹配 URL (http 或 https 开头)
    // 使用括号 () 包裹正则，这样 split 的结果中会保留匹配到的 URL
    const urlRegex = /(https?:\/\/[^\s]+)/g

    return (description ?? '').split(urlRegex).map((part, index) => {
      // 如果这一部分匹配 URL 正则，则渲染为链接
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer" // 安全最佳实践，防止新页面访问原页面对象
            className="text-blue-600 hover:text-blue-800 hover:underline break-all transition-colors"
            onClick={(e) => e.stopPropagation()} // 防止冒泡（如果父级有点击事件）
          >
            {part}
          </a>
        )
      }
      // 否则渲染为普通文本
      return part
    })
  }, [description])

  if (!description) {
    return null
  }

  return (
    <div className={`${className}`}>
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <FileTextIcon />
        描述
      </h3>
      <div className="bg-white rounded-lg text-gray-700 leading-relaxed max-w-full overflow-hidden">
        {/* 保留 whitespace-pre-wrap 以处理换行符 (\n) */}
        <p className="whitespace-pre-wrap break-words">{renderedContent}</p>
      </div>
    </div>
  )
}

const ArtworkDes = memo(Component)
export default ArtworkDes
