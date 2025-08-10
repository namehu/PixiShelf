import React from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Link, Navigate, useNavigate } from 'react-router-dom'
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
  const logout = () => {
    auth.setToken(null)
    navigate('/login')
  }
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-semibold text-brand-700">Artisan Shelf</Link>
          <nav className="text-sm text-gray-600 flex items-center gap-4">
            <Link to="/" className="hover:text-gray-900">画廊</Link>
            <Link to="/settings" className="hover:text-gray-900">设置</Link>
            <Link to="/users" className="hover:text-gray-900">用户</Link>
            {auth.token ? (
              <button onClick={logout} className="text-gray-600 hover:text-gray-900">退出</button>
            ) : (
              <Link to="/login" className="hover:text-gray-900">登录</Link>
            )}
            <span className="text-gray-400">V1.0</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 flex-1 w-full">{children}</main>
      <footer className="border-t bg-white mt-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-500">© {new Date().getFullYear()} Artisan Shelf</div>
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