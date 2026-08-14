'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'

const tabs = [
  { href: ROUTES.SETTINGS_PROFILE, label: '个人资料' },
  { href: ROUTES.SETTINGS_PREFERENCES, label: '浏览偏好' }
]

export function SettingsTabs() {
  const pathname = usePathname()

  return (
    <nav aria-label="设置页面" className="border-b border-border">
      <div className="flex gap-6">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative min-h-11 px-0.5 py-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground',
                isActive &&
                  'text-primary after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-primary'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
