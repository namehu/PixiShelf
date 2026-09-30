/**
 * Pixiv 用户信息抓取器 - 高级浏览器脚本
 *
 * 这是一个用于批量下载 Pixiv 用户信息（特别是头像和背景图）并生成数据库更新语句的高级工具。
 * 它的设计风格和功能借鉴了 `extract-pixiv-info.js`。
 *
 * 主要功能:
 * - 数据持久化: 使用 localStorage 进行数据存储，进度可被安全保存。
 * - 断点续传: 您可以随时关闭标签页，稍后通过 `runTask()` 继续。
 * - 并发请求: 同时抓取多个用户信息，加快处理速度。
 * - 速率限制处理: 遇到 429 错误时会自动暂停，确保数据不丢失。
 * - 图片打包下载: 将所有用户的头像和背景图打包下载到一个 .zip 文件中，并按要求整理目录结构。
 * - SQL 生成: 可生成用于更新数据库用户头像和背景图 URL 的 SQL 文件。
 *
 * --- 使用方法 ---
 * 1.  在 Chrome/Firefox 中登录您的 Pixiv 帐户。
 * 2.  转到任意 Pixiv 页面（例如，首页）。
 * 3.  按 F12 打开开发者工具，然后转到“控制台”选项卡。
 * 4.  将整个脚本粘贴到控制台中。
 * 5.  在 `CONFIG.USER_IDS` 数组中配置您要抓取的用户 ID。
 * 6.  按 Enter 键运行脚本。这将为您设置好辅助函数。
 *
 * 7.  现在，您可以在控制台中使用以下命令：
 *
 * - `userScraper.runTask()`: 启动或恢复抓取过程。
 * - `userScraper.downloadImages()`: 将所有成功抓取的用户头像和背景图打包成 zip 文件并下载。
 * - `userScraper.generateUpdateSQL()`: 生成用于更新数据库的 SQL 文件。
 * - `userScraper.clearProgress()`: 清除所有已保存的进度，用于重新开始。
 * - `userScraper.checkProgress()`: 显示当前进度摘要。
 *
 * SQL:
 * --- 数据库查询用户ids ---
 * SELECT "externalId" FROM public.artist_external_refs WHERE "providerKey" = 'pixiv';
 */
