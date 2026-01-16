
'use client'
import { useParams } from 'next/navigation'
import SeriesDetailAdmin from './_components/series-detail-admin'

export default function Page() {
  const params = useParams()
  const id = Number(params.id)
  if (isNaN(id)) return <div>Invalid ID</div>
  return <SeriesDetailAdmin seriesId={id} />
}
