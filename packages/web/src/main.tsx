import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-brand-700">Artisan Shelf</h1>
          <nav className="text-sm text-gray-600">V1.0 初始化</nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-medium">欢迎</h2>
          <p className="text-gray-600">
            这是 Artisan Shelf 的前端初始化。后续将接入 API，展示本地图片收藏。
          </p>
        </section>
      </main>
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-500">
          © {new Date().getFullYear()} Artisan Shelf
        </div>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)