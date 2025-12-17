const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ================= 配置区域 =================

// 默认配置
const DEFAULTS = {
  INPUT_DIR: '/Users/admin/Downloads/pixiv',
  OUTPUT_FILE: '/Users/admin/Downloads/result.txt'
};

// ===========================================

// 解析命令行参数
function parseArgs() {
  const args = {
    inputDir: DEFAULTS.INPUT_DIR,
    outputFile: DEFAULTS.OUTPUT_FILE
  };

  const rawArgs = process.argv.slice(2);

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--input' || arg === '-i') {
      args.inputDir = rawArgs[++i];
    } else if (arg === '--output' || arg === '-o') {
      args.outputFile = rawArgs[++i];
    } else if (!arg.startsWith('-') && i === 0) {
      // 兼容旧的 positional argument 方式
      args.inputDir = arg;
    }
  }
  return args;
}

const { inputDir: INPUT_DIR, outputFile: OUTPUT_FILE } = parseArgs();

// 日志函数
function log(message, type = 'INFO') {
  // 控制台输出保持原样，去掉时间戳以免太乱，或者根据需要添加
  if (type === 'ERROR') {
    console.error(message);
  } else {
    console.log(message);
  }

  // 文件输出带时间戳
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type}] ${message}\n`;

    // 确保目录存在
    const logDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(OUTPUT_FILE, logMessage);
  } catch (err) {
    console.error(`❌ 写入日志失败: ${err.message}`);
  }
}

// 递归获取所有文件
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(function (file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

(async () => {
  log(`🚀 开始扫描 APNG 文件，目录: ${INPUT_DIR}`);
  log(`📝 日志输出到: ${OUTPUT_FILE}`);

  if (!fs.existsSync(INPUT_DIR)) {
    log(`❌ 目录不存在: ${INPUT_DIR}`, 'ERROR');
    return;
  }

  // 1. 找出所有 .apng 文件
  const allFiles = getAllFiles(INPUT_DIR);
  const apngFiles = allFiles.filter(f => f.toLowerCase().endsWith('.apng'));

  log(`📦 找到 ${apngFiles.length} 个 APNG 文件\n`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const apngPath of apngFiles) {
    const dir = path.dirname(apngPath);
    const filename = path.basename(apngPath, '.apng'); // 获取不带后缀的文件名
    const webmPath = path.join(dir, `${filename}.webm`);

    // 2. 检查是否已存在 WebM
    if (fs.existsSync(webmPath)) {
      log(`⏭️  跳过 (已存在): ${filename}.webm | 路径: ${webmPath}`);
      skipCount++;
      continue;
    }

    // process.stdout.write 无法直接被 log 函数替代用于文件记录，因此改为 explicit log
    log(`⚙️  开始转换: ${filename}.apng -> .webm | 源文件: ${apngPath}`);

    try {
      // 3. 执行 FFmpeg (APNG 直接转 WebM)
      // -c:v libvpx-vp9: 使用 VP9 编码
      // -b:v 0 -crf 30: 动态码率，CRF 30 兼顾画质和体积
      // -pix_fmt yuv420p: 确保浏览器兼容性
      const cmd = `ffmpeg -y -i "${apngPath}" -c:v libvpx-vp9 -b:v 0 -crf 30 -pix_fmt yuv420p "${webmPath}"`;

      execSync(cmd, { stdio: 'ignore' }); // 忽略 ffmpeg 的冗长输出

      log(`✅ 转换成功: ${webmPath}`);
      successCount++;
    } catch (e) {
      log(`❌ 转换失败: ${apngPath}`, 'ERROR');
      log(`   错误详情: ${e.message}`, 'ERROR');
      // 如果生成了损坏的 webm，尝试删除
      if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
      failCount++;
    }
  }

  log(`\n📊 任务结束: 成功 ${successCount} / 跳过 ${skipCount} / 失败 ${failCount}`);
})();
