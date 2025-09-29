# 标签系统改造项目 - 待办事项

## 🔧 需要配置的事项

### 1. 环境变量配置
当前翻译服务使用的是免费的WZH-Wbot API，无需API密钥。如果后续需要使用其他翻译服务，请在`.env`文件中添加相应配置：

```env
# 翻译服务配置（可选）
# TRANSLATION_API_KEY=your_api_key_here
# TRANSLATION_SERVICE_URL=https://your-translation-service.com
```

### 2. 数据库连接确认
请确保PostgreSQL数据库正常运行，并且连接配置正确：
- 数据库已应用所有迁移
- 全文搜索功能正常工作
- 索引创建成功

### 3. 服务器配置
如果部署到生产环境，建议：
- 配置Redis用于翻译任务状态缓存
- 设置API限流保护
- 配置日志监控

## 📋 后续开发任务

### 前端界面开发（高优先级）
1. **标签管理页面**
   - 标签列表展示（支持分页、搜索、筛选）
   - 翻译状态显示
   - 单个标签编辑功能

2. **批量翻译界面**
   - 批量选择标签
   - 翻译进度实时显示
   - 翻译结果查看

3. **搜索功能集成**
   - 在现有标签搜索中集成全文搜索
   - 支持中英文混合搜索
   - 搜索结果高亮显示

### API功能扩展（中优先级）
1. **翻译服务增强**
   - 支持多个翻译服务提供商
   - 翻译质量评估
   - 翻译缓存机制

2. **管理功能完善**
   - 翻译历史记录
   - 批量导入导出
   - 标签合并功能

### 性能优化（低优先级）
1. **缓存机制**
   - Redis缓存翻译任务状态
   - 翻译结果缓存
   - 搜索结果缓存

2. **监控和日志**
   - API调用监控
   - 翻译服务性能监控
   - 错误日志收集

## 🧪 测试建议

### 功能测试
1. **翻译功能测试**
   ```bash
   # 测试单个翻译
   curl -X PUT http://localhost:5430/api/tags/[tag_id]/translation \
     -H "Content-Type: application/json" \
     -d '{"autoTranslate": true}'
   
   # 测试批量翻译
   curl -X POST http://localhost:5430/api/tags/batch-translate \
     -H "Content-Type: application/json" \
     -d '{"tagIds": ["tag1", "tag2"], "mode": "untranslated_only"}'
   ```

2. **搜索功能测试**
   ```bash
   # 测试全文搜索
   curl "http://localhost:5430/api/tags/search?q=cat&limit=10"
   ```

3. **管理功能测试**
   ```bash
   # 测试标签管理列表
   curl "http://localhost:5430/api/tags/management?page=1&limit=20&filter=untranslated"
   ```

### 性能测试
1. 批量翻译性能测试（建议测试50-100个标签）
2. 全文搜索性能测试
3. 并发API调用测试

## 🚀 部署指南

### 开发环境启动
```bash
# 启动数据库（如果使用Docker）
docker-compose up -d postgres

# 应用数据库迁移
cd packages/pixishelf
npm run db:migrate

# 启动开发服务器
npm run dev
```

### 生产环境部署
1. 确保PostgreSQL数据库可用
2. 运行数据库迁移：`npm run db:deploy`
3. 构建项目：`npm run build`
4. 启动服务：`npm start`

## 📚 API文档

### 新增API端点
1. `GET /api/tags/management` - 标签管理列表
2. `PUT /api/tags/[id]/translation` - 更新标签翻译
3. `POST /api/tags/batch-translate` - 批量翻译
4. `GET /api/tags/batch-translate/[taskId]` - 翻译状态
5. `GET /api/tags/batch-translate/[taskId]/details` - 翻译详情

详细的API文档请参考各个路由文件中的注释。

## ⚠️ 注意事项

### 翻译服务限制
- 当前使用免费的WZH-Wbot API，可能有调用频率限制
- 批量翻译会在每个请求间添加1秒延迟
- 建议监控翻译服务的可用性

### 数据库注意事项
- 全文搜索使用PostgreSQL的tsvector，确保数据库版本支持
- 新增的索引可能会影响写入性能，请监控
- 建议定期清理过期的翻译任务数据

### 内存使用
- 翻译任务状态当前存储在内存中
- 生产环境建议使用Redis或数据库存储
- 实现了24小时自动清理机制

## 🔍 故障排除

### 常见问题
1. **翻译失败**
   - 检查网络连接
   - 验证翻译API可用性
   - 查看错误日志

2. **搜索不工作**
   - 确认数据库迁移已应用
   - 检查search_vector字段是否存在
   - 验证触发器是否正常工作

3. **API响应慢**
   - 检查数据库索引
   - 监控翻译服务响应时间
   - 考虑添加缓存

### 日志查看
```bash
# 查看应用日志
npm run dev

# 查看数据库日志
# 根据你的PostgreSQL配置查看相应日志文件
```

## 📞 技术支持

如果遇到问题，请提供以下信息：
1. 错误信息和堆栈跟踪
2. 相关的API请求和响应
3. 数据库状态和迁移历史
4. 系统环境信息

项目已完成所有核心功能，可以开始前端界面开发或进行功能测试。