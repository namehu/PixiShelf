import Link from 'next/link'
import { FC, PropsWithChildren, ReactNode } from 'react'
import UserMenu from './UserMenu'
import { Pyramid } from 'lucide-react'

interface INavProps {
  className?: string
  /**
   * 扩展左侧内容：位于 Logo 和 children 之间
   * 可以用来放置：返回按钮、面包屑、或者特定页面的标题
   */
  renderLeft?: ReactNode
  /**
   * 扩展右侧内容：位于 UserMenu 左侧
   * 可以用来放置：新建按钮、通知图标、搜索框等
   */
  renderExtra?: ReactNode
}

const PNav: FC<PropsWithChildren<INavProps>> = ({ className, children, renderLeft, renderExtra }) => {
  return (
    <div className={`w-full ${className}`}>
      {/* 这是一个占位符，用来防止 Fixed 导航栏遮挡内容，高度 py-8 (2rem * 2 = 64px) 对应 h-16 */}
      <div className="h-16" />

      <nav className={`fixed w-full top-0 left-0 z-50 backdrop-blur-xl border-b border-slate-200/50 bg-white/80`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* --- 左侧区域 --- */}
            <div className="flex-1 flex items-center space-x-6">
              {/* 1. Logo 始终在最左侧 */}
              <Link href="/dashboard" className="text-xl font-bold text-gray-900 flex-shrink-0">
                <div className="sm:hidden w-8 h-8 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/10">
                  <Pyramid className="w-5 h-5 text-white" />
                </div>
                <span className="hidden sm:inline">Pixishelf</span>
              </Link>

              {/* 2. renderLeft 插槽：这里渲染你传入的左侧扩展内容 */}
              {renderLeft && <div className="flex items-center">{renderLeft}</div>}

              {/* 3. children：原本的导航链接 */}
              <div className="text-xl font-bold text-gray-900">{children}</div>
            </div>

            {/* --- 右侧区域 --- */}
            <div className="flex items-center space-x-4">
              {/* 4. renderExtra 插槽：在用户菜单之前渲染 */}
              {renderExtra && <div className="flex items-center">{renderExtra}</div>}
              {/* 5. 用户菜单 */}
              <UserMenu />
            </div>
          </div>
        </div>
      </nav>
    </div>
  )
}

export default PNav
