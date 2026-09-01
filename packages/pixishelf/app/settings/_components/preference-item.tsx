import type { ReactNode } from 'react'

interface PreferenceItemProps {
  title: string
  description: string
  children: ReactNode
}

export function PreferenceItem({ title, description, children }: PreferenceItemProps) {
  return (
    <section className="grid gap-4 border-b border-border py-6 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] sm:gap-8">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="w-full min-w-0 sm:justify-self-end sm:self-start">{children}</div>
    </section>
  )
}
