好的，这是一个非常棒的功能规划。基于您提供的 `schema.prisma` 文件和需求，我将为您提供一份详细的需求与实现设计方案。

方案将分为四个阶段，分别对应您提出的四个核心需求：

1.  **数据库与结构设计**：修改 Prisma Schema，为性能做好准备。
2.  **后端 API 设计**：创建必要的接口来支持管理和搜索功能。
3.  **前端管理页面设计**：规划标签管理页面的功能和交互。
4.  **批量翻译服务设计**：设计与大模型 API 对接的自动化翻译流程。

-----

### 阶段一：数据库与结构设计 (Schema & Performance)

这是所有工作的基础。我们需要先更新数据模型，并为后续的搜索功能建立高效的索引。

#### 1\. 修改 `Tag` 模型

首先，在您的 `schema.prisma` 文件中为 `Tag` 模型增加 `name_zh` 字段。这个字段应该是可选的（`String?`），因为不是所有标签都会立即有翻译。

```prisma[caption="schema.prisma"]
model Tag {
  id           Int          @id @default(autoincrement())
  name         String       @unique
  name_zh      String?      // [新增] 中文翻译列
  [cite_start]description  String?      [cite: 14]
  artworkCount Int          @default(0)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  artworkTags  ArtworkTag[]

  @@index([name])
  @@index([name_zh]) // [新增] 为中文翻译列增加索引，提高查询速度
  @@index([artworkCount], map: "Tag_artworkCount_idx")
}
```

#### 2\. 数据库迁移

修改完 schema后，执行 Prisma 迁移命令来更新您的数据库表结构：

```bash
npx prisma migrate dev --name add_tag_name_zh
```

这会自动在 PostgreSQL 的 `Tag` 表中创建一个新的、可为空的 `name_zh` 列和一个 B-tree 索引。

#### 3\. 高性能统一搜索方案 (Full-Text Search)

您的第二个需求是**搜索中文也能搜到原始 `name` 的标签**，并且要考虑性能。如果数据量很大，使用 `OR` 查询（`WHERE name LIKE '%...%' OR name_zh LIKE '%...%'`）效率会很低。

最佳实践是利用 PostgreSQL 的\*\*全文搜索（Full-Text Search, FTS）\*\*功能。

**实现思路：**

我们将创建一个特殊的 `tsvector` 列，它会合并 `name` 和 `name_zh` 的内容，并为其创建一个高效的 GIN 索引。

**步骤：**

1.  **创建自定义迁移文件**：
    首先，生成一个空的迁移文件。

    ```bash
    npx prisma migrate dev --create-only
    ```

    这会创建一个新的迁移文件夹，例如 `prisma/migrations/xxxxxxxx_fts_for_tags`。

2.  **编辑 `migration.sql` 文件**：
    进入该文件夹，编辑里面的 `migration.sql` 文件，添加以下 SQL 命令。

    ```sql
    -- 1. 在 Tag 表上增加一个用于全文搜索的 tsvector 列
    ALTER TABLE "Tag" ADD COLUMN "search_vector" tsvector;

    -- 2. 创建一个函数，用于在插入或更新时自动更新 search_vector 列
    CREATE OR REPLACE FUNCTION update_tag_search_vector()
    RETURNS TRIGGER AS $$
    BEGIN
        -- 将 name 和 name_zh (如果存在) 合并，并转换为 tsvector
        -- 'simple' 配置支持多语言，不会移除英文的停用词
        NEW.search_vector := to_tsvector('simple', NEW.name) ||
                             to_tsvector('simple', COALESCE(NEW.name_zh, ''));
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- 3. 创建一个触发器，在每次插入或更新 Tag 记录时调用上述函数
    CREATE TRIGGER tag_search_vector_update
    BEFORE INSERT OR UPDATE ON "Tag"
    FOR EACH ROW EXECUTE FUNCTION update_tag_search_vector();

    -- 4. 在新的 search_vector 列上创建一个 GIN 索引，这是性能的关键
    CREATE INDEX "Tag_search_vector_idx" ON "Tag" USING GIN ("search_vector");

    -- 5. (可选) 对现有数据进行一次性填充
    UPDATE "Tag" SET "search_vector" = to_tsvector('simple', name) || to_tsvector('simple', COALESCE(name_zh, ''));
    ```

3.  **运行迁移**：
    现在，应用这个包含自定义 SQL 的迁移。

    ```bash
    npx prisma migrate dev
    ```

这样，数据库层面就准备好了。每次你新增或修改一个标签的 `name` 或 `name_zh`，`search_vector` 列都会被自动更新，并且 GIN 索引能确保毫秒级的搜索速度。

