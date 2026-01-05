import { redirect } from 'next/navigation'

/**
 * 根页面组件
 */
export default function RootPage() {
  redirect('/dashboard')
}
