import { VALIDATION } from './constants'

// ============================================================================
// 输入验证函数
// ============================================================================

/**
 * 验证结果接口
 */
export interface ValidationResult {
  isValid: boolean
  error?: string
}

/**
 * 验证用户名
 * @param username - 用户名
 * @returns 验证结果
 */
export function validateUsername(username: string): ValidationResult {
  if (!username || typeof username !== 'string') {
    return {
      isValid: false,
      error: '用户名不能为空',
    }
  }

  const trimmedUsername = username.trim()

  if (trimmedUsername.length < VALIDATION.USERNAME.MIN_LENGTH) {
    return {
      isValid: false,
      error: `用户名长度不能少于${VALIDATION.USERNAME.MIN_LENGTH}个字符`,
    }
  }

  if (trimmedUsername.length > VALIDATION.USERNAME.MAX_LENGTH) {
    return {
      isValid: false,
      error: `用户名长度不能超过${VALIDATION.USERNAME.MAX_LENGTH}个字符`,
    }
  }

  if (!VALIDATION.USERNAME.PATTERN.test(trimmedUsername)) {
    return {
      isValid: false,
      error: '用户名只能包含字母、数字、下划线和连字符',
    }
  }

  return { isValid: true }
}

/**
 * 验证密码
 * @param password - 密码
 * @returns 验证结果
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      error: '密码不能为空',
    }
  }

  if (password.length < VALIDATION.PASSWORD.MIN_LENGTH) {
    return {
      isValid: false,
      error: `密码长度不能少于${VALIDATION.PASSWORD.MIN_LENGTH}个字符`,
    }
  }

  if (password.length > VALIDATION.PASSWORD.MAX_LENGTH) {
    return {
      isValid: false,
      error: `密码长度不能超过${VALIDATION.PASSWORD.MAX_LENGTH}个字符`,
    }
  }

  return { isValid: true }
}

/**
 * 验证邮箱地址
 * @param email - 邮箱地址
 * @returns 验证结果
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') {
    return {
      isValid: false,
      error: '邮箱地址不能为空',
    }
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailPattern.test(email.trim())) {
    return {
      isValid: false,
      error: '请输入有效的邮箱地址',
    }
  }

  return { isValid: true }
}

/**
 * 验证URL
 * @param url - URL字符串
 * @returns 验证结果
 */
export function validateUrl(url: string): ValidationResult {
  if (!url || typeof url !== 'string') {
    return {
      isValid: false,
      error: 'URL不能为空',
    }
  }

  try {
    new URL(url)
    return { isValid: true }
  } catch {
    return {
      isValid: false,
      error: '请输入有效的URL',
    }
  }
}

/**
 * 验证必填字段
 * @param value - 字段值
 * @param fieldName - 字段名称
 * @returns 验证结果
 */
export function validateRequired(value: any, fieldName: string): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${fieldName}不能为空`,
    }
  }

  if (typeof value === 'string' && value.trim() === '') {
    return {
      isValid: false,
      error: `${fieldName}不能为空`,
    }
  }

  return { isValid: true }
}

/**
 * 验证字符串长度
 * @param value - 字符串值
 * @param minLength - 最小长度
 * @param maxLength - 最大长度
 * @param fieldName - 字段名称
 * @returns 验证结果
 */
export function validateLength(
  value: string,
  minLength: number,
  maxLength: number,
  fieldName: string
): ValidationResult {
  if (typeof value !== 'string') {
    return {
      isValid: false,
      error: `${fieldName}必须是字符串`,
    }
  }

  const length = value.trim().length

  if (length < minLength) {
    return {
      isValid: false,
      error: `${fieldName}长度不能少于${minLength}个字符`,
    }
  }

  if (length > maxLength) {
    return {
      isValid: false,
      error: `${fieldName}长度不能超过${maxLength}个字符`,
    }
  }

  return { isValid: true }
}

/**
 * 验证数字范围
 * @param value - 数字值
 * @param min - 最小值
 * @param max - 最大值
 * @param fieldName - 字段名称
 * @returns 验证结果
 */
export function validateNumberRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): ValidationResult {
  if (typeof value !== 'number' || isNaN(value)) {
    return {
      isValid: false,
      error: `${fieldName}必须是有效数字`,
    }
  }

  if (value < min) {
    return {
      isValid: false,
      error: `${fieldName}不能小于${min}`,
    }
  }

  if (value > max) {
    return {
      isValid: false,
      error: `${fieldName}不能大于${max}`,
    }
  }

  return { isValid: true }
}

/**
 * 验证登录表单
 * @param data - 登录表单数据
 * @returns 验证结果
 */
export function validateLoginForm(data: {
  username: string
  password: string
}): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  const usernameResult = validateUsername(data.username)
  if (!usernameResult.isValid) {
    errors.username = usernameResult.error!
  }

  const passwordResult = validatePassword(data.password)
  if (!passwordResult.isValid) {
    errors.password = passwordResult.error!
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * 验证文件类型
 * @param file - 文件对象
 * @param allowedTypes - 允许的文件类型
 * @returns 验证结果
 */
export function validateFileType(
  file: File,
  allowedTypes: string[]
): ValidationResult {
  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `不支持的文件类型：${file.type}`,
    }
  }

  return { isValid: true }
}

/**
 * 验证文件大小
 * @param file - 文件对象
 * @param maxSize - 最大文件大小（字节）
 * @returns 验证结果
 */
export function validateFileSize(file: File, maxSize: number): ValidationResult {
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `文件大小不能超过${Math.round(maxSize / 1024 / 1024)}MB`,
    }
  }

  return { isValid: true }
}