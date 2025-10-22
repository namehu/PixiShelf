import React from 'react'
import { useTaskStore } from '../stores/taskStore'

export const TagManager: React.FC = () => {
  const { tagInput, setTagInput, addLog, addTags } = useTaskStore()

  const handleAddTags = () => {
    if (!tagInput.trim()) return

    const result = addTags(tagInput)
    if (result.added === 0 && result.duplicates === 0) {
      addLog('请输入有效的标签')
      return
    }

    addLog(`成功添加 ${result.added} 个标签` + (result.duplicates ? `(忽略重复${result.duplicates}个)` : ''))
    setTagInput('')
  }

  return (
    <div className="tag-manager">
      <div className="input-section" style={{ marginBottom: '16px' }}>
        <textarea
          id="tag-input"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="添加标签(每行一个),例如:&#10;Genshin Impact&#10;原神&#10;..."
          rows={4}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '14px',
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: '80px'
          }}
        />

        <button
          onClick={handleAddTags}
          disabled={!tagInput.trim()}
          style={{
            marginTop: '8px',
            padding: '8px 16px',
            backgroundColor: tagInput.trim() ? '#0066cc' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: tagInput.trim() ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          添加标签
        </button>
      </div>
    </div>
  )
}
