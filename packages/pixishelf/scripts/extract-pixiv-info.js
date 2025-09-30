/**
 * Pixiv 抓取器 - 高级浏览器脚本
 *
 * 这是一个用于批量下载 Pixiv 作品信息的高级工具。
 *
 * 主要功能:
 * - [升级] 使用 IndexedDB 进行数据存储，无惧海量数据，告别 localStorage 容量焦虑。
 * - 断点续传: 进度可被安全保存。您可以关闭标签页稍后继续。
 * - [新增] 任务暂停: 可以在任务进行中安全地暂停，并在之后恢复。
 * - 并发请求: 同时抓取多个作品，大大加快处理速度。
 * - 429 速率限制处理: 遇到 429 错误时会自动暂停，确保数据不丢失，可安全重试。
 * - ZIP 打包: 将所有作品数据和唯一的艺术家头像打包下载到一个 .zip 文件中。
 * - 艺术家信息: 除了标签外，还提取艺术家 ID、名称和头像 URL。
 * - 动态添加: 可在任务进行时动态添加新的作品ID。
 * - 高清头像: 优先下载高清版艺术家头像，失败则回退到普通版。
 * - SQL 生成: 可生成用于更新数据库标签翻译的 SQL 文件。
 *
 * --- 使用方法 ---
 * 1.  在 Chrome/Firefox 中登录您的 Pixiv 帐户。
 * 2.  转到任意 Pixiv 页面（例如，首页）。
 * 3.  按 F12 打开开发者工具，然后转到“控制台”选项卡。
 * 4.  将整个脚本粘贴到控制台中。
 * 5.  在 `CONFIG.ARTWORK_IDS` 数组中配置您要抓取的作品 ID (作为初始列表)。
 * 6.  按 Enter 键运行脚本。这将为您设置好辅助函数。
 *
 * 7.  现在，您可以在控制台中使用以下命令：
 *
 * - `pixivScraper.runTask()`: 启动或恢复抓取过程。
 * - `pixivScraper.addArtworkIds(['id1', 'id2'])`: 向任务列表中添加新的作品ID。
 * - `pixivScraper.downloadResults()`: 将所有成功抓取的数据打包成 zip 文件并下载。
 * - `pixivScraper.generateUpdateSQL()`: 生成用于更新数据库的 SQL 文件。
 * - `pixivScraper.clearProgress()`: 清除所有已保存的进度，用于重新开始。
 * - `pixivScraper.checkProgress()`: 显示当前进度摘要。
 *
 */
