import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 85, 95, 100],
    loader: 'custom',
    loaderFile: './lib/image-loader.js'
  },
  eslint: {
    // 在构建时忽略ESLint错误
    ignoreDuringBuilds: true
  },
  typescript: {
    // 忽略类型检查错误
    ignoreBuildErrors: true
  }
  /* config options here */
}

export default nextConfig
