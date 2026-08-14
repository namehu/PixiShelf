import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'
import { adminNavigationGroups } from './_constant'
import { AdminSection, AdminSectionHeader, AdminWorkbench } from './_components/admin-workbench'

export default function AdminDashboard() {
  return (
    <AdminWorkbench title="管理中心" description="查看图库状态，并进入内容档案或系统工具。">
      <div className="grid min-w-0 gap-8 xl:grid-cols-2">
        {adminNavigationGroups.map((group) => {
          const items = group.items.filter((item) => item.href !== '/admin')
          if (items.length === 0) return null

          return (
            <AdminSection key={group.id} aria-labelledby={`admin-overview-${group.id}`}>
              <AdminSectionHeader title={<span id={`admin-overview-${group.id}`}>{group.label}</span>} />
              <div className="grid min-w-0 border-b border-border sm:grid-cols-2">
                {items.map((section) => {
                  const Icon = section.icon
                  return (
                    <Link
                      key={section.href}
                      href={section.href}
                      className="group flex min-w-0 items-start gap-3 border-t border-border py-4 outline-none transition-colors hover:bg-accent/45 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 sm:px-3"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          {section.title}
                          <ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{section.description}</span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </AdminSection>
          )
        })}
      </div>
    </AdminWorkbench>
  )
}
