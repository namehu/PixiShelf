import { Spinner } from '@/components/ui/spinner'

export default function PageLoading() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-black text-white"
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        <Spinner className="mx-auto mb-4 size-8" aria-hidden="true" />
        <p className="text-base font-medium">正在准备沉浸浏览</p>
        <p className="mt-1 text-sm text-white/60">正在读取作品与媒体信息…</p>
      </div>
    </div>
  )
}
