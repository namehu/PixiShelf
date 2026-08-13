'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { ListTreeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { getActiveAdminSection } from '../_constant'
import { AdminNav } from './admin-nav'

export function AdminMobileNavigation() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const currentSection = getActiveAdminSection(pathname)

  return (
    <div className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-xl lg:hidden">
      <div className="min-w-0">
        <p className="font-utility text-[0.6875rem] font-medium tracking-[0.08em] text-primary uppercase">管理中心</p>
        <p className="truncate text-sm font-semibold text-foreground">{currentSection?.title || '管理模块'}</p>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" className="min-h-11">
            <ListTreeIcon data-icon="inline-start" aria-hidden="true" />
            切换模块
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          closeLabel="关闭管理导航"
          className="w-[min(88vw,22rem)] gap-0 bg-sidebar p-0 shadow-floating"
        >
          <SheetHeader className="border-b border-sidebar-border pr-14 text-left">
            <SheetTitle>管理模块</SheetTitle>
            <SheetDescription>查看、筛选并执行轻量管理操作。</SheetDescription>
          </SheetHeader>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            <AdminNav onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
