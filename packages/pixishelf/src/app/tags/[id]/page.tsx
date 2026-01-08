import { notFound } from 'next/navigation'
import { TagIcon, WallpaperIcon, ArrowLeft } from 'lucide-react'
import { getById } from '@/services/tag-service'
import { getTranslateName } from '@/utils/tags'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ArtworkList } from './_components/ArtworkList'
import Link from 'next/link'

/**
 * 标签详情页面 (Server Component)
 */
export default async function TagDetailPage({ params }: PageProps<'/tags/[id]'>) {
  const { id } = await params
  const tagId = Number(id)

  if (isNaN(tagId)) {
    notFound()
  }

  const tag = await getById(tagId)

  if (!tag) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-blue-100 flex flex-col">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 backdrop-blur-xl border-b border-slate-200/50 bg-white/80 px-4 h-16">
        <div className="max-w-screen-xl h-full mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href="/tags" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>

            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4 duration-500">
              <span className="font-bold text-lg tracking-tight text-slate-800 line-clamp-1">{tag.name}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-screen-xl mx-auto px-4 py-8">
        {/* 标签信息 Hero 区域 */}
        <div className="mb-10 flex flex-col md:flex-row items-start md:items-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="relative group shrink-0">
            <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-xl shadow-blue-900/5 ring-4 ring-white bg-white">
              <Avatar className="w-full h-full">
                <AvatarImage src={tag.image ?? ''} className="object-cover" />
                <AvatarFallback className="flex items-center justify-center w-full h-full bg-blue-50 text-blue-500">
                  <TagIcon className="w-10 h-10" />
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">{tag.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold border border-blue-100">
                {getTranslateName(tag)}
              </span>
            </div>

            {tag.description && <p className="text-slate-500 max-w-2xl leading-relaxed">{tag.description}</p>}

            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200/60 px-3 py-1 rounded-full shadow-sm">
                <WallpaperIcon className="w-4 h-4 text-slate-400" />
                <span>{tag.artworkCount} 作品</span>
              </div>
            </div>
          </div>
        </div>

        {/* 作品列表 (Client Component) */}
        <ArtworkList tagId={id} />
      </main>
    </div>
  )
}
