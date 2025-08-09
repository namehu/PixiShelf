import React from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Gallery from './pages/Gallery'
import ArtworkDetail from './pages/ArtworkDetail'
import Settings from './pages/Settings'
import './styles.css'

const queryClient = new QueryClient()

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-semibold text-brand-700">Artisan Shelf</Link>
          <nav className="text-sm text-gray-600 flex items-center gap-4">
            <Link to="/" className="hover:text-gray-900">画廊</Link>
            <Link to="/settings" className="hover:text-gray-900">设置</Link>
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

const router = createBrowserRouter([
  { path: '/', element: <Layout><Gallery /></Layout> },
  { path: '/settings', element: <Layout><Settings /></Layout> },
  { path: '/artworks/:id', element: <Layout><ArtworkDetail /></Layout> },
])

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
)