export default function Loading() {
  return (
    <div className="space-y-8 px-4 sm:px-6 py-8">
      {/* Header skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="flex gap-2">
          <div className="h-6 w-16 bg-gray-200 rounded-full animate-pulse" />
          <div className="h-6 w-20 bg-gray-200 rounded-full animate-pulse" />
          <div className="h-6 w-18 bg-gray-200 rounded-full animate-pulse" />
        </div>
      </div>

      {/* Images skeleton */}
      <div className="max-w-4xl mx-auto space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] bg-gray-200 rounded-2xl animate-pulse" />
        ))}
      </div>
    </div>
  )
}
