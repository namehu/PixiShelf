/**
 * Pixiv 标签翻译抓取器 - 高级浏览器脚本
 *
 * 这是一个用于批量抓取 Pixiv 标签官方中文翻译的工具，并生成数据库更新脚本。
 * 它的代码结构和设计模式与 `extract-pixiv-info.js` 脚本保持一致。
 *
 * 主要功能:
 * - 使用 IndexedDB 进行数据存储，支持海量标签，无惧浏览器关闭。
 * - 断点续传: 进度会被自动保存，您可以随时关闭标签页并在之后继续。
 * - 任务暂停: 可以在任务进行中安全地暂停，并在之后恢复。
 * - 并发请求与随机延迟: 并行处理多个标签，同时通过随机延迟避免被服务器限制。
 * - 429 速率限制处理: 遇到 429 错误时会自动暂停，并在指定时间后重试。
 * - SQL 生成: 可根据抓取结果生成用于更新数据库 `Tag` 表中 `name_zh` 字段的 SQL 文件。
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
 * - `pixivTagTranslator.clearProgress()`: 清除所有已保存的进度和标签列表，用于重新开始。
 * - `pixivTagTranslator.checkProgress()`: 显示当前进度摘要。
 *
 *  * SQL:
 * --- 数据库查询用户ids ---
 * SELECT "name" FROM public."Tag";
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
    CONCURRENT_REQUESTS: 2,         // 并发请求数 (建议 1-3)
    MIN_DELAY_MS: 1000,             // 每次请求后的最小随机等待时间 (毫秒)
    MAX_DELAY_MS: 4000,             // 每次请求后的最大随机等待时间 (毫秒)
    RATE_LIMIT_WAIT_MS: 60000,      // 遇到 429 错误后的固定等待时间 (毫秒)

    // 用于在 IndexedDB 中存储进度的键。
    STORAGE_KEY: 'pixiv_tag_translator_progress_v1',
    // 用于在 IndexedDB 中存储所有任务标签的键。
    IDS_STORAGE_KEY: 'pixiv_tag_translator_ids_v1',
    // 生成的 SQL 文件的文件名。
    SQL_FILENAME: 'update_pixiv_tag_translations.sql'
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
    } catch (error) {
      console.error("❌ 依赖库加载失败:", error);
    }
  })();

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // --- 第 3 部分: 核心逻辑 ---

  /**
   * 获取并处理单个标签名的翻译数据。
   * @param {string} tagName 原始标签名。
   * @returns {Promise<object>} 一个解析为已处理数据的 Promise。
   */
  async function processTagName(tagName) {
    // API 端点需要对标签名进行 URL 编码，以处理特殊字符
    const apiUrl = `https://www.pixiv.net/ajax/search/tags/${encodeURIComponent(tagName)}?lang=zh`;
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
      throw new Error(`HTTP 请求失败! 状态: ${response.status} for tag: ${tagName}`);
    }

    const data = await response.json();

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`);
    }

    // --- 数据提取 ---
    const body = data.body;
    const translationData = body.tagTranslation?.[tagName];
    const chineseTranslation = translationData?.zh || translationData?.en; // 安全地获取中文翻译

    return {
      originalTag: tagName,
      translation: chineseTranslation || null // 如果没有中文翻译，则返回 null
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
      // 每次运行时重置暂停状态，意味着 runTask 兼具“开始”和“恢复”功能
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
            .then(data => ({
              id: tag, // 使用 tag 名作为唯一标识
              status: 'fulfilled',
              value: data
            }))
            .catch(error => ({
              id: tag,
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

        // 直接在内存中的 progress 对象上更新，然后一次性写入存储
        for (const result of results) {
          progress[result.id] = {
            status: result.status,
            data: result.status === 'fulfilled' ? result.value : result.reason.message
          };
        }
        await localforage.setItem(CONFIG.STORAGE_KEY, progress);

        const currentCompleted = Object.keys(progress).length;

        // 检查暂停信号
        if (isPaused) {
          console.log(`%c批次完成。进度: ${currentCompleted} / ${allTags.length}`, "color: purple;");
          console.log('%c✅ 任务已应请求安全暂停。', 'color: green; font-weight: bold;');
          return; // 退出循环和函数
        }

        const randomDelay = Math.floor(Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS + 1)) + CONFIG.MIN_DELAY_MS;
        console.log(`%c批次完成。进度: ${currentCompleted} / ${allTags.length}. 将等待 ${(randomDelay / 1000).toFixed(1)} 秒...`, "color: purple;");
        await delay(randomDelay);
      }
    },

    /**
     * 请求暂停任务。任务将在当前批次完成后停止。
     */
    pauseTask() {
      console.log('%c⏸️ 请求暂停...', 'color: orange; font-size: 16px;');
      console.log('任务将在当前批次完成后暂停。要恢复，请再次运行 `pixivTagTranslator.runTask()`。');
      isPaused = true;
    },

    /**
     * 生成用于更新数据库标签翻译的 SQL 文件。
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
      const uniqueTranslations = new Map();
      for (const { data } of successfulItems) {
        // 只有当存在有效的中文翻译时才进行处理
        if (data.originalTag && data.translation) {
          uniqueTranslations.set(data.originalTag, data.translation);
        }
      }

      if (uniqueTranslations.size === 0) {
        console.log("在所有成功抓取的数据中，没有找到有效的中文翻译。");
        return;
      }

      // SQL 注入预防：对字符串中的单引号进行转义
      const escapeSql = (str) => str.replace(/'/g, "''");

      let sqlStatements = [
        '-- Pixiv 标签翻译更新脚本',
        '-- 生成时间: ' + new Date().toISOString(),
        '',
        '-- 说明: 本脚本用于根据 Pixiv 官方翻译更新 "Tag" 表中的 "name_zh" 字段。',
        ''
      ];

      for (const [originalTag, translation] of uniqueTranslations.entries()) {
        const sql = `UPDATE "Tag" SET "name_zh" = '${escapeSql(translation)}', "translateType" = 'PIXIV' WHERE "name" = '${escapeSql(originalTag)}';`;
        sqlStatements.push(sql);
      }

      const sqlContent = sqlStatements.join('\n');
      const blob = new Blob([sqlContent], { type: 'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = CONFIG.SQL_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
      console.log(`%c📜 ${CONFIG.SQL_FILENAME} 文件已生成并开始下载! 包含 ${uniqueTranslations.size} 条更新语句。`, "color: green; font-size: 14px;");
    },

    /**
     * 向任务列表中动态添加新的标签名。
     */
    async addTagNames(newTags) {
      if (!window.localforage) {
        console.error("❌ localForage 未加载。");
        return;
      }
      if (!Array.isArray(newTags) || newTags.length === 0) {
        console.log("请输入一个有效的标签名数组。");
        return;
      }
      // 从 IndexedDB 读取和写入标签列表
      const storedTags = (await localforage.getItem(CONFIG.IDS_STORAGE_KEY)) || [];
      const combinedTags = new Set([...storedTags, ...newTags]);
      await localforage.setItem(CONFIG.IDS_STORAGE_KEY, [...combinedTags]);

      console.log(`%c✅ 已成功添加 ${newTags.length} 个新标签。`, "color: green;");
      console.log("请重新运行 `pixivTagTranslator.runTask()` 来处理新增的标签。");
    },

    /**
     * 从 IndexedDB 清除所有已保存的进度和标签列表。
     */
    async clearProgress() {
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
    `%cPixiv 标签翻译抓取器已初始化
%c
--- 可用命令 ---
- pixivTagTranslator.runTask():                 启动或恢复抓取。
- pixivTagTranslator.pauseTask():               安全地暂停当前任务。
- pixivTagTranslator.addTagNames(['tag1']):     向任务列表添加新标签。
- pixivTagTranslator.generateUpdateSQL():       生成用于更新数据库的 SQL 文件。
- pixivTagTranslator.checkProgress():           显示当前进度摘要。
- pixivTagTranslator.clearProgress():             重置所有进度以重新开始。
--------------------------`,
    "color: #007acc; font-size: 20px; font-weight: bold;",
    "font-size: 12px;"
  );

})();
