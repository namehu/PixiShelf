import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserRouter,
  RouterProvider,
  Link,
  Navigate,
  useNavigate,
  useLocation,
  useSearchParams
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiJson } from './api'
import { SuggestionsResponse } from '@pixishelf/shared'
import Gallery from './pages/Gallery'
import ArtworkDetail from './pages/ArtworkDetail'
import ArtistsPage from './pages/ArtistsPage'
import Login from './pages/Login'
import AdminPage from './pages/admin'
import ConfirmDialog from './components/ui/confirm-dialog'
import { NotificationProvider } from './components/ui/notification'
import { ToastProvider } from './components/ui/toast'
import './styles.css'

const queryClient = new QueryClient()

function useAuthToken() {
  const [token, setToken] = React.useState<string | null>(() => localStorage.getItem('token'))
  const save = (t: string | null) => {
    if (t) localStorage.setItem('token', t)
    else localStorage.removeItem('token')
    setToken(t)
  }
  return { token, setToken: save }
}

const AuthContext = React.createContext<{ token: string | null; setToken: (t: string | null) => void } | null>(null)

function Layout({ children }: { children: React.ReactNode }) {
  const auth = React.useContext(AuthContext)!
  const navigate = useNavigate()
  const location = useLocation()
  const [sp, setSp] = useSearchParams()
  const [searchInput, setSearchInput] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = React.useState(-1)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = React.useState(false)
  const [searchMode, setSearchMode] = React.useState<'normal' | 'tag'>('normal')
  const suggestionsCache = React.useRef<Map<string, any[]>>(new Map())
  const abortControllerRef = React.useRef<AbortController | null>(null)

  // 退出确认弹窗状态
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
      // 可以在这里添加退出前的清理逻辑
      auth.setToken(null)
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

  const isGalleryPage = location.pathname === '/'

  // 初始化搜索输入框的值和搜索模式
  React.useEffect(() => {
    if (isGalleryPage) {
      const currentSearch = sp.get('search') || ''
      const currentTags = sp.get('tags') || ''

      if (currentTags) {
        setSearchInput(currentTags)
        setSearchMode('tag')
      } else if (currentSearch) {
        setSearchInput(currentSearch)
        setSearchMode('normal')
      } else {
        setSearchInput('')
      }
    }
  }, [isGalleryPage, sp])

  // 防抖获取搜索建议
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim().length >= 2) {
        fetchSuggestions(searchInput.trim())
      } else {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 200) // 200ms 防抖延迟

    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchSuggestions = async (query: string) => {
    if (!isGalleryPage) return

    // 检查缓存（包含搜索模式）
    const cacheKey = `${searchMode}:${query.toLowerCase()}`
    if (suggestionsCache.current.has(cacheKey)) {
      const cachedSuggestions = suggestionsCache.current.get(cacheKey)!
      setSuggestions(cachedSuggestions)
      setShowSuggestions(true)
      setSelectedSuggestionIndex(-1)
      return
    }

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController()

    setIsLoadingSuggestions(true)
    try {
      const data = await apiJson<SuggestionsResponse>(
        `/api/v1/suggestions?q=${encodeURIComponent(query)}&limit=8&mode=${searchMode}`,
        {
          signal: abortControllerRef.current.signal
        }
      )
      const suggestions = data.suggestions || []

      // 缓存结果（限制缓存大小）
      if (suggestionsCache.current.size >= 50) {
        // 清除最旧的缓存项
        const firstKey = suggestionsCache.current.keys().next().value
        suggestionsCache.current.delete(firstKey)
      }
      suggestionsCache.current.set(cacheKey, suggestions)

      setSuggestions(suggestions)
      setShowSuggestions(true)
      setSelectedSuggestionIndex(-1)
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 请求被取消，不需要处理
        return
      }
      console.error('Failed to fetch suggestions:', error)
      setSuggestions([])
      setShowSuggestions(false)
    } finally {
      setIsLoadingSuggestions(false)
      abortControllerRef.current = null
    }
  }

  const performSearch = (query: string) => {
    const trimmed = query.trim()
    const newSp = new URLSearchParams(sp)

    if (trimmed) {
      if (searchMode === 'tag') {
        // 标签搜索模式：使用tags参数
        newSp.set('tags', trimmed)
        newSp.delete('search') // 清除普通搜索参数
      } else {
        // 普通搜索模式：使用search参数
        newSp.set('search', trimmed)
        newSp.delete('tags') // 清除标签搜索参数
      }
    } else {
      newSp.delete('search')
      newSp.delete('tags')
    }
    newSp.set('page', '1') // 重置到第一页
    setSp(newSp)
    setShowSuggestions(false)
  }

  const handleSearchInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
        // 选择建议项
        const suggestion = suggestions[selectedSuggestionIndex]
        setSearchInput(suggestion.value)
        performSearch(suggestion.value)
      } else {
        // 直接搜索输入的内容
        performSearch(searchInput)
      }
    } else if (e.key === 'Escape') {
      // ESC 键关闭建议或清空搜索
      if (showSuggestions) {
        setShowSuggestions(false)
        setSelectedSuggestionIndex(-1)
      } else {
        setSearchInput('')
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0) {
        setSelectedSuggestionIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0) {
        setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
      }
    }
  }

  const handleSearchSubmit = () => {
    performSearch(searchInput)
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setShowSuggestions(false)
    setSuggestions([])
    // 清除URL参数
    const newSp = new URLSearchParams(sp)
    newSp.delete('search')
    newSp.delete('tags')
    newSp.set('page', '1')
    setSp(newSp)
    // 取消正在进行的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const handleSuggestionClick = (suggestion: any) => {
    setSearchInput(suggestion.value)
    performSearch(suggestion.value)
  }

  const handleSearchInputFocus = () => {
    if (suggestions.length > 0) {
      setShowSuggestions(true)
    }
  }

  const handleSearchInputBlur = () => {
    // 延迟关闭建议，允许点击建议项
    setTimeout(() => {
      setShowSuggestions(false)
      setSelectedSuggestionIndex(-1)
    }, 200)
  }
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      {/* Modern header with glassmorphism effect */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-neutral-200/50">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2 group">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <span className="text-xl font-semibold text-neutral-900 group-hover:text-primary-600 transition-colors">
                PixiShelf
              </span>
            </Link>

            {/* Search Bar - Only show on gallery page */}
            {isGalleryPage && (
              <div className="hidden md:flex flex-1 max-w-md mx-8">
                <div className="relative w-full">
                  <input
                    type="text"
                    placeholder={searchMode === 'tag' ? '搜索标签...' : '搜索作品标题、艺术家或描述...'}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={handleSearchInputKeyDown}
                    onFocus={handleSearchInputFocus}
                    onBlur={handleSearchInputBlur}
                    className={`input pr-32 w-full ${showSuggestions ? 'rounded-b-none border-b-0' : ''}`}
                    autoComplete="off"
                  />

                  {/* Search Mode Toggle */}
                  <div className="absolute right-20 top-1/2 transform -translate-y-1/2 z-10">
                    <button
                      onClick={() => {
                        const newMode = searchMode === 'normal' ? 'tag' : 'normal'
                        setSearchMode(newMode)
                        // 清空建议缓存和当前建议
                        suggestionsCache.current.clear()
                        setSuggestions([])
                        setShowSuggestions(false)
                      }}
                      className={`p-1.5 rounded transition-colors ${
                        searchMode === 'tag'
                          ? 'bg-accent-100 text-accent-700 hover:bg-accent-200'
                          : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'
                      }`}
                      title={searchMode === 'tag' ? '切换到普通搜索' : '切换到标签搜索'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                        />
                      </svg>
                    </button>
                  </div>

                  {/* Search Actions */}
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1 z-10">
                    {/* Loading Indicator */}
                    {isLoadingSuggestions && (
                      <div className="p-1">
                        <div className="w-3 h-3 border border-primary-600 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}

                    {/* Clear Button */}
                    {searchInput && (
                      <button
                        onClick={handleClearSearch}
                        className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
                        title="清空搜索"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}

                    {/* Search Button */}
                    <button
                      onClick={handleSearchSubmit}
                      className="p-1.5 text-primary-600 hover:text-primary-700 transition-colors"
                      title="搜索 (Enter)"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </button>
                  </div>

                  {/* Suggestions Dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-neutral-200 border-t-0 rounded-b-xl shadow-lg max-h-80 overflow-y-auto z-50">
                      {suggestions.map((suggestion, index) => (
                        <div
                          key={`${suggestion.type}-${suggestion.value}-${index}`}
                          className={`px-4 py-3 cursor-pointer transition-colors border-b border-neutral-100 last:border-b-0 ${
                            index === selectedSuggestionIndex ? 'bg-primary-50 text-primary-700' : 'hover:bg-neutral-50'
                          }`}
                          onClick={() => handleSuggestionClick(suggestion)}
                        >
                          <div className="flex items-center gap-3">
                            {/* Type Icon */}
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                                suggestion.type === 'artist'
                                  ? 'bg-accent-100 text-accent-700'
                                  : suggestion.type === 'tag'
                                    ? 'bg-secondary-100 text-secondary-700'
                                    : 'bg-primary-100 text-primary-700'
                              }`}
                            >
                              {suggestion.type === 'artist' ? '👤' : suggestion.type === 'tag' ? '🏷️' : '🎨'}
                            </div>

                            {/* Suggestion Content */}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-neutral-900 truncate">{suggestion.label}</div>
                              {suggestion.metadata && (
                                <div className="text-xs text-neutral-500 mt-0.5">
                                  {suggestion.type === 'artwork' && suggestion.metadata.artistName && (
                                    <span>by {suggestion.metadata.artistName}</span>
                                  )}
                                  {suggestion.type === 'tag' && suggestion.metadata.artworkCount && (
                                    <span>{suggestion.metadata.artworkCount} 个作品</span>
                                  )}
                                  {suggestion.metadata.imageCount && (
                                    <span className="ml-2">{suggestion.metadata.imageCount} 张图片</span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Type Label */}
                            <div className="text-xs text-neutral-400 uppercase tracking-wide">
                              {suggestion.type === 'artist' ? '艺术家' : '作品'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Navigation */}
            <nav className="hidden md:flex items-center space-x-1">
              <Link
                to="/artists"
                className="btn-ghost p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
                title="艺术家"
              >
                <svg className="w-5 h-5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </Link>

              <Link
                to="/admin"
                className="btn-ghost p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
                title="管理中心"
              >
                <svg className="w-5 h-5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              <div className="w-px h-4 bg-neutral-200 mx-2" />

              {auth.token ? (
                <button
                  onClick={handleLogoutClick}
                  className="btn-ghost px-3 py-2 rounded-lg text-sm font-medium text-neutral-600 hover:text-error-600"
                >
                  退出
                </button>
              ) : (
                <Link to="/login" className="btn-primary">
                  登录
                </Link>
              )}
            </nav>

            {/* Mobile navigation */}
            <div className="md:hidden flex items-center gap-2">
              <Link
                to="/artists"
                className="btn-ghost p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
                title="艺术家"
              >
                <svg className="w-5 h-5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </Link>

              <Link
                to="/admin"
                className="btn-ghost p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
                title="管理中心"
              >
                <svg className="w-5 h-5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              {auth.token && (
                <button
                  onClick={handleLogoutClick}
                  className="btn-ghost p-2 rounded-lg text-neutral-600 hover:text-error-600"
                  title="退出登录"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 w-full">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>

      {/* Modern footer */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">P</span>
              </div>
              <span className="text-sm text-neutral-600">© {new Date().getFullYear()} PixiShelf - 现代化个人画廊</span>
            </div>
            <div className="flex items-center space-x-4 text-xs text-neutral-500">
              <span>Version 1.0</span>
              <span>•</span>
              <span>Made with ❤️</span>
            </div>
          </div>
        </div>
      </footer>

      {/* 退出确认弹窗 */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={cancelLogout}
        onConfirm={confirmLogout}
        title="确认退出"
        message="确定要退出登录吗？退出后需要重新登录才能访问系统。"
        confirmText="确定退出"
        cancelText="取消"
        confirmVariant="danger"
        isLoading={isLoggingOut}
      />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const auth = React.useContext(AuthContext)!
  if (!auth.token) return <Navigate to="/login" replace />
  return children
}

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <RequireAuth>
        <Layout>
          <Gallery />
        </Layout>
      </RequireAuth>
    )
  },
  {
    path: '/artists',
    element: (
      <RequireAuth>
        <Layout>
          <ArtistsPage />
        </Layout>
      </RequireAuth>
    )
  },
  {
    path: '/admin',
    element: (
      <RequireAuth>
        <Layout>
          <AdminPage />
        </Layout>
      </RequireAuth>
    )
  },
  {
    path: '/artworks/:id',
    element: (
      <RequireAuth>
        <ArtworkDetail />
      </RequireAuth>
    )
  },
  { path: '/login', element: <Login /> }
])

function App() {
  const auth = useAuthToken()
  return (
    <AuthContext.Provider value={auth}>
      <NotificationProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </NotificationProvider>
    </AuthContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
