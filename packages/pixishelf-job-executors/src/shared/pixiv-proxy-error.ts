export class PixivProxyConfigurationError extends Error {
  constructor() {
    super('在线同步代理配置无效：仅支持不含账号、密码、路径、查询参数或片段的 HTTP/HTTPS 代理地址')
    this.name = 'PixivProxyConfigurationError'
  }
}
