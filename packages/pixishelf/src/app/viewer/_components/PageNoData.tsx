import { useRouter } from 'next/navigation'

export default function PageNoData() {
  const router = useRouter()
  return (
    <main className="h-screen w-screen bg-black flex items-center justify-center">
      <div className="text-center text-white">
        <div className="mb-4">
          <svg className="w-16 h-16 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">暂无图片</h2>
        <p className="text-sm opacity-60 mb-4">当前没有可浏览的图片内容</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
        >
          返回
        </button>
      </div>
    </main>
  )
}
