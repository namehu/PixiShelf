const fs = require('fs-extra');
const path = require('path');
const extract = require('extract-zip');
const { execSync } = require('child_process');

// --- 配置区域 ---
const ARGS = process.argv.slice(2);
// 如果未传路径，默认为当前目录下的 download 文件夹
const INPUT_DIR = ARGS.find(a => !a.startsWith('-')) || './download';
const TEMP_BASE_DIR = path.join(__dirname, 'temp_processing');

// 解析参数：默认生成 webm
// 使用方式: node convert.js [路径] --format=webm / apng / all
let TARGET_FORMAT = 'webm';
const formatArg = ARGS.find(a => a.startsWith('--format='));
if (formatArg) {
  const val = formatArg.split('=')[1].toLowerCase();
  if (['webm', 'apng', 'all'].includes(val)) TARGET_FORMAT = val;
}

// 结果收集器
const results = [];

// 递归遍历所有文件的辅助函数
function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

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

// 主函数
(async () => {
  try {
    if (!fs.existsSync(INPUT_DIR)) {
      throw new Error(`目录不存在: ${INPUT_DIR}`);
    }
    fs.ensureDirSync(TEMP_BASE_DIR);

    // 1. 递归获取所有文件路径
    const allFiles = getAllFiles(INPUT_DIR);

    // 2. 筛选出 *-meta.txt 作为锚点文件
    const metaFiles = allFiles.filter(f => f.endsWith('-meta.txt'));

    console.log(`找到 ${metaFiles.length} 个作品元数据，开始分析...`);

    // 3. 遍历处理
    for (const metaPath of metaFiles) {
      // 解析 ID 和 目录
      const dir = path.dirname(metaPath);
      const metaFilename = path.basename(metaPath); // e.g., 138613530-meta.txt

      // 提取 ID: 假设格式总是 ID-meta.txt
      const id = metaFilename.replace('-meta.txt', '');

      const zipPath = path.join(dir, `${id}.zip`);
      const webmPath = path.join(dir, `${id}.webm`);
      const apngPath = path.join(dir, `${id}.apng`);

      const resultItem = {
        id: id,
        dir: dir,
        status: 'pending',
        actions: [], // 记录实际执行了什么操作
        error: null
      };

      // 4. 判断是否需要处理
      let needWebm = (TARGET_FORMAT === 'webm' || TARGET_FORMAT === 'all') && !fs.existsSync(webmPath);
      let needApng = (TARGET_FORMAT === 'apng' || TARGET_FORMAT === 'all') && !fs.existsSync(apngPath);

      // 如果所有目标都已存在，则标记跳过
      if (!needWebm && !needApng) {
        resultItem.status = 'skipped';
        resultItem.message = 'Target files already exist';
        results.push(resultItem);
        continue;
      }

      // 5. 检查 ZIP 是否存在
      if (!fs.existsSync(zipPath)) {
        resultItem.status = 'skipped'; // 或者 failed，看你怎么定义
        resultItem.message = 'ZIP file missing';
        results.push(resultItem);
        continue;
      }

      // 6. 执行转换
      try {
        // 仅传递需要生成的格式
        const outputs = await processSingleZip(zipPath, id, needWebm, needApng, dir);
        resultItem.status = 'success';
        resultItem.actions = outputs;
      } catch (e) {
        resultItem.status = 'failed';
        resultItem.error = e.message;
      }

      results.push(resultItem);
    }

    // 清理临时目录
    await fs.remove(TEMP_BASE_DIR);

  } catch (globalErr) {
    results.push({ status: 'fatal_error', error: globalErr.message });
  } finally {
    console.log(JSON.stringify(results, null, 2));
  }
})();

async function processSingleZip(zipPath, id, doWebm, doApng, outputDir) {
  const unzipPath = path.join(TEMP_BASE_DIR, id);
  const generatedActions = [];

  // --- 解压 ---
  // 为了防止临时文件夹冲突，先清空
  await fs.emptyDir(unzipPath);
  await extract(zipPath, { dir: unzipPath });

  // --- 分析帧数据 ---
  // 逻辑：优先找 JSON，找不到按文件名排序
  let frames = [];
  const jsonFiles = fs.readdirSync(unzipPath).filter(f => f.endsWith('.json'));

  if (jsonFiles.length > 0) {
    const metaData = await fs.readJson(path.join(unzipPath, jsonFiles[0]));
    const rawFrames = metaData.frames || metaData.body || [];
    frames = rawFrames.map(f => ({ file: f.file, delay: f.delay }));
  } else {
    const allImages = fs.readdirSync(unzipPath).filter(f => /\.(jpg|png|jpeg)$/i.test(f));
    allImages.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    frames = allImages.map(f => ({ file: f, delay: 110 })); // 默认 100ms
  }

  if (frames.length === 0) throw new Error("ZIP is empty or invalid");

  // --- 生成 FFmpeg concat 列表 ---
  const concatFilePath = path.join(unzipPath, 'input.txt');
  let concatContent = '';

  frames.forEach(frame => {
    concatContent += `file '${path.join(unzipPath, frame.file)}'\n`;
    concatContent += `duration ${frame.delay / 1000}\n`;
  });
  if (frames.length > 0) concatContent += `file '${path.join(unzipPath, frames[frames.length - 1].file)}'\n`;

  await fs.writeFile(concatFilePath, concatContent);

  // --- 执行转换 ---

  // 1. 生成 WebM
  if (doWebm) {
    const outWebm = path.join(outputDir, `${id}.webm`);
    // 使用 -y 强制覆盖（虽然前面判断过不存在，但防万一）
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c:v libvpx-vp9 -b:v 0 -crf 30 -pix_fmt yuv420p "${outWebm}"`;
    execSync(cmd, { stdio: 'ignore' });
    generatedActions.push('generated_webm');
  }

  // 2. 生成 APNG
  if (doApng) {
    const outApng = path.join(outputDir, `${id}.apng`);
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -plays 0 -c:v apng -pred 2 "${outApng}"`;
    execSync(cmd, { stdio: 'ignore' });
    generatedActions.push('generated_apng');
  }

  // 清理本次解压的临时文件，防止占空间
  await fs.remove(unzipPath);

  return generatedActions;
}
