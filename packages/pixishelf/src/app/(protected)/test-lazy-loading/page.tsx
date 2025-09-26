'use client'

import { useState } from 'react'
import ClientImage from '@/components/client-image'

export default function TestLazyLoadingPage() {
  const [showImages, setShowImages] = useState(false)

  // 模拟图片数据
  const testImages = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    src: `/api/test-image/${i + 1}`, // 假设的测试图片路径
    alt: `Test Image ${i + 1}`
  }))

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">懒加载测试页面</h1>
      
      <div className="mb-8">
        <button
          onClick={() => setShowImages(!showImages)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          {showImages ? '隐藏图片' : '显示图片'}
        </button>
      </div>

      {/* 添加一些空白区域，确保图片在视口外 */}
      <div className="h-screen bg-gray-100 mb-8 flex items-center justify-center">
        <p className="text-gray-600">滚动下方查看懒加载效果</p>
      </div>

      {showImages && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {testImages.map((image) => (
            <div key={image.id} className="aspect-square bg-gray-200 rounded-lg overflow-hidden">
              <ClientImage
                src={image.src}
                alt={image.alt}
                width={300}
                height={300}
                className="w-full h-full object-cover"
                enableIntersectionObserver={true}
              />
            </div>
          ))}
        </div>
      )}

      {/* 测试不使用 Intersection Observer 的情况 */}
      <div className="mt-16">
        <h2 className="text-2xl font-bold mb-4">不使用 Intersection Observer（立即加载）</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {testImages.slice(0, 5).map((image) => (
            <div key={`no-io-${image.id}`} className="aspect-square bg-gray-200 rounded-lg overflow-hidden">
              <ClientImage
                src={image.src}
                alt={image.alt}
                width={300}
                height={300}
                className="w-full h-full object-cover"
                enableIntersectionObserver={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}