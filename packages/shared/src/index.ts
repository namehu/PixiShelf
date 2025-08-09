export type Artwork = {
  id: number
  title: string
  description?: string | null
  tags: string[]
}

export type Artist = {
  id: number
  name: string
  bio?: string | null
}

export type Image = {
  id: number
  path: string
  width?: number | null
  height?: number | null
  size?: number | null
  artworkId?: number | null
}