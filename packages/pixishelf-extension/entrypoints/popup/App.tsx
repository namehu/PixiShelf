import { useState, useEffect } from 'react'
import './App.css'

export default function App() {
  const [isPixivPage, setIsPixivPage] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')

  useEffect(() => {
    // 检查当前活动标签页是否为Pixiv页面
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (tab?.url) {
        setCurrentUrl(tab.url)
        setIsPixivPage(tab.url.includes('pixiv.net'))
      }
    })
  }, [])

  const openPixiv = () => {
    chrome.tabs.update({
      url: 'https://www.pixiv.net/support' // 'https://www.pixiv.net'
    })
  }

  return (
    <div className="popup-container">
      <div className="header">
        <h2>PixiShelf Extension</h2>
        <p className="subtitle">Pixiv标签翻译工具</p>
      </div>

      <div className="content">
        {isPixivPage ? (
          <div className="pixiv-detected">
            <div className="status-indicator success">
              <span className="icon">✓</span>
              <span>已检测到Pixiv页面</span>
            </div>
            <p className="info">浮动面板已在页面中激活，您可以直接在Pixiv页面上使用标签翻译功能。</p>
          </div>
        ) : (
          <div className="pixiv-not-detected">
            <div className="status-indicator warning">
              <span className="icon">⚠</span>
              <span>未检测到Pixiv页面</span>
            </div>
            <p className="info">请先访问Pixiv网站以使用标签翻译功能。</p>
            <div className="current-page">
              <small>当前页面: {currentUrl || '未知'}</small>
            </div>
            <div className="actions">
              <button onClick={openPixiv} className="primary-button">
                打开Pixiv
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="footer">
        <p className="version">v1.0.0</p>
      </div>
    </div>
  )
}
