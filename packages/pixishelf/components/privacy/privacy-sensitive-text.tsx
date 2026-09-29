import * as React from 'react'

type PrivacySensitiveTextProps<TElement extends React.ElementType = 'span'> = {
  as?: TElement
} & Omit<React.ComponentPropsWithoutRef<TElement>, 'as' | 'title'>

/**
 * Marks read-only domain text that should be visually obscured while privacy mode is enabled.
 *
 * The real text remains in the accessibility tree and in application state. Do not use this
 * wrapper for inputs or other user-editable controls.
 */
export function PrivacySensitiveText<TElement extends React.ElementType = 'span'>({
  as,
  ...props
}: PrivacySensitiveTextProps<TElement>) {
  const Component = (as ?? 'span') as React.ElementType

  return React.createElement(Component, { ...props, 'data-privacy-sensitive': '' })
}
