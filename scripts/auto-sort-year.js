#!/usr/bin/env node

/**
 * AutoSort_Year.js
 *
 * 功能：根据文件名中的日期模式自动分类文件。
 * 特性：
 * 1. 日志记录与滚动 (10MB 限制)
 * 2. 外部配置 (config.json)
 * 3. 进度显示
 * 4. DryRun 模拟模式
 *
 * 使用方法：
 * node auto-sort-year.js --source "C:\Photos" --dest "D:\Archive" --dry-run
 */

const fs = require('fs');
const path = require('path');

// --- 颜色常量 ---
const COLORS = {
  Reset: "\x1b[0m",
  Red: "\x1b[31m",
  Green: "\x1b[32m",
  Yellow: "\x1b[33m",
  Blue: "\x1b[34m",
  Magenta: "\x1b[35m",
  Cyan: "\x1b[36m",
  White: "\x1b[37m",
  Gray: "\x1b[90m",
};

// --- 参数解析 ---
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    sourcePath: process.cwd(),
    // destPath: process.cwd(),
    configFile: path.join(__dirname, 'config.json'),
    dryRun: false,
    logLevel: 'Info'
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
      case '-s':
        params.sourcePath = args[++i];
        break;
      case '--dest':
      case '-d':
        params.destPath = args[++i];
        break;
      case '--config':
      case '-c':
        params.configFile = args[++i];
        break;
      case '--dry-run':
        params.dryRun = true;
        break;
      case '--log-level':
      case '-l':
        params.logLevel = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
用法: node auto-sort-year.js [options]

选项:
  --source, -s <path>    源目录 (默认: 当前目录)
  --dest, -d <path>      目标目录 (默认: 源目录)
  --config, -c <path>    配置文件路径 (默认: 脚本同级 config.json)
  --dry-run              模拟运行，不移动文件
  --log-level, -l <level> 日志级别 (Info, Debug, Warning, Error)
                `);
        process.exit(0);
    }
  }

  params.destPath = params.destPath || (params.sourcePath);
  return params;
}

// --- 日志系统 ---
class Logger {
  constructor(logFile, level = 'Info') {
    this.logFile = logFile;
    this.level = level;
    this.buffer = [];
    this.levels = { 'Debug': 0, 'Info': 1, 'Warning': 2, 'Error': 3 };
  }

  log(message, level = 'Info', color = COLORS.White) {
    if (this.levels[level] < this.levels[this.level]) return;

    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const logEntry = `[${timestamp}] [${level}] ${message}`;

    // 控制台输出
    let consoleColor = color;
    if (level === 'Warning') consoleColor = COLORS.Yellow;
    if (level === 'Error') consoleColor = COLORS.Red;
    if (level === 'Debug') consoleColor = COLORS.Gray;
    if (level === 'Info' && color === COLORS.White) consoleColor = COLORS.Cyan;

    console.log(`${consoleColor}${logEntry}${COLORS.Reset}`);

    // 缓存到内存
    this.buffer.push(logEntry);
  }

  flush() {
    if (!this.logFile || this.buffer.length === 0) return;

    try {
      // 滚动日志检查 (10MB)
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > 10 * 1024 * 1024) {
          const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
          const archiveName = `${this.logFile}.${timestamp}.bak`;
          fs.renameSync(this.logFile, archiveName);
        }
      }

      fs.appendFileSync(this.logFile, this.buffer.join('\n') + '\n', 'utf8');
      this.buffer = [];
    } catch (err) {
      console.error(`${COLORS.Red}写入日志失败: ${err.message}${COLORS.Reset}`);
    }
  }
}

// --- 核心逻辑 ---

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function (file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // 暂不递归
      // arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// --- 主程序 ---
async function main() {
  const params = parseArgs();

  // 确保路径为绝对路径
  params.sourcePath = path.resolve(params.sourcePath);
  params.destPath = path.resolve(params.destPath);
  params.configFile = path.resolve(params.configFile);

  // 加载配置
  let config = {};
  try {
    if (fs.existsSync(params.configFile)) {
      config = JSON.parse(fs.readFileSync(params.configFile, 'utf8'));
    } else {
      throw new Error(`配置文件不存在: ${params.configFile}`);
    }
  } catch (err) {
    console.error(`${COLORS.Red}加载配置失败: ${err.message}${COLORS.Reset}`);
    process.exit(1);
  }

  // 初始化日志
  const logPath = config.Logging?.LogFile
    ? path.join(path.dirname(params.configFile), config.Logging.LogFile)
    : path.join(__dirname, 'AutoSort.log');

  const logger = new Logger(logPath, params.logLevel);

  logger.log("正在启动自动归档 (AutoSort JS版)...", "Info");
  logger.log(`源目录: ${params.sourcePath}`, "Info");
  logger.log(`目标目录: ${params.destPath}`, "Info");
  if (params.dryRun) logger.log("模式: 模拟运行 (DryRun)", "Warning");

  // 准备正则
  const patternStr = config.Rules?.[0]?.Regex || "^(?<date>\\d{1,2}\\.\\d{1,2})";
  const regex = new RegExp(patternStr);

  try {
    if (!fs.existsSync(params.sourcePath)) {
      throw new Error(`源路径不存在: ${params.sourcePath}`);
    }

    // 扫描文件
    logger.log("正在扫描文件...", "Info");
    const files = getAllFiles(params.sourcePath);
    const totalFiles = files.length;
    logger.log(`找到 ${totalFiles} 个文件`, "Info");

    let processedCount = 0;

    for (const file of files) {
      processedCount++;
      const fileName = path.basename(file);

      // 简单的进度显示
      if (process.stdout.isTTY) {
        const percent = ((processedCount / totalFiles) * 100).toFixed(1);
        process.stdout.write(`\r处理中: ${percent}% (${processedCount}/${totalFiles}) - ${fileName.substring(0, 30)}...`);
      }

      // 1. 匹配模式
      const match = fileName.match(regex);
      if (match && match.groups && match.groups.date) {
        const datePart = match.groups.date;

        // 2. 确定路径
        const targetFolder = path.join(params.destPath, datePart);
        const destFile = path.join(targetFolder, fileName);

        // logger.log(`\n正在处理: [${fileName}] -> [${datePart}]`, "Info");

        if (!params.dryRun) {
          // 创建目录
          if (!fs.existsSync(targetFolder)) {
            fs.mkdirSync(targetFolder, { recursive: true });
          }

          // 3. 移动文件
          if (fs.existsSync(destFile)) {
            logger.log(`\n冲突: 目标文件已存在 [${destFile}]。跳过。`, "Warning");
          } else {
            try {
              fs.renameSync(file, destFile);
              logger.log(`\n已移动: ${fileName} -> ${destFile}`, "Info", COLORS.Green);
            } catch (moveErr) {
              logger.log(`\n移动失败: ${moveErr.message}`, "Error");
            }
          }
        } else {
          logger.log(`\n[模拟] 将移动到: ${destFile}`, "Info", COLORS.Cyan);
        }
      } else {
        // logger.log(`\n未匹配: ${fileName}`, "Debug");
      }
    }

    if (process.stdout.isTTY) {
      process.stdout.write('\n'); // 换行结束进度条
    }

    logger.log("完成。", "Info", COLORS.Green);

  } catch (err) {
    logger.log(`严重错误: ${err.message}`, "Error");
    process.exit(1);
  } finally {
    logger.flush();
  }
}

main();
