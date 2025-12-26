import PLogo from '@/components/layout/p-logo'

interface AuthLoadingProps {
  text?: string
}

export function AuthLoading({ text = '加载中...' }: AuthLoadingProps) {
  return (
    <div className="h-[300px] flex flex-col items-center justify-center space-y-4 animate-pulse">
      <div className="relative">
        <div className="w-10 h-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <PLogo className="w-3 h-3 text-primary" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground font-medium">{text}</p>
    </div>
  )
}
