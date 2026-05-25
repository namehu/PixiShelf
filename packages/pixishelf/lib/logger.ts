import winston from 'winston'
import path from 'path'
import fs from 'fs'

// --- 路径定义 ---
// process.cwd() 返回的是执行 node 命令的目录。
const logDirectory = path.join(process.cwd(), 'logs')

// 确保日志目录存在
if (!fs.existsSync(logDirectory)) {
  try {
    fs.mkdirSync(logDirectory, { recursive: true })
  } catch (e) {
    console.error('Could not create log directory', e)
  }
}

// 检查是否为生产环境
const isProduction = process.env.NODE_ENV === 'production'

// --- Transports 定义 ---

// 1. 控制台输出
const consoleTransport = new winston.transports.Console({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ''
      }`
    })
  ),
  handleExceptions: true
})

// --- Logger 实例创建 ---

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  transports: [
    consoleTransport
  ],
  exitOnError: false
})

// --- Migration Logger ---
// 专门用于迁移任务的 Logger，始终输出到文件
export const migrationLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    // 同时也输出到控制台，方便调试
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) => {
                return `[Migration] ${timestamp} ${level}: ${message}`
            })
        )
    }),
    new winston.transports.File({ 
      filename: path.join(logDirectory, 'migration.log') 
    })
  ]
})

export default logger
