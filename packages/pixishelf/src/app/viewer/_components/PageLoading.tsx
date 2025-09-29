export default function PageLoading() {
  return (
    <main className="h-screen w-screen bg-black flex items-center justify-center">
      <div className="text-center text-white">
        <div className="mb-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
        </div>
        <p className="text-lg font-medium mb-2">正在加载图片...</p>
        <p className="text-sm opacity-60">请稍候</p>
      </div>
    </main>
  )
}
