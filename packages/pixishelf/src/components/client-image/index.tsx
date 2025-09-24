'use client'

import Image, { ImageProps } from 'next/image'
import loader from '../../../lib/image-loader'
import { ImageIcon } from 'lucide-react'

interface MyImageLoaderProps extends Omit<ImageProps, 'loader'> {}

export default function ClientImage(props: MyImageLoaderProps) {
  const { src } = props

  if (!src) {
    return (
      <div className="h-full w-full bg-gray-200 flex items-center justify-center">
        <ImageIcon size={24} className="text-gray-400"></ImageIcon>
      </div>
    )
  }

  return <Image {...props} loader={loader as any} />
}
