import React from 'react'
import App from '../App'
import { ToggleButton } from './ToggleButton'

export const AppContainer: React.FC = () => {
  return (
    <div
      id="pixiv-extension-root"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0 // Lower z-index to allow portals (z-50) to appear on top
      }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <ToggleButton />
        <App />
      </div>
    </div>
  )
}
