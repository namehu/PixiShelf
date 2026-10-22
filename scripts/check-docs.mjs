import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8'
})
  .split('\0')
  .filter((file) => file.endsWith('.md') && !/^\.(agents|codex|trae)\//.test(file))
  .filter((file) => existsSync(path.join(root, file)))
const errors = []
const documents = new Map()

function document(file) {
  if (documents.has(file)) return documents.get(file)
  const lines = readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').split('\n')
  const visible = []
  let fence
  let frontmatter = lines[0] === '---'
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (frontmatter) {
      if (index > 0 && line === '---') frontmatter = false
      visible.push('')
      continue
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!fence && marker) {
      fence = { character: marker[1][0], length: marker[1].length, line: index + 1 }
      visible.push('')
    } else if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined
      }
      visible.push('')
    } else {
      visible.push(line)
    }
  }
  if (fence) errors.push(`${file}:${fence.line}: unclosed code fence`)
  if (frontmatter) errors.push(`${file}:1: unclosed frontmatter`)
  const anchors = new Set()
  const counts = new Map()
  for (const line of visible) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line)
    if (heading) {
      const slug = heading[1]
        .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, '')
        .replace(/ /g, '-')
      let anchor = slug
      let suffix = counts.get(slug) || 0
      while (anchors.has(anchor)) anchor = `${slug}-${++suffix}`
      counts.set(slug, suffix)
      anchors.add(anchor)
    }
    for (const match of line.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/g)) {
      anchors.add(match[1])
    }
  }
  const result = { visible, anchors }
  documents.set(file, result)
  return result
}

// Check each segment explicitly: Windows otherwise accepts links that break on Linux.
function exactPath(relative) {
  let parent = root
  for (const segment of relative.split('/').filter(Boolean)) {
    if (!existsSync(parent) || !statSync(parent).isDirectory()) return false
    if (!readdirSync(parent).includes(segment)) return false
    parent = path.join(parent, segment)
  }
  return true
}

function checkLink(file, line, destination) {
  const target = destination.replace(/^<|>$/g, '')
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return
  const [pathname, fragment] = target.split('#', 2)
  let relative
  try {
    relative = path.posix.normalize(
      pathname.startsWith('/')
        ? decodeURIComponent(pathname.slice(1))
        : path.posix.join(path.posix.dirname(file), decodeURIComponent(pathname || path.posix.basename(file)))
    )
  } catch {
    errors.push(`${file}:${line}: invalid URL encoding: ${target}`)
    return
  }
  if (relative === '..' || relative.startsWith('../') || !exactPath(relative)) {
    errors.push(`${file}:${line}: missing path or incorrect case: ${target}`)
    return
  }
  if (fragment && relative.endsWith('.md')) {
    let anchor
    try {
      anchor = decodeURIComponent(fragment)
    } catch {
      errors.push(`${file}:${line}: invalid anchor encoding: ${target}`)
      return
    }
    if (!document(relative).anchors.has(anchor)) errors.push(`${file}:${line}: missing anchor: ${target}`)
  }
}

for (const file of new Set(files)) {
  const { visible } = document(file)
  for (let index = 0; index < visible.length; index++) {
    const line = visible[index].replace(/`+[^`]*`+/g, '')
    for (const match of line.matchAll(
      /!?\[[^\]]*\]\((<[^>]+>|[^\s)]*(?:\([^)]*\)[^\s)]*)*)(?:\s+["'][^"']*["'])?\)/g
    )) {
      if (match[1]) checkLink(file, index + 1, match[1])
    }
    const reference = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/.exec(line)
    if (reference) checkLink(file, index + 1, reference[1])
  }
}

if (errors.length) {
  for (const error of [...new Set(errors)].sort()) console.error(error)
  process.exitCode = 1
} else {
  console.log(`Checked ${new Set(files).size} Markdown files: local links, anchors, path case and code fences passed.`)
}
