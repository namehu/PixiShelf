'use client'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-red-600 mb-4">!</h1>
          <h2 className="text-2xl font-semibold text-gray-700 mb-2">出现错误</h2>
          <p className="text-gray-600">抱歉，页面加载时出现了错误。</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={reset}
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            重试
          </button>

          <div>
            <a href="/dashboard" className="text-blue-600 hover:text-blue-800 transition-colors">
              返回首页
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
