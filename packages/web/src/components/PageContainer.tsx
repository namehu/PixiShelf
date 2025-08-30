import React from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface PageContainerProps {
  children: React.ReactNode
  centerContent?: React.ReactNode
}

export function PageContainer({ children, centerContent }: PageContainerProps) {
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false)
  const [isLoggingOut, setIsLoggingOut] = React.useState(false)

  // 显示退出确认弹窗
  const handleLogoutClick = () => {
    setShowLogoutConfirm(true)
  }

  // 确认退出
  const confirmLogout = async () => {
    setIsLoggingOut(true)
    try {
      // 清除token
      localStorage.removeItem('token')
      navigate('/login')
    } finally {
      setIsLoggingOut(false)
      setShowLogoutConfirm(false)
    }
  }

  // 取消退出
  const cancelLogout = () => {
    setShowLogoutConfirm(false)
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      {/* Modern header with glassmorphism effect - 优化移动端固定定位 */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-b border-neutral-200/50 supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            {/* Logo - 移动端优化 */}
            <Link to="/" className="flex items-center space-x-2 group flex-shrink-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white font-bold text-xs sm:text-sm">P</span>
              </div>
              <span className="text-lg sm:text-xl font-semibold text-neutral-900 group-hover:text-primary-600 transition-colors hidden xs:inline">
                PixiShelf
              </span>
            </Link>

            {/* Center Content - 自定义中间区域，移动端优化 */}
            <div className="flex-1 flex justify-center min-w-0 px-2">
              <div className="max-w-full overflow-hidden">{centerContent}</div>
            </div>

            {/* Navigation - 右侧设置和退出，移动端优化 */}
            <nav className="flex items-center space-x-1 flex-shrink-0">
              <Link
                to="/admin"
                className="btn-ghost p-1.5 sm:p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
                title="管理中心"
              >
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </Link>

              <div className="w-px h-3 sm:h-4 bg-neutral-200 mx-1 sm:mx-2" />

              <button
                onClick={handleLogoutClick}
                className="btn-ghost px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium text-neutral-600 hover:text-error-600"
              >
                <span className="hidden sm:inline">退出</span>
                <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content - 添加顶部间距以避免被固定导航头遮挡 */}
      <main className="flex-1 pt-[53px]">{children}</main>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">确认退出</h3>
            <p className="text-neutral-600 mb-6">您确定要退出登录吗？</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelLogout}
                className="btn-ghost px-4 py-2 rounded-lg text-sm font-medium"
                disabled={isLoggingOut}
              >
                取消
              </button>
              <button
                onClick={confirmLogout}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-medium bg-error-600 hover:bg-error-700"
                disabled={isLoggingOut}
              >
                {isLoggingOut ? '退出中...' : '确认退出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
