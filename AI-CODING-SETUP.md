# AI Coding 配置指南

本文档说明 PixiShelf 项目在 AI Coding 工具（Trae / OpenCode）中的 Skills 配置。

## Skills 配置

| 工具     | Skills 位置         | 备注                                                     |
| -------- | ------------------- | -------------------------------------------------------- |
| Trae     | `.trae/skills/`     | |
| OpenCode | `.opencode/skills/` | |

## 安装 Skills

### 前置要求

确保你的项目中已创建 `.trae/` 和 `.opencode/` 目录。

### 软链接 Skills（推荐）

根据你的操作系统执行以下命令：

**macOS / Linux**

```bash
# 创建 Trae skills 目录软链接
ln -s /path/to/skills/frontend-design .trae/skills

# 创建 OpenCode skills 目录软链接
ln -s /path/to/skills/frontend-design .opencode/skills
```

**Windows (PowerShell)**

```powershell
# 创建 Trae skills 目录软链接
cmd /c "mklink /D .\trae\skills C:\path\to\skills\frontend-design"

# 创建 OpenCode skills 目录软链接
cmd /c "mklink /D .\opencode\skills C:\path\to\skills\frontend-design"
```

> **提示**: 将 `/path/to/skills/` 或 `C:\path\to\skills\` 替换为实际 skills 仓库的本地路径。

## Skill 说明

### [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)

**用途**: 创建独特、生产级的前端界面，避免通用的 "AI slop" 美学。

**适用场景**:

- 构建 Web 组件、页面、应用
- 创建 Landing Page、Dashboard
- React 组件开发
- HTML/CSS 布局
- 任何 Web UI 的样式美化

**设计原则**:

- **Typography**: 选择独特、有特色的字体，避免 Inter、Roboto 等通用字体
- **Color & Theme**: 统一的审美方向，使用 CSS 变量保证一致性
- **Motion**: 动画效果和微交互，优先使用 CSS 解决方案
- **Spatial Composition**: 意外的布局、不对称、重叠、对角线流动
- **Backgrounds & Visual Details**: 创造氛围和深度，添加纹理效果
