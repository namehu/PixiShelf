const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000; // 使用标准的 Node.js 端口

// --- 从环境变量读取配置 ---
const CACHE_DURATION_SECONDS = parseInt(process.env.CACHE_DURATION_SECONDS || '86400', 10);
const SCAN_DIRECTORY = process.env.SCAN_DIRECTORY || '/app/data';

console.log(`缓存持续时间设置为 ${CACHE_DURATION_SECONDS} 秒`);
console.log(`扫描目录设置为 '${SCAN_DIRECTORY}'`);
// ---------------------------

// --- 缓存实现 ---
let fileCache = {
  data: [],
  lastUpdated: 0,
  isUpdating: false,
};
// -----------------

/**
 * 使用系统 `find` 命令来执行文件扫描。
 * @returns {Promise<string[] | null>} 返回一个 Promise，解析为文件路径列表或 null。
 */
function scanFilesWithFind() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SCAN_DIRECTORY) || !fs.statSync(SCAN_DIRECTORY).isDirectory()) {
      console.error(`错误：扫描目录 '${SCAN_DIRECTORY}' 不存在或不是目录`);
      resolve(null); // 目录不存在，解析为 null
      return;
    }

    const findProcess = spawn('find', ['-L', SCAN_DIRECTORY, '-type', 'f', '-name', '*-meta.txt']);

    let paths = '';
    let errorOutput = '';

    findProcess.stdout.on('data', (data) => {
      paths += data.toString();
    });

    findProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    findProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`'find' 命令退出，代码 ${code}：${errorOutput}`);
        resolve([]); // 出错时返回空数组
      } else {
        const pathList = paths.split('\n')
          .filter(Boolean)// 按行分割并移除空行
          .map(it => it.startsWith(SCAN_DIRECTORY) ? it.replace(SCAN_DIRECTORY, '') : it);
        resolve(pathList);
      }
    });

    findProcess.on('error', (err) => {
      console.error(`启动 'find' 进程失败：${err.message}`);
      resolve([]); // 进程启动失败
    });
  });
}

/**
 * 刷新缓存的函数
 */
async function refreshCache() {
  if (fileCache.isUpdating) {
    return;
  }

  console.log("开始使用 'find' 命令刷新缓存...");
  fileCache.isUpdating = true;

  const newData = await scanFilesWithFind();

  if (newData !== null) {
    fileCache.data = newData;
    fileCache.lastUpdated = Date.now() / 1000; // 使用秒为单位的时间戳
    console.log(`缓存刷新成功，共 ${newData.length} 个项目`);
  } else {
    console.log("缓存刷新失败：目录未找到");
  }

  fileCache.isUpdating = false;
}

// --- API 接口 ---

app.get('/metadata-files', async (req, res) => {
  const now = Date.now() / 1000;
  const cacheAge = now - fileCache.lastUpdated;
  const isExpired = cacheAge > CACHE_DURATION_SECONDS;

  // 如果缓存过期或为空，并且没有正在更新，则等待刷新完毕
  if ((isExpired || fileCache.data.length === 0) && !fileCache.isUpdating) {
    if (isExpired) {
      console.log(`缓存已过期（年龄：${cacheAge.toFixed(0)}秒）。等待缓存刷新完毕`);
    } else {
      console.log("缓存为空。触发初始同步扫描");
    }
    await refreshCache();
  }

  // 如果正在更新中，等待更新完成
  if (fileCache.isUpdating) {
    console.log("缓存正在更新中，等待更新完成");
    // 等待更新完成，最多等待30秒
    const maxWaitTime = 30000; // 30秒
    const startTime = Date.now();
    while (fileCache.isUpdating && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100)); // 等待100ms
    }
    
    if (fileCache.isUpdating) {
      console.log("等待缓存更新超时，返回当前缓存数据");
    }
  }

  // 返回最新的缓存数据
  res.json(fileCache.data);
});

app.get('/refresh', (req, res) => {
  if (fileCache.isUpdating) {
    return res.status(429).json({ message: "缓存更新已在进行中" });
  }

  refreshCache(); // 触发后台刷新
  res.status(202).json({ message: "缓存刷新已在后台启动" });
});


// --- 服务器启动 ---
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
