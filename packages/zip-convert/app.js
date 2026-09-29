const fs = require('fs-extra');
const path = require('path');
const extract = require('extract-zip');
const { execSync } = require('child_process');

// ================= 配置区域 =================

// 1. 可选 Pixiv 会话凭据。只从运行时环境读取，禁止写入源码或日志。
// 用于下载 R-18 作品或需要登录才能查看的元数据。
const PIXIV_PHPSESSID = process.env.PIXIV_PHPSESSID?.trim() || '';

// 2. 默认输入目录 (可以通过命令行参数覆盖)
const DEFAULT_INPUT_DIR = './download';

// 3. 临时工作目录 (脚本运行完会自动清理)
const TEMP_BASE_DIR = path.join(__dirname, 'temp_processing');

// ===========================================

// 解析命令行参数
const ARGS = process.argv.slice(2);
const INPUT_DIR = ARGS.find(a => !a.startsWith('-')) || DEFAULT_INPUT_DIR;
let TARGET_FORMAT = 'webm'; // 默认格式

// 允许通过 --format=apng 或 --format=all 修改
const formatArg = ARGS.find(a => a.startsWith('--format='));
if (formatArg) {
  const val = formatArg.split('=')[1].toLowerCase();
  if (['webm', 'apng', 'all'].includes(val)) TARGET_FORMAT = val;
}

// 结果日志收集
const results = [];

// 递归获取所有文件
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

// 封装的网络请求函数
async function fetchPixivMeta(id) {
  const url = `https://www.pixiv.net/touch/ajax/illust/details?illust_id=${id}&lang=zh`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://www.pixiv.net/artworks/${id}`,
    'Accept': 'application/json'
  };

  if (PIXIV_PHPSESSID) {
    headers['Cookie'] = `PHPSESSID=${PIXIV_PHPSESSID};`;
  }

  // Node 18+ 原生支持 fetch，如果报错请升级 Node 或 require('node-fetch')
  const response = await fetch(url, { method: 'GET', headers: headers });

  if (!response.ok) {
    throw new Error(`Pixiv API Error: ${response.status}`);
  }

  return await response.json();
}

// 主逻辑
(async () => {
  console.log(`🚀 开始处理，目标目录: ${INPUT_DIR}`);
  console.log(`🎯 目标格式: ${TARGET_FORMAT}`);

  try {
    if (!fs.existsSync(INPUT_DIR)) throw new Error(`目录不存在: ${INPUT_DIR}`);
    fs.ensureDirSync(TEMP_BASE_DIR);

    // 1. 扫描文件，以 .zip 为核心锚点
    const allFiles = getAllFiles(INPUT_DIR);
    const zipFiles = allFiles.filter(f => f.toLowerCase().endsWith('.zip'));

    console.log(`📦 找到 ${zipFiles.length} 个 ZIP 文件，开始检查...`);

    for (const zipPath of zipFiles) {
      const dir = path.dirname(zipPath);
      const filename = path.basename(zipPath);

      // 尝试从文件名提取纯数字 ID (e.g. 138613530.zip -> 138613530)
      const idMatch = filename.match(/^(\d+)/);
      if (!idMatch) {
        // 如果文件名不是数字开头，尝试去同级找 -meta.txt 来辅助定位 ID，或者直接跳过
        // 这里简单处理：跳过非标准命名的文件
        continue;
      }
      const id = idMatch[1];

      // 定义相关路径
      const metaPath = path.join(dir, `${id}-meta.txt`);
      const webmPath = path.join(dir, `${id}.webm`);
      const apngPath = path.join(dir, `${id}.apng`);

      const resultItem = { id, dir, status: 'pending', actions: [], error: null };

      // 检查是否需要转换 (跳过已存在)
      let needWebm = (TARGET_FORMAT === 'webm' || TARGET_FORMAT === 'all') && !fs.existsSync(webmPath);
      let needApng = (TARGET_FORMAT === 'apng' || TARGET_FORMAT === 'all') && !fs.existsSync(apngPath);

      if (!needWebm && !needApng) {
        resultItem.status = 'skipped';
        resultItem.actions = ['already_exists'];
        results.push(resultItem);
        process.stdout.write('.'); // 进度条效果
        continue;
      }

      console.log(`\n⚙️ 正在处理 ID: ${id}`);

      try {
        // A. 获取帧数据 (本地 -> ZIP内 -> 网络)
        const frames = await getFramesData(zipPath, metaPath, id);

        // B. 执行 FFmpeg 转换
        const outputs = await processConversion(zipPath, frames, id, needWebm, needApng, dir);

        resultItem.status = 'success';
        resultItem.actions = outputs;
        console.log(`✅ 完成: ${id}`);
      } catch (e) {
        console.error(`❌ 失败 [${id}]: ${e.message}`);
        resultItem.status = 'failed';
        resultItem.error = e.message;
      }
      results.push(resultItem);
    }

    // 清理临时目录
    await fs.remove(TEMP_BASE_DIR);

  } catch (globalErr) {
    console.error("\n💀 致命错误:", globalErr);
    results.push({ status: 'fatal_error', error: globalErr.message });
  } finally {
    console.log("\n\n📊 ===== 执行报告 =====");
    console.log(JSON.stringify(results, null, 2));
  }
})();

