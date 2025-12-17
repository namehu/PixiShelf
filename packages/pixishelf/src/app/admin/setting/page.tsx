import React, { Suspense } from 'react'
import AdminLayout from './_components/admin-layout'

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-neutral-600">加载中...</p>
          </div>
        </div>
      }
    >
      <AdminLayout />
    </Suspense>
  )
}
