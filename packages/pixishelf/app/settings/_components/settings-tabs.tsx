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
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="grid grid-cols-2 gap-1">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'rounded-xl px-4 py-2 text-sm font-medium transition-all text-center',
                isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
