import type { NextConfig } from 'next'

const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https:;
    style-src 'self' 'unsafe-inline' https:;
    img-src 'self' blob: data: http: https:;
    media-src 'self' blob: data: http: https:;
    font-src 'self' data:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    block-all-mixed-content;
`

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
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader.replace(/\n/g, ''),
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
}

export default nextConfig
