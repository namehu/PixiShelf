'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BackButtonProps {
  className?: string
  children?: React.ReactNode
}

export function BackButton({ className, children = '返回' }: BackButtonProps) {
  const router = useRouter()

  return (
    <Button
      variant="outline"
      onClick={() => router.back()}
      className={className}
    >
      <ChevronLeftIcon className="w-4 h-4 mr-2" />
      {children}
    </Button>
  )
}