// --- 核心函数：智能获取帧元数据 ---
async function getFramesData(zipPath, metaPath, id) {
  // 策略 1: 优先读取本地 meta.txt
  if (fs.existsSync(metaPath)) {
    try {
      const txtContent = await fs.readFile(metaPath, 'utf-8');
      const metaJson = JSON.parse(txtContent);
      // 兼容多种 JSON 结构
      const raw = metaJson.frames ||
        (metaJson.metadata && metaJson.metadata.frames) ||
        (metaJson.body && metaJson.body.illust_details && metaJson.body.illust_details.ugoira_meta && metaJson.body.illust_details.ugoira_meta.frames);

      if (raw && Array.isArray(raw)) {
        return raw.map(f => ({ file: f.file, delay: f.delay }));
      }
    } catch (e) { /* 解析失败，继续尝试其他策略 */ }
  }

  // 策略 2: 解压 ZIP 检查内部是否有 animation.json
  const unzipTempPath = path.join(TEMP_BASE_DIR, `${id}_check`);
  try {
    await fs.emptyDir(unzipTempPath);
    await extract(zipPath, { dir: unzipTempPath });

    const jsonFiles = fs.readdirSync(unzipTempPath).filter(f => f.endsWith('.json'));
    if (jsonFiles.length > 0) {
      const innerData = await fs.readJson(path.join(unzipTempPath, jsonFiles[0]));
      const raw = innerData.frames || innerData.body || [];
      if (raw.length > 0) {
        const frames = raw.map(f => ({ file: f.file, delay: f.delay }));
        await fs.remove(unzipTempPath);
        return frames;
      }
    }
  } catch (e) { /* 解压失败，继续 */ }

  // 策略 3: 本地无数据，联网请求 Pixiv API
  // console.log(`   🌐 本地无元数据，尝试从 Pixiv 获取...`);
  // try {
  //   const apiJson = await fetchPixivMeta(id);
  //   const ugoiraMeta = apiJson.body?.illust_details?.ugoira_meta;

  //   if (ugoiraMeta && ugoiraMeta.frames) {
  //     const frames = ugoiraMeta.frames.map(f => ({ file: f.file, delay: f.delay }));

  //     // 成功后，写入本地 meta.txt 存档，下次不用再联网
  //     await fs.writeJson(metaPath, apiJson, { spaces: 2 });
  //     console.log(`   💾 已下载元数据并保存到 ${path.basename(metaPath)}`);

  //     await fs.remove(unzipTempPath); // 清理
  //     return frames;
  //   }
  // } catch (netErr) {
  //   console.warn(`   ⚠️ 网络请求失败: ${netErr.message}`);
  // }

  // 策略 4: 实在没有数据，降级处理 (默认FPS)
  console.warn(`   ⚠️ 无法获取元数据，强制使用默认FPS`);
  // 重新读取刚才解压目录里的图片（如果刚才解压失败，这里可能会报错，需要容错）
  if (!fs.existsSync(unzipTempPath)) {
    await fs.emptyDir(unzipTempPath);
    await extract(zipPath, { dir: unzipTempPath });
  }

  const allImages = fs.readdirSync(unzipTempPath).filter(f => /\.(jpg|png|jpeg)$/i.test(f));
  allImages.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  await fs.remove(unzipTempPath);
  return allImages.map(f => ({ file: f, delay: 110 })); // 110ms ≈ 9fps
}

