const fs = require('fs').promises;

class Scraper {
  static async run(page, config) {
    // 步骤 1: 读取输入数据
    const inputData = await this.readInputFile(config.inputFile);
    if (inputData.length === 0) {
      console.log('🤷‍ 输入文件为空，任务结束。');
      return;
    }

    // 步骤 2: 读取并动态配置抓取脚本
    const scriptContent = await this.prepareScript(config.scriptFile, config.configKey, inputData);
    console.log(`🔧 已动态注入 ${inputData.length} 个项目到脚本配置中。`);

    // 步骤 3: 注入脚本
    await page.addScriptTag({ content: scriptContent });
    console.log(`💉 脚本 ${config.scriptFile} 已注入页面。`);

    // 步骤 4: 运行抓取任务并等待完成信号
    await this.executeTaskAndWait(page, config.apiObject, 'runTask', config.finishMessage);

    // 步骤 5: 运行所有后续的下载任务
    for (const downloadTask of config.downloadTasks) {
      console.log(`📦 正在执行下载任务: ${downloadTask}...`);
      await page.evaluate((api, task) => window[api][task](), config.apiObject, downloadTask);
      // 每次下载后给予一定的缓冲时间
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('⏳ 所有任务指令已发送，等待文件下载完成...');
    await new Promise(resolve => setTimeout(resolve, 15000)); // 最终等待，确保大文件下载完成
  }

  static async readInputFile(filePath) {
    try {
      console.log(`📂 正在读取输入文件: ${filePath}`);
      const content = await fs.readFile(filePath, 'utf-8');
      return content.split(/\r?\n/).filter(line => line.trim() !== '');
    } catch (error) {
      throw new Error(`读取输入文件失败: ${filePath}. ${error.message}`);
    }
  }

  static async prepareScript(scriptFile, configKey, data) {
    let scriptContent = await fs.readFile(scriptFile, 'utf-8');
    const dataAsJsonString = JSON.stringify(data);
    const configRegex = new RegExp(`(${configKey}\\s*:\\s*\\[)[^\\]]*(\\])`);
    if (!configRegex.test(scriptContent)) {
      throw new Error(`在脚本 ${scriptFile} 中未找到配置项 "${configKey}"`);
    }
    scriptContent = scriptContent.replace(configRegex, `$1${dataAsJsonString}$2`);
    return scriptContent;
  }

  static async executeTaskAndWait(page, apiObject, taskName, finishMessage) {
    console.log(`🏃‍ 开始执行 ${apiObject}.${taskName}()... 这可能需要很长时间。`);

    const taskPromise = new Promise((resolve, reject) => {
      const onConsole = (msg) => {
        const text = msg.text();
        console.log(`[Browser]: ${text}`); // 实时打印浏览器控制台信息
        if (text.includes(finishMessage)) {
          page.removeListener('console', onConsole); // 清理监听器
          resolve();
        }
      };

      page.on('console', onConsole);

      // 启动任务，如果启动失败则 reject
      page.evaluate((api, task) => window[api][task](), apiObject, taskName)
        .catch(err => {
          page.removeListener('console', onConsole);
          reject(err);
        });
    });

    await taskPromise;
    console.log(`✔️ 任务 ${taskName} 已捕获到完成信号。`);
  }
}

module.exports = Scraper;
