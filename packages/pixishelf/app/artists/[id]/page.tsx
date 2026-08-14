import ArtistDetailPage from './_components/detail'
import { getArtistById } from '@/services/artist-service'
import { notFound } from 'next/navigation'

export default async function Page({ params }: PageProps<'/artists/[id]'>) {
  const { id } = await params
  const artist = await getArtistById(id)

  if (!artist) notFound()

  return (
    <main className="min-h-dvh bg-background">
      <ArtistDetailPage artist={artist} id={id} />
    </main>
  )
}
