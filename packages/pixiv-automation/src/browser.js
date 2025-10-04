const puppeteer = require('puppeteer');

// 通过环境变量来控制是否显示浏览器窗口，方便首次登录
const isHeadless = process.env.HEADLESS !== 'false';

class Browser {
  static async launch(userDataDir) {
    console.log(`🖥️  正在启动浏览器... (无头模式: ${isHeadless})`);
    return puppeteer.launch({
      headless: isHeadless,
      userDataDir: userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
      ],
    });
  }

  static async createPage(browser, downloadPath) {
    const page = await browser.newPage();
    // 设置下载行为
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath,
    });
    console.log(`📂 文件将下载到: ${downloadPath}`);
    return page;
  }

  static async close(browser) {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = Browser;
