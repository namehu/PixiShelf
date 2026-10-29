import { Skeleton } from '@/components/ui/skeleton'

export function InboxLoading() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[5rem_1fr_7rem] items-center gap-4 border-b pb-3 last:border-b-0 last:pb-0"
        >
          <Skeleton className="h-4 w-14" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  )
}
