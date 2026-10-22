import { RE2JS } from 're2js'

// Share the same bounded, non-backtracking engine in the browser and Worker.
const compiled = new Map<string, RE2JS>()
const CACHE_LIMIT = 128

export function compileArchiveTitleRegex(pattern: string, ignoreCase = true): RE2JS {
  if (!pattern.length || pattern.length > 160) throw new Error('正则表达式需为 1–160 个字符')
  const key = JSON.stringify([pattern, ignoreCase])
  const cached = compiled.get(key)
  if (cached) return cached
  // Inline flags would silently override the visible case checkbox. Respect
  // RE2 quoting and classes; punctuation inside them is literal, not syntax.
  let inClass = false
  let classPosition = 0
  let quoted = false
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]
    if (quoted) {
      if (pattern.slice(index, index + 2) === '\\E') {
        quoted = false
        index++
      }
      continue
    }
    if (character === '\\') {
      if (pattern[index + 1] === 'Q') quoted = true
      if (inClass) classPosition = 2
      index++
      continue
    }
    if (inClass) {
      if (character === '[' && pattern[index + 1] === ':') {
        const end = pattern.indexOf(':]', index + 2)
        if (end !== -1) index = end + 1
      } else if (character === ']' && classPosition === 2) inClass = false
      if (classPosition === 0 && character === '^') classPosition = 1
      else classPosition = 2
      continue
    }
    if (character === '[') {
      inClass = true
      classPosition = 0
    } else if (pattern.slice(index, index + 2) === '(?' && /[imsU-]/.test(pattern[index + 2] ?? '')) {
      throw new Error('不支持内联标志；大小写请使用“忽略大小写”勾选项')
    }
  }
  let regex: RE2JS
  try {
    regex = RE2JS.compile(pattern, ignoreCase ? RE2JS.CASE_INSENSITIVE : 0)
  } catch {
    throw new Error('正则表达式无效或使用了不支持的语法（如环视、反向引用）')
  }
  if (regex.programSize() > 4096) throw new Error('正则表达式过于复杂，请减少重复次数或分支')
  if (compiled.size >= CACHE_LIMIT) compiled.delete(compiled.keys().next().value!)
  compiled.set(key, regex)
  return regex
}
