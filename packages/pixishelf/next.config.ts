import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    qualities: [75, 85, 95, 100],
    loader: 'custom',
    loaderFile: './lib/image-loader.js'
  },
  typescript: {
    ignoreBuildErrors: true // 忽略类型检查错误
  }
  /* config options here */
}

export default nextConfig
