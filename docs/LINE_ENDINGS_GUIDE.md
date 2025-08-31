# 换行符统一处理指南

## 概述

本项目已统一使用 LF (Unix/Linux) 换行符，以确保跨平台开发的一致性。

## 当前配置

### Git 配置
- `core.autocrlf = false` - 禁用自动换行符转换
- `core.eol = lf` - 强制使用 LF 换行符

### 文件配置
- `.gitattributes` - 定义所有文本文件使用 LF 换行符
- `.editorconfig` - 编辑器统一配置
- `.prettierrc` - 代码格式化工具配置

## 团队成员同步步骤

### 1. 更新本地仓库
```bash
git pull origin main
```

### 2. 配置本地 Git 设置
```bash
git config core.autocrlf false
git config core.eol lf
```

### 3. 重新规范化本地文件
```bash
# 删除所有文件并重新检出（这会应用新的换行符设置）
git rm --cached -r .
git reset --hard
```

### 4. 验证配置
```bash
# 检查 Git 配置
git config --list | grep "core.autocrlf\|core.eol"

# 检查文件状态
git status
```

## IDE/编辑器配置

### VS Code
确保以下设置：
```json
{
  "files.eol": "\n",
  "git.autocrlf": "input"
}
```

### 其他编辑器
请确保编辑器配置为：
- 使用 LF 换行符
- 读取 `.editorconfig` 文件

## 注意事项

1. **新团队成员**：必须在开始开发前执行上述同步步骤
2. **现有开发者**：如果遇到大量文件显示为已修改，请执行步骤3重新规范化
3. **Dev Container**：容器环境已自动配置正确的换行符设置
4. **提交前检查**：使用 `git status` 确认没有意外的换行符更改

## 常见问题

### Q: 为什么选择 LF 而不是 CRLF？
A: LF 是 Unix/Linux 标准，容器化部署环境使用 LF，避免跨平台问题。

### Q: 如果我忘记配置会怎样？
A: 可能会产生大量的换行符差异，影响代码审查和合并。

### Q: 现有文件都需要重新提交吗？
A: 不需要，重新规范化操作已经处理了所有现有文件。

## 验证脚本

可以使用以下命令验证当前配置：

```bash
# 检查 Git 配置
echo "Git 配置:"
git config core.autocrlf
git config core.eol

# 检查是否有换行符问题
echo "\n文件状态:"
git status --porcelain

echo "\n如果没有输出，说明配置正确！"
```

---

*最后更新：$(date)*
*如有问题，请联系项目维护者*