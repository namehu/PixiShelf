export interface CreatorReviewSummary {
  label: string
  before: string
  after: string | null
  basis: string
  note: string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

// Read the frozen check, including records created by earlier Workers. Never treat a
// website tag as the final local author when existing edits or name mappings apply.
export function creatorReviewSummary(command: string, value: unknown): CreatorReviewSummary {
  const payload = record(value)
  const description = typeof payload.description === 'string' ? payload.description : ''
  const names = strings(payload.creatorNames)
  const legacyCurrent = description.match(/^当前：(.*?)(?:；|$)/)?.[1]
  const before = names.length
    ? names.join('、')
    : legacyCurrent && legacyCurrent !== '未关联'
      ? legacyCurrent
      : '未填写'
  if (command === 'BACKFILL') {
    const refs = Array.isArray(payload.refs) ? payload.refs.map(record) : []
    const tags = refs.flatMap((ref) => (Array.isArray(ref.tags) ? ref.tags.map(record) : []))
    const websiteNames = [
      ...new Set(
        tags.flatMap((tag) =>
          typeof tag.name === 'string' && (tag.namespace === 'artist' || tag.namespace === 'group')
            ? [(tag.namespace === 'group' ? '社团：' : '') + tag.name]
            : []
        )
      )
    ]
    const known = refs.some((ref) => Array.isArray(ref.tags))
    const hasHistory = Array.isArray(payload.evidence) && payload.evidence.length > 0
    const hasRemapping = refs.some((ref) => Array.isArray(ref.remapped) && ref.remapped.length > 0)
    const simple = before === '未填写' && !hasHistory && !hasRemapping
    return {
      label: simple ? (tags.some((tag) => tag.namespace === 'group') ? '作者／社团' : '作者') : '当前作者／社团',
      before,
      after: simple && websiteNames.length ? websiteNames.join('、') : null,
      basis: websiteNames.length
        ? simple
          ? '原网站的作者标签'
          : '原网站标注：' + websiteNames.join('、')
        : known
          ? '原网站没有标注作者'
          : '没有找到原网站的作者信息',
      note: !known
        ? '这件作品不会自动修改，请打开作品手动填写作者。'
        : hasHistory || hasRemapping
          ? '这件作品已有作者调整记录，网站名称不一定是最终保存的作者。请打开作品核对。'
          : !websiteNames.length
            ? '没有可填写的作者。'
            : null
    }
  }
  if (command === 'REMAP') {
    return {
      label: '网站名称对应的作者',
      before: String(payload.sourceName ?? '未知名称'),
      after: String(payload.targetName ?? '未知作者'),
      basis: '你选择的作者',
      note: typeof payload.affected === 'number' ? `会更新 ${payload.affected} 条作者记录。` : null
    }
  }
  const prefix = command === 'ADD' ? '人工追加：' : command === 'REMOVE' ? '排除归属：' : '加入系列：'
  const target = description.slice(description.indexOf(prefix) + prefix.length)
  const found = description.includes(prefix)
  return {
    label: command === 'SERIES' ? '加入系列' : command === 'ADD' ? '添加作者／社团' : '移除作者／社团',
    before: command === 'SERIES' ? '' : before,
    after: found ? target : null,
    basis: command === 'SERIES' ? '你选择的系列' : '你选择的作者',
    note: found ? null : '这份旧记录没有保存修改详情，请重新检查。'
  }
}
