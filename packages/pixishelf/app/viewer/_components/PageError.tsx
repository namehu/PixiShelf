import { ConstructionIcon } from 'lucide-react'

export default function PageError({ content }: { content?: string }) {
  return (
    <main className="h-screen w-screen bg-black flex items-center justify-center">
      <div className="text-center text-white">
        <div className="mb-4">
          <ConstructionIcon className="w-16 h-16 mx-auto opacity-40" />
        </div>
        <h2 className="text-xl font-semibold mb-2">加载失败</h2>
        <p className="text-sm opacity-60 mb-4">{content || '无法加载数据，请检查网络连接'}</p>
        <div className="space-x-4">
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
          >
            重试
          </button>
          <button
            onClick={() => window.history.go(-1)}
            className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    </main>
  )
}
