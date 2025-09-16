import bcrypt from 'bcryptjs'

// ============================================================================
// 密码加密工具
// ============================================================================

/**
 * 密码加密配置
 */
const SALT_ROUNDS = 12

/**
 * 加密密码
 * @param password - 明文密码
 * @returns Promise<string> 加密后的密码
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS)
    const hashedPassword = await bcrypt.hash(password, salt)
    return hashedPassword
  } catch (error) {
    throw new Error(`密码加密失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 验证密码
 * @param password - 明文密码
 * @param hash - 密码哈希
 * @returns Promise<boolean> 是否匹配
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await comparePassword(password, hash)
}

/**
 * 比较密码（内部使用）
 * @param password - 明文密码
 * @param hash - 密码哈希
 * @returns Promise<boolean> 是否匹配
 */
export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    const isMatch = await bcrypt.compare(password, hash)
    return isMatch
  } catch (error) {
    throw new Error(`密码验证失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 生成随机盐值
 * @param rounds - 盐值轮数，默认为12
 * @returns Promise<string> 盐值
 */
export async function generateSalt(rounds: number = SALT_ROUNDS): Promise<string> {
  try {
    const salt = await bcrypt.genSalt(rounds)
    return salt
  } catch (error) {
    throw new Error(`生成盐值失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 使用指定盐值加密密码
 * @param password - 明文密码
 * @param salt - 盐值
 * @returns Promise<string> 加密后的密码
 */
export async function hashPasswordWithSalt(
  password: string,
  salt: string
): Promise<string> {
  try {
    const hashedPassword = await bcrypt.hash(password, salt)
    return hashedPassword
  } catch (error) {
    throw new Error(`密码加密失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 验证密码强度
 * @param password - 密码
 * @returns { isStrong: boolean; score: number; feedback: string[] }
 */
export function validatePasswordStrength(password: string): {
  isStrong: boolean
  score: number
  feedback: string[]
} {
  const feedback: string[] = []
  let score = 0

  // 长度检查
  if (password.length >= 8) {
    score += 1
  } else {
    feedback.push('密码长度至少需要8个字符')
  }

  if (password.length >= 12) {
    score += 1
  }

  // 包含小写字母
  if (/[a-z]/.test(password)) {
    score += 1
  } else {
    feedback.push('密码应包含小写字母')
  }

  // 包含大写字母
  if (/[A-Z]/.test(password)) {
    score += 1
  } else {
    feedback.push('密码应包含大写字母')
  }

  // 包含数字
  if (/\d/.test(password)) {
    score += 1
  } else {
    feedback.push('密码应包含数字')
  }

  // 包含特殊字符
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    score += 1
  } else {
    feedback.push('密码应包含特殊字符')
  }

  // 不包含常见弱密码模式
  const weakPatterns = [
    /123456/,
    /password/i,
    /qwerty/i,
    /abc123/i,
    /(.)\1{2,}/, // 连续重复字符
  ]

  const hasWeakPattern = weakPatterns.some(pattern => pattern.test(password))
  if (hasWeakPattern) {
    score -= 2
    feedback.push('密码包含常见弱密码模式')
  }

  const isStrong = score >= 4 && !hasWeakPattern

  return {
    isStrong,
    score: Math.max(0, Math.min(6, score)),
    feedback,
  }
}

/**
 * 生成安全的随机密码
 * @param length - 密码长度，默认为12
 * @param options - 生成选项
 * @returns string 随机密码
 */
export function generateSecurePassword(
  length: number = 12,
  options: {
    includeUppercase?: boolean
    includeLowercase?: boolean
    includeNumbers?: boolean
    includeSymbols?: boolean
    excludeSimilar?: boolean
  } = {}
): string {
  const {
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
    excludeSimilar = true,
  } = options

  let charset = ''
  
  if (includeLowercase) {
    charset += excludeSimilar ? 'abcdefghjkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz'
  }
  
  if (includeUppercase) {
    charset += excludeSimilar ? 'ABCDEFGHJKMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  }
  
  if (includeNumbers) {
    charset += excludeSimilar ? '23456789' : '0123456789'
  }
  
  if (includeSymbols) {
    charset += '!@#$%^&*()_+-=[]{}|;:,.<>?'
  }

  if (charset === '') {
    throw new Error('至少需要选择一种字符类型')
  }

  let password = ''
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length)
    password += charset[randomIndex]
  }

  return password
}