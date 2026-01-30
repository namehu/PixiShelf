import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    qualities: [75, 85, 95, 100],
    // // 允许生成的图片宽度
    // imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // // 对应屏幕宽度的断点
    // deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    loader: 'custom',
    loaderFile: './lib/image-loader.js'
  },
  typescript: {
    ignoreBuildErrors: true // 忽略类型检查错误
  }
  /* config options here */
}

export default nextConfig
