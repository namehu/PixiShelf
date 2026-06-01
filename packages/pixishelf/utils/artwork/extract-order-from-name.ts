/**
 * 从文件名中提取用于排序的序号。
 *
 * 提取规则：
 * 1. 先移除文件名最后一个扩展名部分，例如：
 *    - "image_001.png" -> "image_001"
 *    - "archive.tar.gz" -> "archive.tar"
 *
 * 2. 在去除扩展名后的文件名中查找数字片段，支持以下两种形式：
 *    - 带分隔符的数字：前面带 "-" 或 "_"，例如 "_001"、"-12"
 *    - 普通连续数字：例如 "001"、"12"、"2024"
 *
 * 3. 如果文件名中存在多个数字片段，取最后一个匹配到的数字作为排序序号。
 *    例如：
 *    - "chapter_01_page_03.png" -> 3
 *    - "abc123def456.txt" -> 456
 *
 * 4. 如果匹配到的数字前带有 "-" 或 "_"，会先移除该分隔符再转换为数字。
 *    注意："-12" 会被视为分隔符加数字，结果为 12，而不是负数 -12。
 *
 * 5. 如果文件名中没有任何数字，则返回 0。
 *
 * 示例：
 * - "image_001.png" -> 1
 * - "page-12.jpg" -> 12
 * - "chapter_01_page_03.png" -> 3
 * - "abc123def456.txt" -> 456
 * - "file.png" -> 0
 *
 * @param fileName 文件名，可以包含扩展名
 * @returns 从文件名中提取出的排序序号；没有数字时返回 0
 */
export function extractOrderFromName(fileName: string): number {
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, '')
  const match = nameWithoutExtension.match(/[-_](\d+)|(\d+)/g)
  if (match) {
    const lastMatch = match[match.length - 1]
    return lastMatch !== undefined ? parseInt(lastMatch.replace(/[-_]/, ''), 10) : 0
  }
  return 0
}
