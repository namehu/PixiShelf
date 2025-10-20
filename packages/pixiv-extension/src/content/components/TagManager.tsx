import React from 'react'
import { useTaskStore } from '../stores/taskStore'
import ContentPixivService from '../services/ContentPixivService'

export const TagManager: React.FC = () => {
  const { tagInput, setTagInput, addLog } = useTaskStore()

  const handleAddTags = async () => {
    if (!tagInput.trim()) return

    try {
      const tags = tagInput
        .split('\n')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)

      if (tags.length === 0) {
        addLog('请输入有效的标签')
        return
      }

      const result = await ContentPixivService.addTags(tags)
      if (!result.success) {
        throw new Error(result.error || '添加标签失败')
      }
      const { added = 0, total = 0 } = result.data ?? {}
      const dup = total - added
      addLog(`成功添加 ${added} 个标签` + (dup ? `(忽略重复${dup}个)` : ''))
      setTagInput('')
    } catch (error) {
      addLog(`添加标签失败: ${error}`)
    }
  }

  return (
    <div className="tag-manager">
      <div className="input-section" style={{ marginBottom: '16px' }}>
        <label
          htmlFor="tag-input"
          style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: '500',
            color: '#333'
          }}
        >
          添加标签 (每行一个):
        </label>
        <textarea
          id="tag-input"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="例如:&#10;Genshin Impact&#10;原神&#10;..."
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
