const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000; // 使用标准的 Node.js 端口

// --- 从环境变量读取配置 ---
const CACHE_DURATION_SECONDS = parseInt(process.env.CACHE_DURATION_SECONDS || '86400', 10);
const SCAN_DIRECTORY = process.env.SCAN_DIRECTORY || '/app/data';

console.log(`Cache duration is set to ${CACHE_DURATION_SECONDS} seconds.`);
console.log(`Scanning directory is set to '${SCAN_DIRECTORY}'.`);
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
      console.error(`Error: Scan directory '${SCAN_DIRECTORY}' not found or is not a directory.`);
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
        console.error(`'find' command exited with code ${code}: ${errorOutput}`);
        resolve([]); // 出错时返回空数组
      } else {
        const pathList = paths.split('\n')
          .filter(Boolean)// 按行分割并移除空行
          .map(it => it.startsWith(SCAN_DIRECTORY) ? it.replace(SCAN_DIRECTORY, '') : it);
        resolve(pathList);
      }
    });

    findProcess.on('error', (err) => {
      console.error(`Failed to start 'find' process: ${err.message}`);
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

  console.log("Starting cache refresh using 'find' command...");
  fileCache.isUpdating = true;

  const newData = await scanFilesWithFind();

  if (newData !== null) {
    fileCache.data = newData;
    fileCache.lastUpdated = Date.now() / 1000; // 使用秒为单位的时间戳
    console.log(`Cache refreshed successfully with ${newData.length} items.`);
  } else {
    console.log("Cache refresh failed: Directory not found.");
  }

  fileCache.isUpdating = false;
}

// --- API Endpoints ---

app.get('/metadata-files', async (req, res) => {
  const now = Date.now() / 1000;
  const cacheAge = now - fileCache.lastUpdated;
  const isExpired = cacheAge > CACHE_DURATION_SECONDS;

  // 如果缓存过期，并且没有正在更新，则在后台触发刷新
  if (isExpired && !fileCache.isUpdating) {
    console.log(`Cache expired (age: ${cacheAge.toFixed(0)}s). Triggering asynchronous refresh in the background.`);
    refreshCache(); // 不使用 await，让它在后台运行
  }

  // 如果缓存是空的（通常是服务首次启动），则同步等待一次刷新
  if (fileCache.data.length === 0 && !fileCache.isUpdating) {
    console.log("Cache is empty. Triggering initial synchronous scan.");
    await refreshCache();
  }

  // 总是立即返回缓存中的数据
  res.json(fileCache.data);
});

app.post('/refresh', (req, res) => {
  if (fileCache.isUpdating) {
    return res.status(429).json({ message: "Cache update already in progress." });
  }

  refreshCache(); // 触发后台刷新
  res.status(202).json({ message: "Cache refresh started in the background." });
});


// --- 服务器启动 ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // 启动时立即开始第一次缓存加载
  console.log("Performing initial cache scan on startup...");
  refreshCache();
});