-----

### 阶段二：后端 API 设计 (Next.js API Routes)

接下来，我们设计支持前端页面所需的 API 接口。这些可以放在 `app/api/tags/` 目录下。

#### 1\. `GET /api/tags` - 获取/搜索标签列表

这个接口用于获取标签列表，并支持分页和全文搜索。

  * **Query 参数**:

      * `page` (number, optional): 页码，默认为 1。
      * `limit` (number, optional): 每页数量，默认为 30。
      * `search` (string, optional): 搜索关键词。

  * **实现逻辑**:

      * 如果 `search` 参数存在，就使用全文搜索。否则，按正常分页查询。
      * 使用 Prisma 的 `$queryRaw` 来执行 FTS 查询。

  * **示例代码 (`app/api/tags/route.ts`)**:

    ```typescript
    import { PrismaClient } from '@prisma/client';
    import { NextRequest, NextResponse } from 'next/server';

    const prisma = new PrismaClient();

    export async function GET(request: NextRequest) {
      const searchParams = request.nextUrl.searchParams;
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = parseInt(searchParams.get('limit') || '30', 10);
      const searchQuery = searchParams.get('search');

      const offset = (page - 1) * limit;

      try {
        let tags;
        let totalTags;

        if (searchQuery) {
          // 将搜索词转换为 tsquery 格式，用 '&' 连接表示 AND
          const formattedQuery = searchQuery.trim().split(/\s+/).join(' & ');

          tags = await prisma.$queryRaw`
            SELECT id, name, name_zh, "artworkCount"
            FROM "Tag"
            WHERE search_vector @@ to_tsquery('simple', ${formattedQuery})
            ORDER BY "artworkCount" DESC
            LIMIT ${limit} OFFSET ${offset};
          `;

          const countResult: [{ count: bigint }] = await prisma.$queryRaw`
            SELECT COUNT(*) FROM "Tag"
            WHERE search_vector @@ to_tsquery('simple', ${formattedQuery});
          `;
          totalTags = Number(countResult[0].count);

        } else {
          tags = await prisma.tag.findMany({
            skip: offset,
            take: limit,
            orderBy: {
              artworkCount: 'desc',
            },
          });
          totalTags = await prisma.tag.count();
        }

        return NextResponse.json({
          data: tags,
          pagination: {
            page,
            limit,
            total: totalTags,
            totalPages: Math.ceil(totalTags / limit),
          },
        });
      } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
      }
    }
    ```

#### 2\. `PUT /api/tags/[id]` - 更新标签翻译

用于在管理页面中保存单个标签的中文翻译。

  * **Request Body**: `{ "name_zh": "新的中文翻译" }`

  * **示例代码 (`app/api/tags/[id]/route.ts`)**:

    ```typescript
    import { PrismaClient } from '@prisma/client';
    import { NextRequest, NextResponse } from 'next/server';

    const prisma = new PrismaClient();

    export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
      const tagId = parseInt(params.id, 10);
      const body = await request.json();
      const { name_zh } = body;

      if (isNaN(tagId)) {
        return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
      }

      try {
        const updatedTag = await prisma.tag.update({
          where: { id: tagId },
          data: { name_zh: name_zh || null }, // 如果传入空字符串则设为null
        });
        return NextResponse.json(updatedTag);
      } catch (error) {
        return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
      }
    }
    ```

#### 3\. `POST /api/tags/batch-translate` - 触发批量翻译

这个接口用于启动后台的批量翻译任务。

  * **实现逻辑**:
      * 这是一个耗时操作，不应阻塞请求。
      * 接口应立即返回成功信息，例如 `{"message": "Batch translation process started."}`。
      * 实际的翻译任务在后台异步执行。

-----

### 阶段三：前端管理页面设计 (Next.js & React)

创建一个新的页面，例如 `app/admin/tags/page.tsx`，用于标签管理。

#### 1\. 页面布局与组件

  * **搜索框**: 用于输入关键词，实时/延迟调用 `GET /api/tags?search=...` 接口。
  * **标签列表/表格**:
      * [cite\_start]展示 `name` (原始标签)、`name_zh` (一个可编辑的输入框)、`artworkCount` [cite: 14] (作品数量)。
      * 每一行都有一个 "保存" 按钮。
  * **"批量翻译未翻译标签" 按钮**: 点击后调用 `POST /api/tags/batch-translate`。
  * **分页组件**: 用于在标签列表页之间切换。

#### 2\. 状态管理 (State Management)

使用 `useState` 或 `useSWR`/`React Query` 来管理：

  * 标签数据列表 (`tags`)
  * 加载状态 (`isLoading`)
  * 搜索词 (`searchQuery`)
  * 分页状态 (`currentPage`)

