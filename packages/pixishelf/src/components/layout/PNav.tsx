import Link from 'next/link'
import { FC, PropsWithChildren } from 'react'
import UserMenu from './UserMenu'

interface INavProps {
  className?: string
}

const PNav: FC<PropsWithChildren<INavProps>> = ({ className, children }) => {
  return (
    <nav className={`bg-white shadow-sm border-b ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex-1 flex items-center space-x-6">
            <Link href="/dashboard" className="text-xl font-bold text-graLink0">
              <span className="sm:hidden">P</span>
              <span className="hidden sm:inline">Pixishelf</span>
            </Link>
            {children}
          </div>

          <div className="flex items-center">
            <UserMenu></UserMenu>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default PNav
