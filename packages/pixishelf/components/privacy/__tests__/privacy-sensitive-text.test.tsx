import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrivacySensitiveText } from '../privacy-sensitive-text'

describe('PrivacySensitiveText', () => {
  it('marks the real text for the global privacy presentation without hiding it from assistive technology', () => {
    render(<PrivacySensitiveText aria-label="作品标题：秘密花园">秘密花园</PrivacySensitiveText>)

    const text = screen.getByLabelText('作品标题：秘密花园')
    expect(text.getAttribute('data-privacy-sensitive')).toBe('')
    expect(text.textContent).toBe('秘密花园')
    expect(text.getAttribute('aria-hidden')).toBeNull()
  })

  it('supports a block wrapper for rich read-only content', () => {
    render(
      <PrivacySensitiveText as="div" data-testid="description">
        <p>敏感描述</p>
      </PrivacySensitiveText>
    )

    expect(screen.getByTestId('description').tagName).toBe('DIV')
    expect(screen.getByTestId('description').getAttribute('data-privacy-sensitive')).toBe('')
  })

  it('keeps a marked link interactive', () => {
    const onClick = vi.fn()
    render(
      <PrivacySensitiveText as="a" href="/artists/1" onClick={onClick}>
        敏感艺术家
      </PrivacySensitiveText>
    )

    fireEvent.click(screen.getByRole('link', { name: '敏感艺术家' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
