import React from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Link, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Gallery from './pages/Gallery'
import ArtworkDetail from './pages/ArtworkDetail'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Users from './pages/Users'
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
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  
  const logout = () => {
    auth.setToken(null)
    navigate('/login')
  }
  
  const isGalleryPage = location.pathname === '/'
  
  // 初始化搜索输入框的值
  React.useEffect(() => {
    if (isGalleryPage) {
      const currentSearch = sp.get('search') || ''
      setSearchInput(currentSearch)
      setDebouncedSearch(currentSearch)
    }
  }, [isGalleryPage, sp])
  
  // 防抖搜索
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 300) // 300ms 防抖延迟
    
    return () => clearTimeout(timer)
  }, [searchInput])
  
  // 当防抖搜索值改变时执行搜索
  React.useEffect(() => {
    if (isGalleryPage && debouncedSearch !== (sp.get('search') || '')) {
      performSearch(debouncedSearch)
    }
  }, [debouncedSearch, isGalleryPage])
  
  const performSearch = (query: string) => {
    const trimmed = query.trim()
    const newSp = new URLSearchParams(sp)
    
    if (trimmed) {
      newSp.set('search', trimmed)
    } else {
      newSp.delete('search')
    }
    newSp.set('page', '1') // 重置到第一页
    setSp(newSp)
  }
  
  const handleSearchInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // 立即搜索，不等待防抖
      performSearch(searchInput)
    } else if (e.key === 'Escape') {
      // ESC 键清空搜索
      setSearchInput('')
    }
  }
  
  const handleSearchSubmit = () => {
    performSearch(searchInput)
  }
  
  const handleClearSearch = () => {
    setSearchInput('')
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
                  <svg
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                     type="text"
                     placeholder="搜索作品标题、艺术家或描述..."
                     value={searchInput}
                     onChange={(e) => setSearchInput(e.target.value)}
                     onKeyDown={handleSearchInputKeyDown}
                     className="input pl-10 pr-20 w-full"
                   />
                   
                   {/* Search Actions */}
                   <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
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
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                       </svg>
                     </button>
                   </div>
                </div>
              </div>
            )}
            
            {/* Navigation */}
            <nav className="hidden md:flex items-center space-x-1">
              <Link to="/" className="btn-ghost px-3 py-2 rounded-lg text-sm font-medium">
                画廊
              </Link>
              <Link to="/settings" className="btn-ghost px-3 py-2 rounded-lg text-sm font-medium">
                设置
              </Link>
              <Link to="/users" className="btn-ghost px-3 py-2 rounded-lg text-sm font-medium">
                用户
              </Link>
              
              <div className="w-px h-4 bg-neutral-200 mx-2" />
              
              {auth.token ? (
                <button 
                  onClick={logout} 
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
            
            {/* Mobile menu button */}
            <button className="md:hidden btn-ghost p-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      
      {/* Main content */}
      <main className="flex-1 w-full">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {children}
        </div>
      </main>
      
      {/* Modern footer */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">P</span>
              </div>
              <span className="text-sm text-neutral-600">
                © {new Date().getFullYear()} PixiShelf - 现代化个人画廊
              </span>
            </div>
            <div className="flex items-center space-x-4 text-xs text-neutral-500">
              <span>Version 1.0</span>
              <span>•</span>
              <span>Made with ❤️</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const auth = React.useContext(AuthContext)!
  if (!auth.token) return <Navigate to="/login" replace />
  return children
}

const router = createBrowserRouter([
  { path: '/', element: <RequireAuth><Layout><Gallery /></Layout></RequireAuth> },
  { path: '/settings', element: <RequireAuth><Layout><Settings /></Layout></RequireAuth> },
  { path: '/users', element: <RequireAuth><Layout><Users /></Layout></RequireAuth> },
  { path: '/artworks/:id', element: <RequireAuth><Layout><ArtworkDetail /></Layout></RequireAuth> },
  { path: '/login', element: <Login /> },
])

function App() {
  const auth = useAuthToken()
  return (
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
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