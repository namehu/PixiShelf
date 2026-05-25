import { ImageIcon } from 'lucide-react'
import { FC } from 'react'

const Componet: FC = () => {
  return null
}

export const Placeholder = Componet as unknown as typeof Componet & { Image: FC }

// 占位符，避免渲染实际的图片组件
Placeholder.Image = () => {
  return (
    <div className="w-full h-full flex items-center justify-center bg-neutral-900">
      <div className="text-center text-white/40">
        <div className="p-8 mx-auto text-white/60 bg-white/5 rounded-lg flex flex-col items-center justify-center">
          <ImageIcon size={48}></ImageIcon>
          <p className="text-sm mt-2">准备中...</p>
        </div>
      </div>
    </div>
  )
}