(function () {
  // --- 第 1 部分: 配置 ---
  const CONFIG = {
    // === 重要: 在此处粘贴您的用户 ID ===
    USER_IDS: [
      // 在这里添加成千上万的 ID...
      // 例如: '77915733', '4338012', '1184620'
    ],
    // 抓取策略配置
    CONCURRENT_REQUESTS: 3,         // 并发请求数 (建议 2-4)
    MIN_DELAY_MS: 800,              // 每次请求后的最小随机等待时间 (毫秒)
    MAX_DELAY_MS: 3000,             // 每次请求后的最大随机等待时间 (毫秒)
    RATE_LIMIT_WAIT_MS: 60000,      // 遇到 429 错误后的固定等待时间 (毫秒)

    // 用于在 localStorage 中存储进度的键。
    STORAGE_KEY: 'pixiv_user_scraper_progress_v2',
    // 最终下载的 zip 文件的文件名。
    IMAGES_ZIP_FILENAME: 'pixiv_user_images.zip',
    // 生成的 SQL 文件的文件名。
    SQL_FILENAME: 'update_artists_images.sql',

    // [已更新] 根据您的表结构信息配置
    DB_TABLE_NAME: '"Artist"', // 你的表名
    DB_EXTERNAL_REF_TABLE_NAME: 'artist_external_refs', // 正式外部身份表
    DB_AVATAR_COL: '"avatar"', // 你的头像URL列名
    DB_BACKGROUND_COL: '"backgroundImg"' // 你的背景图URL列名
  };

  // --- 第 2 部分: 辅助库和函数 ---

  // 动态加载外部库
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  (async function loadDependencies() {
    try {
      if (!window.JSZip) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        console.log("✅ JSZip 库加载成功。");
      } else {
        console.log("JSZip 已加载。");
      }
    } catch (error) {
      console.error("❌ 依赖库加载失败:", error);
    }
  })();

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // --- 第 3 部分: 核心逻辑 ---

  /**
   * 获取并处理单个用户 ID 的数据。
   * @param {string} userId 用户 ID。
   * @returns {Promise<object>} 一个解析为已处理数据的 Promise。
   */
  async function processUserId(userId) {
    // [已更新] 使用您提供的带有 full=1 参数的 API 接口
    const apiUrl = `https://www.pixiv.net/ajax/user/${userId}?full=1&lang=zh`;
    const response = await fetch(apiUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (response.status === 429) {
      const error = new Error('HTTP 请求失败! 状态: 429');
      error.name = 'RateLimitError';
      throw error;
    }

    if (response.status === 404) {
      throw new Error(`用户 ID 不存在: ${userId}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP 请求失败! 状态: ${response.status}`);
    }

    const data = await response.json();

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`);
    }

    const body = data.body;

    // [已更新] 提取头像和背景图，优先使用 imageBig，并考虑为空的情况
    const avatarUrl = body.imageBig || body.image || null;
    const backgroundUrl = body.background?.url || null;

    return {
      userId: body.userId,
      name: body.name,
      avatarUrl: avatarUrl,
      backgroundUrl: backgroundUrl
    };
  }

  // --- 第 4 部分: 任务管理器 API 对象 ---
  const userScraper = {
    /**
     * 启动或恢复抓取任务的主函数。
     */
    async runTask() {
      console.log("%c🚀 开始或恢复 Pixiv 用户抓取任务...", "color: blue; font-size: 16px;");

      const allIds = [...new Set(CONFIG.USER_IDS)];
      let progress = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || {};

      while (true) {
        const completedIds = new Set(Object.keys(progress));
        const pendingIds = allIds.filter(id => !completedIds.has(`${id}`));

        if (pendingIds.length === 0) {
          console.log("%c✨ 所有用户均已处理完毕! 使用 `userScraper.downloadImages()` 来下载图片。", "color: green; font-size: 14px;");
          return;
        }

        console.log(`总计: ${allIds.length}, 已完成: ${completedIds.size}, 待处理: ${pendingIds.length}`);

        const batch = pendingIds.slice(0, CONFIG.CONCURRENT_REQUESTS);
        console.log(`--- 正在处理批次 (数量: ${batch.length}) ---`);

        const promises = batch.map(id =>
          processUserId(id)
            .then(data => ({ id, status: 'fulfilled', value: data }))
            .catch(error => ({ id, status: 'rejected', reason: error }))
        );

        const results = await Promise.all(promises);

        const rateLimitResult = results.find(r => r.status === 'rejected' && r.reason.name === 'RateLimitError');
        if (rateLimitResult) {
          console.error('%c🚫 触发速率限制 (429)!', 'color: red; font-weight: bold;');
          console.log(`%c将等待 ${CONFIG.RATE_LIMIT_WAIT_MS / 1000} 秒后重试...`, 'color: orange;');
          await delay(CONFIG.RATE_LIMIT_WAIT_MS);
          continue;
        }

        for (const result of results) {
          progress[result.id] = {
            status: result.status,
            data: result.status === 'fulfilled' ? result.value : result.reason.message
          };
        }
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(progress));

        const currentCompleted = Object.keys(progress).length;
        const randomDelay = Math.floor(Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS + 1)) + CONFIG.MIN_DELAY_MS;
        console.log(`%c批次完成。进度: ${currentCompleted} / ${allIds.length}. 将等待 ${(randomDelay / 1000).toFixed(1)} 秒...`, "color: purple;");
        await delay(randomDelay);
      }
    },

    /**
     * 下载所有成功获取的用户头像和背景图。
     */
    async downloadImages() {
      if (!window.JSZip) {
        console.error("❌ JSZip 库未加载。");
        return;
      }
      const progress = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || {};
      const successfulItems = Object.values(progress).filter(p => p.status === 'fulfilled' && p.data);

      if (successfulItems.length === 0) {
        console.log("没有可供下载的成功数据。");
        return;
      }

      console.log(`发现 ${successfulItems.length} 个用户的数据。开始准备下载图片...`);
      const zip = new JSZip();
      const rootFolder = zip.folder("artists");
      let downloadCount = 0;

      for (const { data: user } of successfulItems) {
        const userFolder = rootFolder.folder(user.userId);
        let hasDownloadedImage = false;

        // 下载头像
        if (user.avatarUrl) {
          try {
            const response = await fetch(user.avatarUrl);
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const blob = await response.blob();
            const extension = user.avatarUrl.split('.').pop().split('?')[0] || 'jpg';
            userFolder.file(`avatar.${extension}`, blob);
            console.log(`✅ [${user.userId}] 头像下载成功。`);
            hasDownloadedImage = true;
          } catch (error) {
            console.error(`❌ [${user.userId}] 头像下载失败:`, error.message);
          }
          await delay(Math.floor(Math.random() * 1000) + 300); // 轻微延迟避免请求过于集中
        }

        // 下载背景图
        if (user.backgroundUrl) {
          try {
            const response = await fetch(user.backgroundUrl);
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const blob = await response.blob();
            const extension = user.backgroundUrl.split('.').pop().split('?')[0] || 'jpg';
            userFolder.file(`background.${extension}`, blob);
            console.log(`✅ [${user.userId}] 背景图下载成功。`);
            hasDownloadedImage = true;
          } catch (error) {
            console.error(`❌ [${user.userId}] 背景图下载失败:`, error.message);
          }
          await delay(Math.floor(Math.random() * 1000) + 300); // 轻微延迟避免请求过于集中
        }

        if (hasDownloadedImage) downloadCount++;
      }

      if (downloadCount === 0) {
        console.log("没有任何图片被成功下载，不生成 zip 文件。");
        return;
      }

      console.log("正在生成 zip 文件，请稍候...");
      zip.generateAsync({ type: "blob" })
        .then(function (content) {
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = CONFIG.IMAGES_ZIP_FILENAME;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log(`%c📦 ${CONFIG.IMAGES_ZIP_FILENAME} 下载已开始!`, "color: green; font-size: 14px;");
        });
    },

    /**
     * 生成用于更新数据库用户图片 URL 的 SQL 文件。
     */
    generateUpdateSQL() {
      console.log("正在准备生成 SQL 更新文件...");
      const progress = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || {};
      const successfulItems = Object.values(progress).filter(p => p.status === 'fulfilled' && p.data);

      if (successfulItems.length === 0) {
        console.log("没有可供生成 SQL 的成功数据。");
        return;
      }

      const escapeSql = (str) => {
        if (str === null || typeof str === 'undefined') return "NULL";
        return `'${str.replace(/'/g, "''")}'`;
      }

      let sqlStatements = [
        '-- Pixiv Artist 图片 URL 更新脚本',
        '-- 生成时间: ' + new Date().toISOString(),
        '-- 路径为压缩包内的相对路径',
        ''
      ];

      for (const { data: user } of successfulItems) {
        // 仅当至少有一个URL有效时才生成UPDATE语句
        if (user.avatarUrl || user.backgroundUrl) {
          const updates = [];

          // 处理头像路径
          if (user.avatarUrl) {
            const extension = user.avatarUrl.split('.').pop().split('?')[0] || 'jpg';
            const localAvatarPath = `avatar.${extension}`;
            updates.push(`${CONFIG.DB_AVATAR_COL} = ${escapeSql(localAvatarPath)}`);
          }

          // 处理背景图路径
          // 如果 backgroundUrl 存在，则构建路径；否则，其值为 null
          const localBackgroundPath = user.backgroundUrl
            ? `background.${user.backgroundUrl.split('.').pop().split('?')[0] || 'jpg'}`
            : null;

          // 总是更新背景图字段，以便将没有背景的用户设置为 NULL
          updates.push(`${CONFIG.DB_BACKGROUND_COL} = ${escapeSql(localBackgroundPath)}`);

          sqlStatements.push(`UPDATE ${CONFIG.DB_TABLE_NAME} AS artist SET ${updates.join(', ')} FROM ${CONFIG.DB_EXTERNAL_REF_TABLE_NAME} AS ref WHERE ref."artistId" = artist.id AND ref."providerKey" = 'pixiv' AND ref."externalId" = ${escapeSql(user.userId)};`);
        }
      }

      if (sqlStatements.length <= 4) { // 检查是否有有效语句被添加
        console.log("没有找到需要更新的用户数据。");
        return;
      }

      const sqlContent = sqlStatements.join('\n');
      const blob = new Blob([sqlContent], { type: 'application/sql' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = CONFIG.SQL_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
      console.log(`%c📜 ${CONFIG.SQL_FILENAME} 文件已生成并开始下载!`, "color: green; font-size: 14px;");
    },

    /**
     * 从 localStorage 清除所有已保存的进度。
     */
    clearProgress() {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
      console.log(`%c🧹 进度已清除。您现在可以开始一个全新的任务。`, "color: orange; font-size: 14px;");
    },

    /**
     * 显示当前进度的摘要。
     */
    checkProgress() {
      const progress = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || {};
      const totalIds = new Set(CONFIG.USER_IDS).size;
      const completedCount = Object.keys(progress).length;
      const successCount = Object.values(progress).filter(p => p.status === 'fulfilled').length;
      const errorCount = completedCount - successCount;

      console.log("--- 用户抓取器进度 ---");
      console.log(`- 已处理 ${completedCount} / ${totalIds} 个 ID。`);
      console.log(`- ✅ 成功: ${successCount}`);
      console.log(`- ❌ 失败: ${errorCount}`);
      console.log("----------------------");
    }
  };

  // 将 API 对象暴露到全局作用域
  window.userScraper = userScraper;

  console.log(
    `%cPixiv 用户抓取器已初始化 (v2)
%c
--- 可用命令 ---
- userScraper.runTask():           启动或恢复抓取。
- userScraper.downloadImages():    下载所有用户的头像和背景图。
- userScraper.generateUpdateSQL(): 生成用于更新数据库的 SQL 文件。
- userScraper.checkProgress():     显示当前进度摘要。
- userScraper.clearProgress():     重置所有进度以重新开始。
--------------------------`,
    "color: #007acc; font-size: 20px; font-weight: bold;",
    "font-size: 12px;"
  );

})();
