const path = require('path');
const Browser = require('./src/browser');
const Auth = require('./src/auth');
const Scraper = require('./src/scraper');

const USER_DATA_DIR = path.resolve('./user_data');
const DOWNLOAD_PATH = path.resolve('./downloads');

async function main() {
  // 1. 从命令行参数获取要运行的任务类型
  const taskType = process.argv[2];
  if (!taskType) {
    console.error('❌ 请指定要运行的任务类型. 可用选项: tags, artworks, users');
    console.error('  例如: npm run scrape:tags');
    return;
  }

  let config;
  try {
    config = require(`./config/${taskType}`);
  } catch (error) {
    console.error(`❌ 无法加载配置文件: ./config/${taskType}.js`);
    console.error('  请确保任务类型正确且配置文件存在。');
    return;
  }

  console.log(`🚀 开始执行 [${config.taskName}] 任务...`);

  // 2. 启动浏览器
  const browserInstance = await Browser.launch(USER_DATA_DIR);
  const page = await Browser.createPage(browserInstance, DOWNLOAD_PATH);

  try {
    // 3. 导航并确保登录
    await page.goto('https://www.pixiv.net', { waitUntil: 'networkidle2' });
    await Auth.ensureLoggedIn(page);

    // 4. 运行核心抓取器
    await Scraper.run(page, config);

    console.log(`✅ [${config.taskName}] 任务成功完成!`);

  } catch (error) {
    console.error(`\n🔥 任务执行期间发生严重错误: ${error.message}`);
    console.error(error.stack);
  } finally {
    // 5. 关闭浏览器
    console.log('🚪 正在关闭浏览器...');
    await Browser.close(browserInstance);
    console.log('👋 浏览器已关闭。');
  }
}

main();
