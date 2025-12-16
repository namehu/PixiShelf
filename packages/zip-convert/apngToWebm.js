const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ================= 配置区域 =================

// 默认扫描目录
const DEFAULT_INPUT_DIR = './download';

// ===========================================

const ARGS = process.argv.slice(2);
const INPUT_DIR = ARGS[0] || DEFAULT_INPUT_DIR;

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
  console.log(`🚀 开始扫描 APNG 文件，目录: ${INPUT_DIR}`);

  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ 目录不存在: ${INPUT_DIR}`);
    return;
  }

  // 1. 找出所有 .apng 文件
  const allFiles = getAllFiles(INPUT_DIR);
  const apngFiles = allFiles.filter(f => f.toLowerCase().endsWith('.apng'));

  console.log(`📦 找到 ${apngFiles.length} 个 APNG 文件\n`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const apngPath of apngFiles) {
    const dir = path.dirname(apngPath);
    const filename = path.basename(apngPath, '.apng'); // 获取不带后缀的文件名
    const webmPath = path.join(dir, `${filename}.webm`);

    // 2. 检查是否已存在 WebM
    if (fs.existsSync(webmPath)) {
      console.log(`⏭️  跳过 (已存在): ${filename}.webm`);
      skipCount++;
      continue;
    }

    process.stdout.write(`⚙️  正在转换: ${filename}.apng -> .webm ... `);

    try {
      // 3. 执行 FFmpeg (APNG 直接转 WebM)
      // -c:v libvpx-vp9: 使用 VP9 编码
      // -b:v 0 -crf 30: 动态码率，CRF 30 兼顾画质和体积
      // -pix_fmt yuv420p: 确保浏览器兼容性
      const cmd = `ffmpeg -y -i "${apngPath}" -c:v libvpx-vp9 -b:v 0 -crf 30 -pix_fmt yuv420p "${webmPath}"`;

      execSync(cmd, { stdio: 'ignore' }); // 忽略 ffmpeg 的冗长输出

      console.log('✅ 完成');
      successCount++;
    } catch (e) {
      console.log('❌ 失败');
      console.error(`   错误详情: ${e.message}`);
      // 如果生成了损坏的 webm，尝试删除
      if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
      failCount++;
    }
  }

  console.log(`\n📊 任务结束: 成功 ${successCount} / 跳过 ${skipCount} / 失败 ${failCount}`);
})();
