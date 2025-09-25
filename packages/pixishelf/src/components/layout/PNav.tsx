import Link from 'next/link'
import { FC, PropsWithChildren } from 'react'

interface INavProps {
  renderRight?: () => React.ReactNode
  className?: string
}

const PNav: FC<PropsWithChildren<INavProps>> = ({ className, children, renderRight }) => {
  return (
    <nav className={`bg-white shadow-sm border-b ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center space-x-6">
            <Link href="/dashboard" className="text-xl font-bold text-graLink0">
              Pixishelf
            </Link>
            <div className="flex-1">{children}</div>
          </div>

          {renderRight && <div className="flex items-center">{renderRight?.()}</div>}
        </div>
      </div>
    </nav>
  )
}

export default PNav