#### 3\. 交互流程

1.  **加载**: 页面加载时，获取第一页标签数据 (`GET /api/tags`)。
2.  **搜索**: 用户在搜索框输入内容时，触发对 `GET /api/tags?search=...` 的调用，并更新列表。
3.  **编辑翻译**:
      * 用户在某行的中文翻译输入框中修改内容。
      * 点击该行的 "保存" 按钮。
      * 调用 `PUT /api/tags/[id]` 接口，将修改后的 `name_zh` 发送到后端。
      * 成功后，可以显示一个成功提示 (toast)，并更新列表中的数据。
4.  **批量翻译**:
      * 用户点击 "批量翻译" 按钮。
      * 前端发送一个 `POST` 请求到 `/api/tags/batch-translate`。
      * 显示一个提示，如 "批量翻译任务已启动，请稍后刷新查看结果"。

-----

### 阶段四：批量翻译服务设计

这是实现需求 4 的核心。我们将设计一个后台服务来调用大模型 API。

#### 1\. 选择翻译服务

  * **传统翻译 API**: Google Translate, DeepL 等。优点是便宜、快速；缺点是对于一些专业术语或俚语翻译效果可能不佳。
  * **大语言模型 (LLM) API**: GPT (OpenAI), Gemini (Google AI), Claude (Anthropic) 等。优点是理解上下文能力强，翻译更自然，可以提供更创意的翻译；缺点是成本更高，响应速度可能稍慢。

对于图库标签这种场景，LLM 可能效果更好，因为它能更好地理解一些艺术、动漫、游戏领域的专有词汇。

#### 2\. 后端服务实现

我们可以在 `POST /api/tags/batch-translate` 接口的背后实现这个逻辑。为了不让 HTTP 请求超时，我们会采用**异步执行**的方式。

**实现思路:**

1.  **获取未翻译的标签**:

    ```typescript
    const tagsToTranslate = await prisma.tag.findMany({
      where: { name_zh: null },
      select: { id: true, name: true },
    });
    ```

2.  **分批处理 (Batching)**:
    一次性向上千个标签发送请求可能会触发 API 的速率限制。将它们分成小批次（如每批 20-50 个）是明智的。

3.  **调用 LLM API**:
    构造一个合适的 Prompt。例如：

    > "You are an expert translator specializing in art, anime, and pop culture. Translate the following tags from English to Chinese. Provide only the translated text, one per line, in the same order. If a tag is already in Chinese or does not need translation, return the original tag.\\n\\n[list of tags]"

4.  **更新数据库**:
    收到翻译结果后，使用 `prisma.$transaction` 或循环 `update` 将结果存回数据库。

**示例代码 (`app/api/tags/batch-translate/route.ts`)**

```typescript
import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { yourLLMTranslateFunction } from '@/lib/translationService'; // 假设你封装了翻译函数

const prisma = new PrismaClient();

export async function POST() {
  // 立即响应，表示任务已接收
  NextResponse.json({ message: 'Batch translation process started.' });

  // 异步执行翻译任务
  (async () => {
    try {
      console.log('Starting batch translation...');
      const tagsToTranslate = await prisma.tag.findMany({
        where: { name_zh: null },
        take: 500, // 每次处理500个，防止任务过大
      });

      if (tagsToTranslate.length === 0) {
        console.log('No tags to translate.');
        return;
      }

      const names = tagsToTranslate.map(t => t.name);
      const translatedNames = await yourLLMTranslateFunction(names);

      const updatePromises = tagsToTranslate.map((tag, index) =>
        prisma.tag.update({
          where: { id: tag.id },
          data: { name_zh: translatedNames[index] },
        })
      );

      // 并发更新数据库
      await Promise.all(updatePromises);
      console.log(`Successfully translated and updated ${tagsToTranslate.length} tags.`);

    } catch (error) {
      console.error('Batch translation failed:', error);
    }
  })();

  // 这里的返回是多余的，因为异步执行了，但为了符合Next.js路由处理器的格式可以保留
  // 实际上，第一个NextResponse.json已经发回给客户端了
  return new Response(null, { status: 202 });
}
```

> **注意**: 在 Vercel 等 Serverless 环境中，长时间运行的后台任务可能会被中断。对于非常大的任务量，建议使用专业的队列服务（如 Vercel Cron Jobs, Upstash QStash, BullMQ）来保证任务的可靠执行。但对于中小型项目，上述异步执行方式已经足够。

通过以上四个阶段的设计，您可以系统地、高效地为您的图库项目添加完整的中英双语标签支持和管理功能。
