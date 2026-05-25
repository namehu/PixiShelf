import Link from 'next/link'
import { FC, PropsWithChildren, ReactNode } from 'react'
import UserMenu from './UserMenu'
import PLogo from './p-logo'
import { cn } from '@/lib/utils'

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

  showUserMenu?: boolean

  showLogo?: boolean

  border?: boolean

  placeholder?: boolean
}

const PNav: FC<PropsWithChildren<INavProps>> = (props) => {
  const {
    className,
    children,
    renderLeft,
    renderExtra,
    showUserMenu = true,
    showLogo = true,
    border = true,
    placeholder = true
  } = props
  return (
    <div className={cn('w-full')}>
      {/* 这是一个占位符，用来防止 Fixed 导航栏遮挡内容，高度 py-8 (2rem * 2 = 64px) 对应 h-16 */}
      {placeholder && <div className="h-16" />}
      <nav
        className={cn(
          'fixed w-full top-0 left-0 z-50 backdrop-blur-xl bg-white/80',
          border && 'border-b border-slate-200/50',
          className
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* --- 左侧区域 --- */}
            <div className="flex-1 flex items-center space-x-6">
              {/* 1. Logo 始终在最左侧 */}
              {showLogo && (
                <Link href="/dashboard" className="text-xl font-bold text-gray-900 flex-shrink-0">
                  <div className="sm:hidden w-8 h-8 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/10">
                    <PLogo className="text-white" size="small" />
                  </div>
                  <span className="hidden sm:inline">Pixishelf</span>
                </Link>
              )}

              {/* 2. renderLeft 插槽：这里渲染你传入的左侧扩展内容 */}
              {renderLeft && <div className="flex items-center">{renderLeft}</div>}

              {/* 3. children：原本的导航链接 */}
              <div
                className={cn(
                  'flex items-center',
                  typeof children === 'string' ? 'text-xl font-bold text-gray-900' : 'flex-1 w-full'
                )}
              >
                {children}
              </div>
            </div>

            {/* --- 右侧区域 --- */}
            {(!!renderExtra || showUserMenu) && (
              <div className="flex items-center space-x-4 pl-4">
                {/* 4. renderExtra 插槽：在用户菜单之前渲染 */}
                {renderExtra && <div className="flex items-center">{renderExtra}</div>}
                {/* 5. 用户菜单 */}
                {showUserMenu && <UserMenu />}
              </div>
            )}
          </div>
        </div>
      </nav>
    </div>
  )
}

export default PNav