(function () {
  // --- 第 1 部分: 配置 ---
  const CONFIG = {
    // === 重要: 在此处粘贴您的初始作品 ID ===
    ARTWORK_IDS: [
      // 在这里添加成千上万的 ID...
    ],
    // [新] 稳定抓取策略配置
    CONCURRENT_REQUESTS: 2,         // 并发请求数 (建议 1-3)
    MIN_DELAY_MS: 1000,             // 每次请求后的最小随机等待时间 (毫秒)
    MAX_DELAY_MS: 5000,             // 每次请求后的最大随机等待时间 (毫秒)
    RATE_LIMIT_WAIT_MS: 60000,      // 遇到 429 错误后的固定等待时间 (毫秒)

    // [升级] 用于在 IndexedDB 中存储进度的键。
    STORAGE_KEY: 'pixiv_scraper_progress_v3',
    // [升级] 用于在 IndexedDB 中存储所有任务ID的键。
    IDS_STORAGE_KEY: 'pixiv_scraper_ids_v3',
    // 最终下载的 zip 文件的文件名。
    ZIP_FILENAME: 'pixiv_data.zip',
    // 生成的 SQL 文件的文件名。
    SQL_FILENAME: 'update_pixiv_tags.sql'
  };

  // [新增] 用于控制任务暂停的状态变量
  let isPaused = false;

  // --- 第 2 部分: 辅助库和函数 ---

  // 动态加载外部库
  function loadScript(src, integrity, crossOrigin) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      if (integrity) script.integrity = integrity;
      if (crossOrigin) script.crossOrigin = crossOrigin;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  (async function loadDependencies() {
    try {
      // [新增] 加载 localForage 用于 IndexedDB 存储
      if (!window.localforage) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js');
        console.log("✅ localForage (IndexedDB 库) 加载成功。");
      } else {
        console.log("localForage 已加载。");
      }
      // 加载 JSZip
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
   * 获取并处理单个作品 ID 的数据。
   * @param {string} id 作品 ID。
   * @returns {Promise<object>} 一个解析为已处理数据的 Promise。
   */
  async function processArtworkId(id) {
    const apiUrl = `https://www.pixiv.net/ajax/illust/${id}?lang=zh`;
    const response = await fetch(apiUrl, {
      headers: {
        'accept': 'application/json'
      }
    });

    // 精确处理 429 速率限制错误
    if (response.status === 429) {
      const error = new Error('HTTP 请求失败! 状态: 429');
      error.name = 'RateLimitError'; // 自定义错误类型
      throw error;
    }

    if (!response.ok) {
      throw new Error(`HTTP 请求失败! 状态: ${response.status}`);
    }

    const data = await response.json();

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`);
    }

    // --- 数据提取 ---
    const body = data.body;

    // 提取标签和翻译
    const tags = body.tags?.tags.map(tag => ({
      tag: tag.tag,
      translation: tag.translation?.en,
    })) || [];

    // 提取艺术家信息
    let artistInfo = {
      userId: body.userId || null,
      userName: body.userName || null,
      profileImageUrl: null
    };

    // 找到第一个有效的用户作品对象以获取头像 URL
    if (body.userIllusts) {
      const firstValidIllust = Object.values(body.userIllusts).find(illust => illust !== null);
      if (firstValidIllust && firstValidIllust.profileImageUrl) {
        artistInfo.profileImageUrl = firstValidIllust.profileImageUrl;
      }
    }

    return {
      id: id,
      title: body.illustTitle,
      tags: tags,
      artist: artistInfo
    };
  }


  // --- 第 4 部分: 任务管理器 API 对象 ---
  const pixivScraper = {
    /**
     * 启动或恢复抓取任务的主函数。
     */
    async runTask() {
      if (!window.localforage) {
        console.error("localForage 库尚未加载，请稍后重试。");
        return;
      }
      // [修改] 每次运行时重置暂停状态，意味着 runTask 兼具“开始”和“恢复”功能
      isPaused = false;
      console.log("%c🚀 开始或恢复 Pixiv 抓取任务 (稳定模式)...", "color: blue; font-size: 16px;");

      // [升级] 从 IndexedDB 读取和写入 ID
      const storedIds = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || [];
      const initialIds = CONFIG.ARTWORK_IDS;
      const allIdsSet = new Set([...storedIds, ...initialIds]);
      await localforage.setItem(CONFIG.IDS_STORAGE_KEY, [...allIdsSet]);

      const allIds = [...allIdsSet];
      let progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};

      while (true) {
        if (isPaused) {
          console.log('%c✅ 任务已应请求安全暂停。', 'color: green; font-weight: bold;');
          return;
        }

        const completedIds = new Set(Object.keys(progress));
        const pendingIds = allIds.filter(id => !completedIds.has(`${id}`));

        if (pendingIds.length === 0) {
          console.log("%c✨ 所有作品均已处理完毕! 使用 `pixivScraper.downloadResults()` 来保存。", "color: green; font-size: 14px;");
          return;
        }

        console.log(`总计: ${allIds.length}, 已完成: ${completedIds.size}, 待处理: ${pendingIds.length}`);

        const batch = pendingIds.slice(0, CONFIG.CONCURRENT_REQUESTS);
        console.log(`--- 正在处理批次 (数量: ${batch.length}) ---`);

        const promises = batch.map(id =>
          processArtworkId(id)
            .then(data => ({
              id,
              status: 'fulfilled',
              value: data
            }))
            .catch(error => ({
              id,
              status: 'rejected',
              reason: error // 将完整的 error 对象传递下去
            }))
        );

        const results = await Promise.all(promises);

        const rateLimitResult = results.find(r => r.status === 'rejected' && r.reason.name === 'RateLimitError');
        if (rateLimitResult) {
          console.error('%c🚫 触发速率限制 (429)!', 'color: red; font-weight: bold;');
          console.log(`%c将等待 ${CONFIG.RATE_LIMIT_WAIT_MS / 1000} 秒后重试...`, 'color: orange;');
          await delay(CONFIG.RATE_LIMIT_WAIT_MS);
          continue; // 重新开始循环，重试同一个批次
        }

        // [修复] 直接在内存中的 progress 对象上更新，而不是重新获取
        for (const result of results) {
          progress[result.id] = {
            status: result.status,
            data: result.status === 'fulfilled' ? result.value : result.reason.message
          };
        }
        await localforage.setItem(CONFIG.STORAGE_KEY, progress);

        const currentCompleted = Object.keys(progress).length;

        // [新增] 检查暂停信号
        if (isPaused) {
          console.log(`%c批次 ${Object.keys(batches).length + 1} 完成。进度: ${currentCompleted} / ${allIds.length}`, "color: purple;");
          console.log('%c✅ 任务已应请求安全暂停。', 'color: green; font-weight: bold;');
          return; // 退出循环和函数
        }

        const randomDelay = Math.floor(Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS + 1)) + CONFIG.MIN_DELAY_MS;
        console.log(`%c批次完成。进度: ${currentCompleted} / ${allIds.length}. 将等待 ${(randomDelay / 1000).toFixed(1)} 秒...`, "color: purple;");
        await delay(randomDelay);

      }
    },

    /**
     * [新增] 请求暂停任务。任务将在当前批次完成后停止。
     */
    pauseTask() {
      console.log('%c⏸️ 请求暂停...', 'color: orange; font-size: 16px;');
      console.log('任务将在当前批次完成后暂停。要恢复，请再次运行 `pixivScraper.runTask()`。');
      isPaused = true;
    },

    /**
     * 将所有成功获取的数据和唯一的艺术家头像下载为单个 zip 文件。
     */
    async downloadResults() {
      if (!window.JSZip || !window.localforage) {
        console.error("❌ 依赖库 (JSZip or localForage) 未加载。");
        return;
      }
      // [升级] 从 IndexedDB 读取进度
      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const successfulItems = Object.values(progress).filter(p => p.status === 'fulfilled' && p.data);

      if (successfulItems.length === 0) {
        console.log("没有可供下载的成功数据。");
        return;
      }

      console.log(`正在打包 ${successfulItems.length} 个作品数据文件...`);
      const zip = new JSZip();
      const artworksFolder = zip.folder("artworks");
      const artistsFolder = zip.folder("artists");

      const uniqueArtists = new Map();

      for (const { data: artwork } of successfulItems) {
        artworksFolder.file(`${artwork.id}.json`, JSON.stringify(artwork, null, 2));

        const artist = artwork.artist;
        if (artist && artist.userId && artist.profileImageUrl && !uniqueArtists.has(artist.userId)) {
          uniqueArtists.set(artist.userId, artist.profileImageUrl);
        }
      }

      console.log(`发现 ${uniqueArtists.size} 位独立艺术家。正在下载头像...`);

      const imagePromises = Array.from(uniqueArtists.entries()).map(async ([userId, originalUrl]) => {
        const highResUrl = originalUrl.replace(/_50\.(?=[^.]*$)/, '_170.');
        try {
          let response = await fetch(highResUrl);
          if (!response.ok) {
            console.log(`高清头像 for artist ${userId} 下载失败, 尝试原始尺寸...`);
            response = await fetch(originalUrl);
            if (!response.ok) throw new Error(`原始尺寸头像也下载失败. Status: ${response.status}`);
          }
          const blob = await response.blob();
          const extension = (highResUrl.split('.').pop().split('?')[0] || 'jpg');
          artistsFolder.file(`${userId}.${extension}`, blob);
          console.log(`✅ 成功下载艺术家 ${userId} 的头像`);
        } catch (error) {
          console.error(`❌ 下载艺术家 ${userId} 的头像失败:`, error.message);
        }
      });

      await Promise.all(imagePromises);

      console.log("正在生成 zip 文件，请稍候...");
      zip.generateAsync({ type: "blob" })
        .then(function (content) {
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = CONFIG.ZIP_FILENAME;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log(`%c📦 ${CONFIG.ZIP_FILENAME} 下载已开始!`, "color: green; font-size: 14px;");
        });
    },

    /**
     * [简化] 生成用于更新数据库标签翻译的 SQL 文件。
     */
    async generateUpdateSQL() {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      console.log("正在准备生成 SQL 更新文件...");

      // [升级] 从 IndexedDB 读取进度
      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const successfulItems = Object.values(progress).filter(p => p.status === 'fulfilled' && p.data);

      if (successfulItems.length === 0) {
        console.log("没有可供生成 SQL 的成功数据。");
        return;
      }

      const uniqueTags = new Map();
      for (const { data: artwork } of successfulItems) {
        if (artwork.tags) {
          for (const tag of artwork.tags) {
            if (tag.tag && tag.translation && !uniqueTags.has(tag.tag)) {
              uniqueTags.set(tag.tag, tag.translation);
            }
          }
        }
      }

      const escapeSql = (str) => str.replace(/'/g, "''");
      let sqlStatements = ['-- Pixiv 标签翻译更新脚本', '-- 生成时间: ' + new Date().toISOString(), '', '-- 更新标签翻译 (Tag.name_zh)'];

      for (const [name, translation] of uniqueTags.entries()) {
        sqlStatements.push(`UPDATE "Tag" SET "name_zh" = '${escapeSql(translation)}' WHERE "name" = '${escapeSql(name)}';`);
      }

      if (sqlStatements.length <= 4) {
        console.log("没有找到需要更新翻译的标签。");
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
     * 向任务列表中动态添加新的作品 ID。
     */
    async addArtworkIds(newIds) {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      if (!Array.isArray(newIds) || newIds.length === 0) {
        console.log("请输入一个有效的作品 ID 数组。");
        return;
      }
      // [升级] 从 IndexedDB 读取和写入 ID
      const storedIds = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || [];
      const combinedIds = new Set([...storedIds, ...newIds]);
      await localforage.setItem(CONFIG.IDS_STORAGE_KEY, [...combinedIds]);

      console.log(`%c✅ 已成功添加 ${newIds.length} 个新 ID。`, "color: green;");
      console.log("请重新运行 `pixivScraper.runTask()` 来处理新增的作品。");
    },

    /**
     * 从 IndexedDB 清除所有已保存的进度。
     */
    async clearProgress() {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      // [升级] 从 IndexedDB 移除
      await localforage.removeItem(CONFIG.STORAGE_KEY);
      await localforage.removeItem(CONFIG.IDS_STORAGE_KEY);
      console.log(`%c🧹 进度和ID列表已清除。您现在可以开始一个全新的任务。`, "color: orange; font-size: 14px;");
    },

    /**
     * 显示当前进度的摘要。
     */
    async checkProgress() {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      // [升级] 从 IndexedDB 读取
      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const allIds = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || CONFIG.ARTWORK_IDS;
      const totalIds = new Set(allIds).size;
      const completedCount = Object.keys(progress).length;
      const successCount = Object.values(progress).filter(p => p.status === 'fulfilled').length;
      const errorCount = completedCount - successCount;

      console.log("--- 抓取器进度 ---");
      console.log(`- 已处理 ${completedCount} / ${totalIds} 个 ID。`);
      console.log(`- ✅ 成功: ${successCount}`);
      console.log(`- ❌ 失败: ${errorCount}`);
      console.log("----------------------");
    }
  };

  // 将 API 对象暴露到全局作用域
  window.pixivScraper = pixivScraper;

  console.log(
    `%cPixiv 抓取器已初始化
%c
--- 可用命令 ---
- pixivScraper.runTask():                      启动或恢复抓取。
- pixivScraper.pauseTask():                    安全地暂停当前任务。
- pixivScraper.addArtworkIds(['id1', 'id2']):  向任务列表添加新ID。
- pixivScraper.downloadResults():              将所有成功的结果下载为 zip 文件。
- pixivScraper.generateUpdateSQL():            生成用于更新数据库的 SQL 文件。
- pixivScraper.checkProgress():                显示当前进度摘要。
- pixivScraper.clearProgress():                  重置所有进度以重新开始。
--------------------------`,
    "color: #007acc; font-size: 20px; font-weight: bold;",
    "font-size: 12px;"
  );

})();

