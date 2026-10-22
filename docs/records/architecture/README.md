# 架构验证与演进记录

这些材料保留测试环境、资源版本、测量结果及当时限制。历史记录不随新代码改写数字，也不代替生产发布确认；当前实现以[架构总览](../../architecture/current-architecture.md)为入口。

| 记录                                                     | 解释什么                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| [WebP 初次流式接入](./webp-streaming-verification.md)    | 预编译交付、自动/手动播放及初期验证                              |
| [WebP 手机与持续播放](./webp-mobile-verification.md)     | 独立帧门禁、节奏实验、持续播放、压缩复用、具体构建与人工观感     |
| [动图时长探测](./animation-duration-verification.md)     | 源写入门禁、让行误报、候选范围及连续执行修复；含未通过的性能门槛 |
| [作品浏览查询](./artwork-feed-query-performance.md)      | 不同版本的数据库基准、随机浏览与真实浏览器验证                   |
| [统计查询](./statistics-query-performance.md)            | 分区缓存与计数方式的隔离验证                                     |
| [发现来源查询](./archive-discovery-query-performance.md) | URL 匹配索引和独立统计的基准                                     |
| [数据库迁移背景](./database-migration-history.md)        | 早期队列切换守卫、兼容约束与迁移对照                             |

一次性切换设计见[设计去向表](../../design/README.md)，生产升级和恢复记录由[运维记录](../operations/)维护。私人媒体、原始诊断 JSON 和本机忽略目录不是其他克隆的构建依赖。
