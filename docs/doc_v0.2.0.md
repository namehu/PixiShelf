# Artisan Shelf - V2.2 重构计划：聚焦数据解析核心

---

## 1. 重构目标

本次重构的核心目标是实现一套灵活、高效的数据解析与存储方案。我们将：

1.  根据最新的数据模型，重写文件扫描服务，使其能够精准地从目录结构和元数据文件中提取信息。
2.  优化API，确保前端能够高效地查询和展示带有标签和描述的作品。
3.  保留为未来多用户和个性化配置功能所设计的 `User` 和 `Setting` 数据模型。

---

## 2. 数据库模型与数据源

### 2.1 最终的 `prisma.schema`

这是我们当前阶段的最终数据模型，它将指导我们的后端开发和数据库迁移工作。用户认证相关的模型已保留，但开发任务将不再涉及。

```prisma
// file: packages/api/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 作者模型，从目录名解析
model Artist {
  id        Int       @id @default(autoincrement())
  name      String    // 显示名称（原始目录名）
  username  String?   // 解析出的用户名部分
  userId    String?   // 解析出的用户ID部分
  bio       String?   // 预留字段，未来可扩展
  artworks  Artwork[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@unique([username, userId], name: "unique_username_userid")
}

// 作品集模型，从作品目录解析
model Artwork {
  id          Int       @id @default(autoincrement())
  title       String    // 作品目录名
  description String?   // 从元数据文件解析
  tags        String[]  // 从元数据文件解析
  images      Image[]
  artist      Artist?   @relation(fields: [artistId], references: [id])
  artistId    Int?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([title, description])
  @@unique([artistId, title], name: "unique_artist_title")
}

// 单张图片模型
model Image {
  id        Int      @id @default(autoincrement())
  path      String   // 图片的绝对路径
  width     Int?     // 图片宽度
  height    Int?     // 图片高度
  size      Int?     // 文件大小 (bytes)
  artwork   Artwork? @relation(fields: [artworkId], references: [id])
  artworkId Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 应用用户模型 (用于登录认证)
model User {
  id        Int      @id @default(autoincrement())
  username  String   @unique
  password  String   // 存储加密后的密码哈希
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 系统设置模型
model Setting {
  id        Int      @id @default(autoincrement())
  key       String   @unique
  value     String?
  type      String   @default("string") // e.g., string, number, boolean, json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2.2 样例元数据文件 (`*_metadata.txt`)

为了确保开发人员对解析目标有清晰的理解，我们保留此份完整的样例数据。扫描器将主要从此文件中提取 `Description` 和 `Tags`。

```txt
ID
131278560

URL
[https://www.pixiv.net/i/131278560](https://www.pixiv.net/i/131278560)

Original
[https://i.pximg.net/img-original/img/2025/06/07/16/29/58/131278560_p0.png](https://i.pximg.net/img-original/img/2025/06/07/16/29/58/131278560_p0.png)

Thumbnail
[https://i.pximg.net/c/250x250_80_a2/img-master/img/2025/06/07/16/29/58/131278560_p0_square1200.jpg](https://i.pximg.net/c/250x250_80_a2/img-master/img/2025/06/07/16/29/58/131278560_p0_square1200.jpg)

xRestrict
R-18

AI
Yes

User
Aisey

UserID
102941617

Title
嗨♪ 想我了吗

Description


Tags
#AI生成
#R-18
#崩壊3rd
#崩坏星穹铁道
#爱莉希雅
#崩壊スターレイル
#Elysia
#cyrene
#昔涟
#キュレネ
#崩壊:スターレイル

Size
1160 x 1432

Bookmark
334

Date
2025-06-07T07:29:00+00:00
```

---

## 3. 核心服务重构计划

### 3.1 文件扫描服务 (`scanner.ts`) 重构

扫描器的核心逻辑将调整为：

1.  **解析作者 (`Artist`)**: 扫描器遍历根目录下的第一级文件夹。它会将文件夹名称（如 `Aisey (102941617)`）作为 `Artist` 的 `name`，并尝试通过正则表达式等方式解析出 `username` (`Aisey`) 和 `userId` (`102941617`)。
2.  **解析作品 (`Artwork`)**: 对每个作者文件夹下的子目录，将其名称作为 `Artwork` 的 `title`。
3.  **解析元数据**: 在作品目录中查找 `*_metadata.txt` 文件。如果找到，则解析其中的 `Description` 和 `Tags` 字段，并更新到对应的 `Artwork` 记录中。
4.  **关联数据**: 使用 `upsert` 逻辑，将解析出的 `Artist` 和 `Artwork` 信息存入数据库，并建立两者之间的关联。

### 3.2 API 核心重构

| 模块 | 变更点 | 描述 |
| :--- | :--- | :--- |
| **API 设计** | `GET /api/v1/artworks` | 查询参数 `?tags=tag1,tag2` 依然有效，后端的查询逻辑将变更为在 `String[]` 字段上进行（例如使用PostgreSQL的 `array_contains` 或 `@>` 操作符）。 |

---

## 4. 新的开发路线图 (V2.2)

我们将此重构作为 **阶段四** 来执行。

### 阶段四: 核心重构 - 数据解析逻辑 (V2.2)

* **数据库迁移**:
    * 备份现有数据库。
    * 更新 `schema.prisma` 文件为 2.1 中的新结构。
    * 运行 `prisma migrate dev` 生成新的数据库迁移脚本并应用。
* **后端重构**:
    * 重写 `scanner.ts` 以适配新的目录解析和元数据提取逻辑。
    * 更新 `artworks` API 的标签查询逻辑，以支持在数组字段上进行高效查询。
* **前端适配**:
    * 确保前端页面能够正确请求并展示包含 `tags` 和 `description` 的作品数据。
    * 验证标签筛选功能与新的后端查询逻辑能够正常工作。
* **端到端测试**:
    * 全面测试新的扫描流程，确保数据能被正确、完整地解析和存储。
    * 重点测试作品的查询和标签筛选功能。
