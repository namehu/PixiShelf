import { Metadata } from 'next'
import { ArtistManagement } from './_components/artist-management'
import { ArtistExportButton } from './_components/artist-export-button'
import { Users } from 'lucide-react'

export const metadata: Metadata = {
  title: '艺术家管理 - PixiShelf Admin',
  description: '管理系统中的艺术家信息'
}

export default function ArtistPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Users className="w-6 h-6" />
            艺术家管理
          </h1>
          <p className="text-neutral-600 mt-1">查看和管理艺术家信息</p>
        </div>
        <ArtistExportButton />
      </div>

      <ArtistManagement />
    </div>
  )
}
