import type { ComponentProps, ElementType } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const pageContainerVariants = cva('mx-auto w-full px-4 sm:px-6 lg:px-8', {
  variants: {
    size: {
      gallery: 'max-w-gallery',
      standard: 'max-w-standard',
      reading: 'max-w-reading',
      workbench: 'max-w-workbench'
    }
  },
  defaultVariants: {
    size: 'standard'
  }
})

type PageContainerProps = ComponentProps<'div'> &
  VariantProps<typeof pageContainerVariants> & {
    as?: Extract<ElementType, 'div' | 'main' | 'section'>
  }

export function PageContainer({ as: Comp = 'div', size, className, ...props }: PageContainerProps) {
  return <Comp data-slot="page-container" className={cn(pageContainerVariants({ size }), className)} {...props} />
}

export { pageContainerVariants }
