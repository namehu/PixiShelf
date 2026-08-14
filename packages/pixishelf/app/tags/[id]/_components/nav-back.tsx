'use client'

import { ArrowLeftIcon } from 'lucide-react'
import { useSafeBack } from '@/hooks/use-safe-back'
import { Button } from '@/components/ui/button'

export function NavBack() {
  const safeBack = useSafeBack('/tags')

  return (
    <Button type="button" variant="ghost" size="icon" onClick={safeBack} aria-label="返回标签列表">
      <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
    </Button>
  )
}
