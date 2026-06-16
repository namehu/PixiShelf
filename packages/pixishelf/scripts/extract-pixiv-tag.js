/**
 * Pixiv 标签翻译抓取器 - 高级浏览器脚本 (功能增强版)
 *
 * 这是一个用于批量抓取 Pixiv 标签官方中文/英文翻译、摘要信息和封面图的工具，并生成数据库更新脚本。
 *
 * 主要功能:
 * - [增强] 提取中、英文翻译、摘要(abstract)和封面图URL(image)。
 * - [新增] 支持批量下载所有标签的封面图，并按 `tags/标签名/文件名` 的结构打包成 zip 文件。
 * - 使用 IndexedDB 进行数据存储，支持海量标签，无惧浏览器关闭。
 * - 断点续传: 进度会被自动保存，您可以随时关闭标签页并在之后继续。
 * - 任务暂停: 可以在任务进行中安全地暂停，并在之后恢复。
 * - 并发请求与随机延迟: 并行处理多个标签，同时通过随机延迟避免被服务器限制。
 * - 429 速率限制处理: 遇到 429 错误时会自动暂停，并在指定时间后重试。
 * - SQL 生成: 可根据抓取结果生成用于更新数据库 `Tag` 表中 `name_zh`, `name_en`, `abstract`, `image` 等字段的 SQL 文件。
 * - 动态添加: 可在任务进行时动态添加新的标签名。
 *
 * --- 使用方法 ---
 * 1.  在 Chrome/Firefox 中登录您的 Pixiv 帐户。
 * 2.  转到任意 Pixiv 页面（例如，首页）。
 * 3.  按 F12 打开开发者工具，然后转到“控制台”选项卡。
 * 4.  将整个脚本粘贴到控制台中。
 * 5.  在 `CONFIG.TAG_NAMES` 数组中配置您要抓取的标签名 (作为初始列表)。
 * 6.  按 Enter 键运行脚本。这将为您设置好所有功能。
 *
 * 7.  现在，您可以在控制台中使用以下命令：
 *
 * - `pixivTagTranslator.runTask()`: 启动或恢复抓取过程。
 * - `pixivTagTranslator.pauseTask()`: 安全地暂停当前任务。
 * - `pixivTagTranslator.addTagNames(['タグ1', 'タグ2'])`: 向任务列表中添加新的标签名。
 * - `pixivTagTranslator.generateUpdateSQL()`: 生成用于更新数据库的 SQL 文件并下载。
 * - `pixivTagTranslator.downloadTagImages()`: [新增] 下载所有标签封面图的 zip 压缩包。
 * - `pixivTagTranslator.clearProgress()`: 清除所有已保存的进度和标签列表，用于重新开始。
 * - `pixivTagTranslator.checkProgress()`: 显示当前进度摘要。
 *
 */
