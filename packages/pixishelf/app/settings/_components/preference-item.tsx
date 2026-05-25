import React from 'react'

interface PreferenceItemProps {
  title: string
  description: string
  children: React.ReactNode
}

export function PreferenceItem({ title, description, children }: PreferenceItemProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}
