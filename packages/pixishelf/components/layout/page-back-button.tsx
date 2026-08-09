'use client'

import { ChevronLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSafeBack } from '@/hooks/use-safe-back'

interface PageBackButtonProps {
  fallbackHref: string
  label: string
}

export default function PageBackButton({ fallbackHref, label }: PageBackButtonProps) {
  const safeBack = useSafeBack(fallbackHref)

  return (
    <Button variant="ghost" size="icon" onClick={safeBack} aria-label={label}>
      <ChevronLeftIcon className="h-5 w-5" />
    </Button>
  )
}
