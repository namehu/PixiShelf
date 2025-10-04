const puppeteer = require('puppeteer');

class Auth {
  /**
   * @description 一个更可靠的登录检查与等待函数
   * @param {puppeteer.Page} page - Puppeteer 的页面实例
   */
  static async ensureLoggedIn(page) {
    console.log('🔐 正在检查登录状态 (新版检查逻辑)...');

    // 策略：寻找页面上明确的“登录”按钮。
    // Pixiv的登录按钮通常是一个包含 "/login.php" 链接的 <a> 标签。
    const loginButtonSelector = 'a[href*="/login.php"]';

    // 增加一个选择器，用于判断登录成功后出现的元素（例如用户头像）。
    // 注意：这个选择器可能需要根据Pixiv页面更新而调整。一个常见的选择是用户头像区域。
    const userIconSelector = 'div[class*="PfjcA"]'; // 这是一个示例选择器，代表用户头像区域

    try {
      // 等待页面加载，直到“登录”按钮或“用户头像”两者之一出现。
      // 这可以防止在页面元素渲染完成前做过早的判断。
      await page.waitForSelector(`${loginButtonSelector}, ${userIconSelector}`, { timeout: 15000 });
    } catch (error) {
      throw new Error('页面加载超时，无法找到登录按钮或用户头像。请检查网络或Pixiv页面是否已更改。');
    }

    // 检查页面上是否存在登录按钮
    const loginButton = await page.$(loginButtonSelector);

    if (loginButton) {
      // 如果找到了登录按钮，说明当前是未登录状态
      console.log('🟡 检测到“登录”按钮，当前为未登录状态。');
      console.log('⏳ 请在弹出的浏览器窗口中手动完成登录操作...');
      console.log('   脚本将在此期间暂停，直到您登录成功并页面跳转。');

      // 等待用户操作导致页面导航（通常是登录成功后的跳转）
      // 设置一个较长的超时时间（例如5分钟），以允许用户从容地输入账号密码甚至处理验证码。
      try {
        await page.waitForNavigation({ timeout: 300000 });
        console.log('✔️ 检测到页面跳转，登录成功！');
      } catch (error) {
        throw new Error('等待登录超时（5分钟）。如果您已登录，请尝试重新运行脚本。');
      }
    } else {
      // 如果没有找到登录按钮，并且之前的waitForSelector成功了（说明用户头像出现了），则判断为已登录
      console.log('✔️ 未找到“登录”按钮，判断为已登录状态。');
    }
  }
}

module.exports = Auth;
