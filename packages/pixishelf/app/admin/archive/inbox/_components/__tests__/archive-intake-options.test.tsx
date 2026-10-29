import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import {
  ArchiveIntakeOptions,
  DEFAULT_ARCHIVE_INTAKE_OPTIONS,
  archiveIntakeOptionsSummary
} from '../archive-intake-options'
afterEach(cleanup)
it('chooses the first twenty independently of parsing mode and quality', () => {
  function Form() {
    const [value, setValue] = useState(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
    return (
      <>
        <ArchiveIntakeOptions value={value} onChange={setValue} />
        <output>{archiveIntakeOptionsSummary(value)}</output>
      </>
    )
  }
  render(<Form />)
  expect(screen.getByRole('status').textContent).toBe('自动下载 · 原图 · 全部')
  fireEvent.click(screen.getByRole('radio', { name: '前20张' }))
  fireEvent.click(screen.getByRole('radio', { name: '仅解析' }))
  fireEvent.click(screen.getByRole('radio', { name: '展示图' }))
  expect(screen.getByRole('status').textContent).toBe('仅解析 · 展示图 · 前20张')
})
