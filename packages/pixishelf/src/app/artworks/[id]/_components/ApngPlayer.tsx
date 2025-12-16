// oxlint-disable no-console
import { combinationApiResource } from '@/utils/combinationStatic'
import parseAPNG from 'apng-js'
import { Loader2, Pause, Play } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'

// -----------------------------------------------------------------------------
// 子组件：APNG 播放器
// -----------------------------------------------------------------------------
interface ApngPlayerProps {
  src: string
  alt: string
  className?: string
}

const ApngPlayer = ({ src, alt, className }: ApngPlayerProps) => {
  const [player, setPlayer] = useState<any>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const apiUrl = useMemo(() => combinationApiResource(src), [src])

  // 组件卸载时销毁播放器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (player) {
        player.stop()
      }
    }
  }, [player])

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()

    // 1. 如果处于空闲状态，开始加载并初始化
    if (status === 'idle') {
      try {
        setStatus('loading')

        // 获取二进制数据
        const response = await fetch(apiUrl)
        const buffer = await response.arrayBuffer()

        // 解析 APNG
        const apng = await parseAPNG(buffer)

        if (apng instanceof Error) {
          console.error('APNG parsing failed', apng)
          setStatus('idle') // 回退
          return
        }

        // 设置 Canvas 尺寸
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = apng.width
          canvas.height = apng.height

          // 创建播放器
          const ctx = canvas.getContext('2d')
          const newPlayer = await apng.getPlayer(ctx!)

          setPlayer(newPlayer)
          newPlayer.play()
          setStatus('playing')
        }
      } catch (error) {
        console.error('Failed to load APNG:', error)
        setStatus('idle')
      }
      return
    }

    // 2. 如果已经加载，控制播放/暂停
    if (player) {
      if (status === 'playing') {
        player.pause()
        setStatus('paused')
      } else {
        player.play()
        setStatus('playing')
      }
    }
  }

  // 遮罩层样式逻辑
  const isReady = status === 'playing' || status === 'paused'

  return (
    <div className={`relative cursor-pointer group ${className}`} onClick={handleToggle}>
      {/* 1. 封面图 (Next/Image)
        - 当状态是 idle (未加载) 或 loading 时显示
        - 当 canvas 准备好后隐藏 (或者你可以选择保留在底部作为背景)
      */}
      {!isReady && (
        <Image
          src={src}
          alt={alt}
          priority
          width={0}
          height={0}
          sizes="100vw"
          className={`w-full h-auto object-contain transition-opacity duration-300 ${status === 'loading' ? 'opacity-50' : 'opacity-100'}`}
        />
      )}

      {/* 2. Canvas (实际播放层)- 仅在初始化成功后显示      */}
      <canvas ref={canvasRef} className={`w-full h-auto object-contain ${isReady ? 'block' : 'hidden'}`} />

      {/* 3. 控制按钮遮罩
        - Idle/Paused: 显示黑色半透明背景
        - Loading: 显示加载中
        - Playing: 默认隐藏，Hover 时显示
      */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-all duration-300
        ${status === 'playing' ? 'opacity-0 group-hover:opacity-100 bg-black/10' : 'bg-black/20 opacity-100'}`}
      >
        <div className="bg-black/50  text-white rounded-full p-4 backdrop-blur-sm transition-transform transform hover:scale-110 shadow-lg">
          {status === 'loading' && <Loader2 className="w-8 h-8 animate-spin" />}
          {status === 'idle' && <Play className="w-8 h-8 ml-1" />} {/* ml-1 视觉修正 */}
          {status === 'paused' && <Play className="w-8 h-8 ml-1" />}
          {status === 'playing' && <Pause className="w-8 h-8" />}
        </div>
      </div>
    </div>
  )
}

export default ApngPlayer
