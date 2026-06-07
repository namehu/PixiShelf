'use client'

import React from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSafeBack } from '@/hooks/use-safe-back'

interface BackButtonProps {
  className?: string
  children?: React.ReactNode
}

export function BackButton({ className, children = '返回' }: BackButtonProps) {
  const safeBack = useSafeBack()

  return (
    <Button
      variant="outline"
      onClick={safeBack}
      className={className}
    >
      <ChevronLeftIcon className="w-4 h-4 mr-2" />
      {children}
    </Button>
  )
}
