import { Spinner } from '@/components/ui/spinner'

interface AuthLoadingProps {
  text?: string
}

export function AuthLoading({ text = '加载中…' }: AuthLoadingProps) {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center gap-4" role="status">
      <Spinner className="size-6 text-primary" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
    </div>
  )
}
