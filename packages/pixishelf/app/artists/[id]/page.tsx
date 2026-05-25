import ArtistDetailPage from './_components/Detail'
import { getArtistById } from '@/services/artist-service'
import { notFound } from 'next/navigation'

export default async function Page({ params }: PageProps<'/artists/[id]'>) {
  const { id } = await params
  const artist = await getArtistById(id)

  if (!artist) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto">
        <ArtistDetailPage artist={artist} id={id} />
      </main>
    </div>
  )
}
