import winston from 'winston'
// import DailyRotateFile from 'winston-daily-rotate-file'
// import path from 'path' // <--- 关键改动：引入 path 模块

// --- 路径定义 ---
// process.cwd() 返回的是执行 node 命令的目录。
// 在 Monorepo 中，我们通常在根目录执行命令 (例如: npm run dev -w pixishelf)，
// 所以 process.cwd() 会是 Monorepo 的根目录。
// const logDirectory = path.join(process.cwd(), 'logs') // <--- 关键改动：动态计算日志目录路径

// 检查是否为生产环境
const isProduction = process.env.NODE_ENV === 'production'

// --- Transports 定义 ---

// 1. 控制台输出
const consoleTransport = new winston.transports.Console({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(/*... 之前的格式化配置保持不变 ...*/),
  handleExceptions: true
})

// 2. 文件输出 (路径已更新)
// const fileTransport: DailyRotateFile = new DailyRotateFile({
//   // 👇 关键改动：使用我们动态计算出的路径
//   filename: path.join(logDirectory, 'application-%DATE%.log'),
//   datePattern: 'YYYY-MM-DD',
//   zippedArchive: true,
//   maxSize: '20m',
//   maxFiles: '14d',
//   level: 'info',
//   format: winston.format.combine(/*... 之前的格式化配置保持不变 ...*/),
//   handleExceptions: true
// })

// --- Logger 实例创建 ---

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  transports: [
    consoleTransport
    // ...(isProduction ? [fileTransport] : [])
  ],
  exitOnError: false
})

export default logger
