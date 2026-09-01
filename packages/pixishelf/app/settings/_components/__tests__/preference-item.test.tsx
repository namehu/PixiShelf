import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PreferenceItem } from '../preference-item'

describe('PreferenceItem', () => {
  it('lets the control area fill its responsive grid column', () => {
    render(
      <PreferenceItem title="归档下载并发" description="限制单个归档作品同时拉取的媒体数量。">
        <div data-testid="preference-control">control</div>
      </PreferenceItem>
    )

    expect(screen.getByTestId('preference-control').parentElement?.className).toContain('w-full')
  })
})