// --- 核心函数：FFmpeg 转换 ---
async function processConversion(zipPath, frames, id, doWebm, doApng, outputDir) {
  const unzipPath = path.join(TEMP_BASE_DIR, id);
  await fs.emptyDir(unzipPath);
  await extract(zipPath, { dir: unzipPath });

  const concatFilePath = path.join(unzipPath, 'input.txt');
  let concatContent = '';

  // 1. 生成 concat 列表
  frames.forEach(frame => {
    const imgPath = path.join(unzipPath, frame.file);
    if (fs.existsSync(imgPath)) {
      concatContent += `file '${imgPath}'\n`;
      concatContent += `duration ${frame.delay / 1000}\n`;
    }
  });
  // 补尾帧防止播放器早退
  if (frames.length > 0) {
    const lastFile = frames[frames.length - 1].file;
    if (fs.existsSync(path.join(unzipPath, lastFile))) {
      concatContent += `file '${path.join(unzipPath, lastFile)}'\n`;
    }
  }

  await fs.writeFile(concatFilePath, concatContent);
  const generatedActions = [];

  // 通用滤镜：强制宽和高都为偶数 (iw/2 向下取整再乘2)
  // 这解决了 WebM 在浏览器黑屏/无法播放的问题
  const evenScaleFilter = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

  // -----------------------------------------------------------
  // 1. 生成 WebM (VP9)
  // -----------------------------------------------------------
  // 1. 生成 WebM (VP9编码，体积小画质好)
  if (doWebm) {
    const outWebm = path.join(outputDir, `${id}.webm`);

    // 核心修复点：
    // -vsync vfr: 强制使用可变帧率 (Variable Frame Rate)。
    //             这告诉 FFmpeg 严格信任 input.txt 里的 duration，
    //             不要强行把它们挤压成标准的 25/30fps，这样浏览器就能看懂时间轴了。
    //
    // -vf ... :   保留缩放滤镜，确保分辨率是偶数 (Chrome 播放 VP9 的硬性要求)。
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -vf "${evenScaleFilter}" -vsync vfr -c:v libvpx-vp9 -b:v 0 -crf 30 -pix_fmt yuv420p -an "${outWebm}"`;

    try {
      execSync(cmd, { stdio: 'ignore' });
      generatedActions.push('generated_webm');
    } catch (err) {
      console.error(`   ⚠️ WebM 生成失败:`, err.message);
    }
  }
  // -----------------------------------------------------------
  // 2. 生成 APNG (修复错位与尺寸)
  // -----------------------------------------------------------
  if (doApng) {
    const outApng = path.join(outputDir, `${id}.apng`);

    // 关键修正：
    // format=rgb24: 强制移除 Alpha 通道，解决“透明叠加”导致的错位
    // -pred 0: 禁用预测算法，虽然文件稍大，但兼容性最好，防止画面破碎
    const apngFilter = `${evenScaleFilter},format=rgb24`;

    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -vf "${apngFilter}" -plays 0 -c:v apng -pred 0 "${outApng}"`;

    try {
      execSync(cmd, { stdio: 'ignore' });
      generatedActions.push('generated_apng');
    } catch (err) {
      console.error(`   ⚠️ APNG 生成失败:`, err.message);
    }
  }

  // 清理
  await fs.remove(unzipPath);
  return generatedActions;
}