(function () {
  // --- 第 1 部分: 配置 ---
  const CONFIG = {
    // === 重要: 在此处粘贴您的初始标签名列表 ===
    TAG_NAMES: [
      // 例如: 'Genshin Impact'
      // 在这里添加成千上万的标签名...
    ],
    // 稳定抓取策略配置
    CONCURRENT_REQUESTS: 3,         // 并发请求数 (建议 1-3)
    MIN_DELAY_MS: 1000,             // 每次请求后的最小随机等待时间 (毫秒)
    MAX_DELAY_MS: 4000,             // 每次请求后的最大随机等待时间 (毫秒)
    RATE_LIMIT_WAIT_MS: 60000,      // 遇到 429 错误后的固定等待时间 (毫秒)

    // 用于在 IndexedDB 中存储进度的键。
    STORAGE_KEY: 'pixiv_tag_translator_progress_v1',
    // 用于在 IndexedDB 中存储所有任务标签的键。
    IDS_STORAGE_KEY: 'pixiv_tag_translator_ids_v1',
    // 生成的 SQL 文件的文件名。
    SQL_FILENAME: 'update_pixiv_tag_translations.sql',
    // [新增] 生成的标签图片压缩包的文件名。
    TAG_IMAGES_ZIP_FILENAME: 'pixiv_tag_images.zip'
  };

  // 用于控制任务暂停的状态变量
  let isPaused = false;

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
      // 加载 localForage 用于 IndexedDB 存储
      if (!window.localforage) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js');
        console.log("✅ localForage (IndexedDB 库) 加载成功。");
      } else {
        console.log("localForage 已加载。");
      }
      // 加载 JSZip 用于打包
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
   * [已增强] 获取并处理单个标签名的翻译和附加数据。
   * @param {string} tagName 原始标签名。
   * @returns {Promise<object>} 一个解析为已处理数据的 Promise。
   */
  async function processTagName(tagName) {
    const apiUrl = `https://www.pixiv.net/ajax/search/tags/${encodeURIComponent(tagName)}?lang=zh`;
    const response = await fetch(apiUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (response.status === 429) {
      const error = new Error('HTTP 请求失败! 状态: 429');
      error.name = 'RateLimitError';
      throw error;
    }

    if (!response.ok) {
      throw new Error(`HTTP 请求失败! 状态: ${response.status} for tag: ${tagName}`);
    }

    const data = await response.json();

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`);
    }

    // --- 数据提取 ---
    const body = data.body;
    const translationData = body.tagTranslation?.[tagName];
    const pixpedia = body.pixpedia || {};

    // 提取中文和英文翻译
    const chineseTranslation = translationData?.zh;
    const englishTranslation = translationData?.en;

    // 提取 abstract 和 image
    const abstract = pixpedia.abstract;
    const imageUrl = pixpedia.image;

    return {
      originalTag: tagName,
      translation: chineseTranslation || null,
      englishTranslation: englishTranslation || null,
      abstract: abstract || null,
      imageUrl: imageUrl || null
    };
  }

  // --- 第 4 部分: 任务管理器 API 对象 ---
  const pixivTagTranslator = {
    /**
     * 启动或恢复抓取任务的主函数。
     */
    async runTask() {
      if (!window.localforage) {
        console.error("localForage 库尚未加载，请稍后重试。");
        return;
      }
      isPaused = false;
      console.log("%c🚀 开始或恢复 Pixiv 标签翻译抓取任务...", "color: blue; font-size: 16px;");

      // 从 IndexedDB 读取和写入标签列表
      const storedTags = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || [];
      const initialTags = CONFIG.TAG_NAMES;
      const allTagsSet = new Set([...storedTags, ...initialTags]);
      await localforage.setItem(CONFIG.IDS_STORAGE_KEY, [...allTagsSet]);

      const allTags = [...allTagsSet];
      let progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};

      while (true) {
        if (isPaused) {
          console.log('%c✅ 任务已应请求安全暂停。', 'color: green; font-weight: bold;');
          return;
        }

        const completedTags = new Set(Object.keys(progress));
        const pendingTags = allTags.filter(tag => !completedTags.has(tag));

        if (pendingTags.length === 0) {
          console.log("%c✨ 所有标签均已处理完毕! 使用 `pixivTagTranslator.generateUpdateSQL()` 来生成 SQL 文件。", "color: green; font-size: 14px;");
          return;
        }

        console.log(`总计: ${allTags.length}, 已完成: ${completedTags.size}, 待处理: ${pendingTags.length}`);

        const batch = pendingTags.slice(0, CONFIG.CONCURRENT_REQUESTS);
        console.log(`--- 正在处理批次 (数量: ${batch.length}) ---`);

        const promises = batch.map(tag =>
          processTagName(tag)
            .then(data => ({ id: tag, status: 'fulfilled', value: data }))
            .catch(error => ({ id: tag, status: 'rejected', reason: error }))
        );

        const results = await Promise.all(promises);

        const rateLimitResult = results.find(r => r.status === 'rejected' && r.reason.name === 'RateLimitError');
        if (rateLimitResult) {
          console.error('%c🚫 触发速率限制 (429)!', 'color: red; font-weight: bold;');
          console.log(`%c将等待 ${CONFIG.RATE_LIMIT_WAIT_MS / 1000} 秒后重试...`, 'color: orange;');
          await delay(CONFIG.RATE_LIMIT_WAIT_MS);
          continue; // 重新开始循环，重试同一个批次
        }

        // 直接在内存中的 progress 对象上更新，然后一次性写入存储
        for (const result of results) {
          progress[result.id] = {
            status: result.status,
            data: result.status === 'fulfilled' ? result.value : result.reason.message
          };
        }
        await localforage.setItem(CONFIG.STORAGE_KEY, progress);

        const currentCompleted = Object.keys(progress).length;

        if (isPaused) {
          console.log(`%c批次完成。进度: ${currentCompleted} / ${allTags.length}`, "color: purple;");
          console.log('%c✅ 任务已应请求安全暂停。', 'color: green; font-weight: bold;');
          return;
        }

        const randomDelay = Math.floor(Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS + 1)) + CONFIG.MIN_DELAY_MS;
        console.log(`%c批次完成。进度: ${currentCompleted} / ${allTags.length}. 将等待 ${(randomDelay / 1000).toFixed(1)} 秒...`, "color: purple;");
        await delay(randomDelay);
      }
    },

    /**
     * 请求暂停任务。
     */
    pauseTask() {
      console.log('%c⏸️ 请求暂停...', 'color: orange; font-size: 16px;');
      console.log('任务将在当前批次完成后暂停。要恢复，请再次运行 `pixivTagTranslator.runTask()`。');
      isPaused = true;
    },

    /**
     * [已增强] 生成用于更新数据库标签翻译及附加信息的 SQL 文件。
     */
    async generateUpdateSQL() {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      console.log("正在准备生成 SQL 更新文件...");

      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const successfulItems = Object.values(progress).filter(p => p.status === 'fulfilled' && p.data);

      if (successfulItems.length === 0) {
        console.log("没有可供生成 SQL 的成功数据。");
        return;
      }

      // 使用 Map 确保每个标签只生成一条唯一的更新语句
      const uniqueTagData = new Map();
      for (const { data } of successfulItems) {
        if (data.originalTag) {
          uniqueTagData.set(data.originalTag, data);
        }
      }

      if (uniqueTagData.size === 0) {
        console.log("没有找到有效的标签数据来生成SQL。");
        return;
      }

      const escapeSql = (str) => str.replace(/'/g, "''");
      let sqlStatements = ['-- Pixiv 标签数据更新脚本', '-- 生成时间: ' + new Date().toISOString(), ''];
      let updateCount = 0;

      for (const data of uniqueTagData.values()) {
        const setClauses = [];
        const name = escapeSql(data.originalTag);
        // 动态构建 SET 子句
        if (!!data.translation || !!data.englishTranslation) {
          setClauses.push(`"translateType" = 'PIXIV'`); // 绑定翻译来源
        }
        if (data.translation) {
          setClauses.push(`"name_zh" = '${escapeSql(data.translation)}'`);
        }
        if (data.englishTranslation) {
          setClauses.push(`"name_en" = '${escapeSql(data.englishTranslation)}'`);
        }
        if (data.abstract) {
          setClauses.push(`"abstract" = '${escapeSql(data.abstract)}'`);
        }
        if (data.imageUrl) {
          const imageUrl = data.imageUrl.split('/').pop();
          setClauses.push(`"image" = '/${escapeSql(imageUrl)}'`);
        }

        if (setClauses.length > 0) {
          const sql = `UPDATE "Tag" SET ${setClauses.join(', ')} WHERE "name" = '${name}';`;
          sqlStatements.push(sql);
          updateCount++;
        }
      }

      if (updateCount === 0) {
        console.log("没有需要更新的字段，不生成 SQL 文件。");
        return;
      }

      const sqlContent = sqlStatements.join('\n');
      const blob = new Blob([sqlContent], { type: 'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = CONFIG.SQL_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
      console.log(`%c📜 ${CONFIG.SQL_FILENAME} 文件已生成并开始下载! 包含 ${updateCount} 条更新语句。`, "color: green; font-size: 14px;");
    },

    /**
     * [新增] 批量下载所有标签的封面图。
     */
    async downloadTagImages() {
      if (!window.JSZip || !window.localforage) {
        console.error("❌ 依赖库 (JSZip or localForage) 未加载。");
        return;
      }
      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const successfulItems = Object.values(progress).filter(p => p.status === 'fulfilled' && p.data && p.data.imageUrl);

      if (successfulItems.length === 0) {
        console.log("没有找到带有封面图的标签可供下载。");
        return;
      }

      console.log(`发现 ${successfulItems.length} 个带封面图的标签。开始下载...`);
      const zip = new JSZip();
      const rootFolder = zip.folder("tags");
      let successCount = 0;

      for (const { data } of successfulItems) {
        try {
          const response = await fetch(data.imageUrl);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const blob = await response.blob();

          // 从URL中提取文件名
          const fileName = data.imageUrl.split('/').pop().split('?')[0];
          rootFolder.file(fileName, blob);

          successCount++;
          console.log(`✅ (${successCount}/${successfulItems.length}) 成功下载标签 "${data.originalTag}" 的封面图。`);

        } catch (error) {
          console.error(`❌ 下载标签 "${data.originalTag}" 的封面图失败:`, error.message);
        }
        // 每次下载后随机延迟，避免对图片服务器造成太大压力
        await delay(Math.random() * 500 + 200);
      }

      if (successCount === 0) {
        console.log("所有封面图均下载失败，不生成 zip 文件。");
        return;
      }

      console.log(`正在生成 ${CONFIG.TAG_IMAGES_ZIP_FILENAME} 文件，请稍候...`);
      zip.generateAsync({ type: "blob" })
        .then(function (content) {
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = CONFIG.TAG_IMAGES_ZIP_FILENAME;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log(`%c📦 ${CONFIG.TAG_IMAGES_ZIP_FILENAME} 下载已开始!`, "color: green; font-size: 14px;");
        });
    },

    /**
     * 向任务列表中动态添加新的标签名。
     */
    async addTagNames(newTags) {
      // ... 此函数业务逻辑未改变，保持原样 ...
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      if (!Array.isArray(newTags) || newTags.length === 0) {
        console.log("请输入一个有效的标签名数组。");
        return;
      }
      const storedTags = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || [];
      const combinedTags = new Set([...storedTags, ...newTags]);
      await localforage.setItem(CONFIG.IDS_STORAGE_KEY, [...combinedTags]);

      console.log(`%c✅ 已成功添加 ${newTags.length} 个新标签。`, "color: green;");
      console.log("请重新运行 `pixivTagTranslator.runTask()` 来处理新增的标签。");
    },

    /**
   * [新增] 筛选失败的数据，并可选择性删除。
   * @param {string} stringReg - 用于匹配错误消息的正则表达式字符串。如果为空或null，则匹配所有失败项。
   * @param {boolean} isDel - 如果为 true，则从进度中删除匹配的失败项。
   * @returns {Promise<string[]>} 一个解析为匹配到的任务 ID 数组的 Promise。
   */
    async filterFailedData(stringReg, isDel = false) {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return [];
      }
      console.log(`正在筛选失败的数据... Regex: /${stringReg}/, 删除: ${isDel}`);

      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const failedIds = [];
      let regex;

      try {
        if (stringReg) {
          regex = new RegExp(stringReg);
        }
      } catch (e) {
        console.error("❌ 无效的正则表达式:", e.message);
        return [];
      }

      for (const [id, result] of Object.entries(progress)) {
        if (result.status === 'rejected') {
          // 确保 result.data 是字符串类型以避免 .test() 方法出错
          const errorMessage = typeof result.data === 'string' ? result.data : '';
          if (!stringReg || (regex && regex.test(errorMessage))) {
            failedIds.push(id);
          }
        }
      }

      if (failedIds.length === 0) {
        console.log("没有找到匹配条件的失败数据。");
        return [];
      }

      if (isDel) {
        console.log(`找到 ${failedIds.length} 个匹配项，准备删除...`);
        for (const id of failedIds) {
          delete progress[id];
        }
        await localforage.setItem(CONFIG.STORAGE_KEY, progress);
        console.log(`✅ 已成功删除 ${failedIds.length} 条失败记录。`);
      } else {
        console.log(`✅ 找到 ${failedIds.length} 个匹配的失败ID:`, failedIds);
      }

      return failedIds;
    },
    /**
     * 从 IndexedDB 清除所有已保存的进度和标签列表。
     */
    async clearProgress() {
      // ... 此函数业务逻辑未改变，保持原样 ...
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      await localforage.removeItem(CONFIG.STORAGE_KEY);
      await localforage.removeItem(CONFIG.IDS_STORAGE_KEY);
      console.log(`%c🧹 进度和标签列表已清除。您现在可以开始一个全新的任务。`, "color: orange; font-size: 14px;");
    },

    /**
     * 显示当前进度的摘要。
     */
    async checkProgress() {
      // ... 此函数业务逻辑未改变，保持原样 ...
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      const progress = (await localforage.getItem(CONFIG.STORAGE_KEY)) || {};
      const allTags = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || CONFIG.TAG_NAMES;
      const totalTags = new Set(allTags).size;
      const completedCount = Object.keys(progress).length;
      const successCount = Object.values(progress).filter(p => p.status === 'fulfilled').length;
      const errorCount = completedCount - successCount;

      console.log("--- 标签翻译抓取器进度 ---");
      console.log(`- 已处理 ${completedCount} / ${totalTags} 个标签。`);
      console.log(`- ✅ 成功: ${successCount}`);
      console.log(`- ❌ 失败: ${errorCount}`);
      console.log("--------------------------");
    }
  };

  // 将 API 对象暴露到全局作用域
  window.pixivTagTranslator = pixivTagTranslator;

  console.log(
    `%cPixiv 标签翻译抓取器已初始化 (增强版)
%c
--- 可用命令 ---
- pixivTagTranslator.runTask():                 启动或恢复抓取。
- pixivTagTranslator.pauseTask():               安全地暂停当前任务。
- pixivTagTranslator.addTagNames(['tag1']):     向任务列表添加新标签。
- pixivTagTranslator.generateUpdateSQL():       生成用于更新数据库的 SQL 文件。
- pixivTagTranslator.downloadTagImages():       [新增] 下载所有标签封面图。
- pixivTagTranslator.checkProgress():           显示当前进度摘要。
- pixivTagTranslator.clearProgress():             重置所有进度以重新开始。
--------------------------`,
    "color: #007acc; font-size: 20px; font-weight: bold;",
    "font-size: 12px;"
  );

})();
