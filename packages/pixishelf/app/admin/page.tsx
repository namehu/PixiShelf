import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { sections } from './_constant'
import { ArrowRight } from 'lucide-react'

export default function AdminDashboard() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">管理中心</h1>
        <p className="text-muted-foreground">欢迎回来，请选择您要管理的项目。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="block h-full">
            <Card className="hover:bg-slate-50 transition-colors cursor-pointer h-full flex flex-col justify-between">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">{section.title}</CardTitle>
                <section.icon className={`h-5 w-5 ${section.color}`} />
              </CardHeader>
              <CardContent>
                <CardDescription className="flex items-center gap-1 mt-2">
                  {section.description} <ArrowRight className="h-3 w-3" />
                </CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
