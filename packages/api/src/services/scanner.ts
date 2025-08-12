import { promises as fs } from "fs";
import path from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";

export interface ScanOptions {
  scanPath: string;
  supportedExtensions?: string[];
  forceUpdate?: boolean;
  onProgress?: (progress: ScanProgress) => void;
}

export interface ScanProgress {
  phase: "counting" | "scanning" | "creating" | "cleanup" | "complete";
  message: string;
  current?: number;
  total?: number;
  percentage?: number;
  estimatedSecondsRemaining?: number;
}

export interface ScanResult {
  scannedDirectories: number;
  foundImages: number;
  newArtworks: number;
  newImages: number;
  removedArtworks: number;
  errors: string[];
  // +++ 新增字段，用于告知前端哪些目录被跳过了 +++
  skippedDirectories: Array<{ path: string; reason: string }>;
}

interface MetadataInfo {
  description?: string;
  tags: string[];
}

export class FileScanner {
  private prisma: PrismaClient;
  private logger: FastifyInstance["log"];
  private supportedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
  ];
  private scanRootAbs: string | null = null;

  constructor(prisma: PrismaClient, logger: FastifyInstance["log"]) {
    this.prisma = prisma;
    this.logger = logger;
  }

  // +++ 新增名称验证函数 +++
  /**
   * 检查文件名/目录名是否只包含安全的字符。
   * @param name 要检查的名称
   * @returns 如果名称安全则返回 true，否则返回 false
   */
  private isValidName(name: string): boolean {
    // 这个正则表达式允许:
    // - a-z, A-Z, 0-9 (字母数字)
    // - _-.() (下划线, 连字符, 点, 括号)
    // - 空格
    // - \u4e00-\u9fa5 (中文字符)
    // - \u3040-\u30ff (日文字符 Hiragana & Katakana)
    // 其他所有字符 (如 Emoji, 特殊符号, 数学字体) 都会导致验证失败。
    const safeNameRegex = /^[a-zA-Z0-9\s_\-.()\u4e00-\u9fa5\u3040-\u30ff]+$/;
    return safeNameRegex.test(name);
  }

  async scan(options: ScanOptions): Promise<ScanResult> {
    const result: ScanResult = {
      scannedDirectories: 0,
      foundImages: 0,
      newArtworks: 0,
      newImages: 0,
      removedArtworks: 0,
      errors: [],
      skippedDirectories: [], // +++ 初始化新增字段 +++
    };

    try {
      const scanPath = options.scanPath;
      const extensions =
        options.supportedExtensions || this.supportedExtensions;
      const forceUpdate = options.forceUpdate || false;
      const onProgress = options.onProgress;

      // 记录规范化后的扫描根目录，供相对路径换算
      this.scanRootAbs = path.resolve(scanPath);

      this.logger.info(
        { scanPath, forceUpdate },
        `Starting V2.2 scan of: ${scanPath}`
      );
      onProgress?.({
        phase: "scanning",
        message: "开始扫描目录...",
        percentage: 0,
      });

      // 检查扫描路径是否存在
      try {
        await fs.access(scanPath);
      } catch (error) {
        throw new Error(`Scan path does not exist: ${scanPath}`);
      }

      // 如果强制更新，先清理所有相关数据
      if (forceUpdate) {
        onProgress?.({
          phase: "cleanup",
          message: "强制更新：清理现有数据...",
          percentage: 10,
        });
        await this.cleanupExistingData();
      }

      // 第一遍：扫描根目录下的艺术家文件夹
      onProgress?.({
        phase: "counting",
        message: "预扫描：统计艺术家和作品目录...",
        percentage: 0,
      });
      const { totalWorkUnits, artistCount, artworkCount } =
        await this.countArtistsAndArtworks(scanPath, extensions, onProgress);

      // 第二遍：正式扫描并按目录结构处理
      let processedWorkUnits = 0;
      const scanStartTs = Date.now();
      const progressUpdate = (
        increment: number,
        message: string,
        phase: ScanProgress["phase"] = "scanning"
      ) => {
        processedWorkUnits += increment;
        const percentage =
          totalWorkUnits > 0
            ? Math.min(
                99,
                Math.floor((processedWorkUnits / totalWorkUnits) * 100)
              )
            : undefined;
        const elapsedSec = Math.max(0.001, (Date.now() - scanStartTs) / 1000);
        const rate =
          processedWorkUnits > 0 ? processedWorkUnits / elapsedSec : 0;
        const remainingUnits = Math.max(0, totalWorkUnits - processedWorkUnits);
        const estSeconds =
          rate > 0 ? Math.ceil(remainingUnits / rate) : undefined;
        const detailedMessage = `${message} [${processedWorkUnits}/${totalWorkUnits}] (${percentage || 0}%)`;
        onProgress?.({
          phase,
          message: detailedMessage,
          current: processedWorkUnits,
          total: totalWorkUnits,
          percentage,
          estimatedSecondsRemaining: estSeconds,
        });
      };

      const scanStartMessage = `开始扫描 ${artistCount} 个艺术家目录，${artworkCount} 个作品目录...`;
      onProgress?.({
        phase: "scanning",
        message: scanStartMessage,
        current: 0,
        total: totalWorkUnits,
        percentage: totalWorkUnits > 0 ? 0 : undefined,
      });

      // 按照新的目录结构扫描
      await this.scanArtistDirectories(
        scanPath,
        extensions,
        result,
        progressUpdate
      );

      // 扫描完成后清理无图片的作品
      const cleanupMessage = `清理无图片的作品... [${processedWorkUnits}/${totalWorkUnits}] (99%)`;
      onProgress?.({
        phase: "cleanup",
        message: cleanupMessage,
        percentage: 99,
      });
      const removedCount = await this.cleanupEmptyArtworks();
      result.removedArtworks = removedCount;

      const completeMessage = `扫描完成！处理了 ${result.scannedDirectories} 个目录，创建了 ${result.newArtworks} 个作品，${result.newImages} 张图片。跳过了 ${result.skippedDirectories.length} 个命名不规范的目录。`;
      onProgress?.({
        phase: "complete",
        message: completeMessage,
        percentage: 100,
      });
      this.logger.info({ result }, "Scan completed");
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(errorMsg);
      this.logger.error({ error }, "Scan failed");
      return result;
    }
  }

  // 新的预扫描统计：按照 Artist/Artwork 层级结构统计
  private async countArtistsAndArtworks(
    rootPath: string,
    extensions: string[],
    onProgress?: (progress: ScanProgress) => void
  ): Promise<{
    totalWorkUnits: number;
    artistCount: number;
    artworkCount: number;
  }> {
    let artistCount = 0;
    let artworkCount = 0;
    let scannedDirs = 0;

    try {
      const artistEntries = await fs.readdir(rootPath, { withFileTypes: true });

      for (const artistEntry of artistEntries) {
        // +++ 改动点：在这里加入名称验证 +++
        if (!this.isValidName(artistEntry.name)) {
          this.logger.warn(
            `预扫描：跳过不规范的艺术家目录名: ${artistEntry.name}`
          );
          continue; // 跳过此目录
        }

        // 跳过隐藏目录和文件
        if (
          artistEntry.name.startsWith(".") ||
          artistEntry.name.startsWith("$") ||
          !artistEntry.isDirectory()
        ) {
          continue;
        }

        const artistPath = path.join(rootPath, artistEntry.name);
        scannedDirs++;
        artistCount++;

        // 每扫描50个目录更新一次进度提示
        if (scannedDirs % 50 === 0) {
          onProgress?.({
            phase: "counting",
            message: `预扫描中... 已检查 ${scannedDirs} 个艺术家目录，当前：${artistEntry.name}`,
            percentage: undefined,
          });
        }

        try {
          const artworkEntries = await fs.readdir(artistPath, {
            withFileTypes: true,
          });

          for (const artworkEntry of artworkEntries) {
            // +++ 改动点：在这里也加入名称验证 +++
            if (!this.isValidName(artworkEntry.name)) {
              this.logger.warn(
                `预扫描：跳过不规范的作品目录名: ${path.join(artistPath, artworkEntry.name)}`
              );
              continue; // 跳过此目录
            }

            if (
              artworkEntry.name.startsWith(".") ||
              artworkEntry.name.startsWith("$") ||
              !artworkEntry.isDirectory()
            ) {
              continue;
            }

            const artworkPath = path.join(artistPath, artworkEntry.name);

            // 检查是否有图片文件
            const hasImages = await this.hasImageFiles(artworkPath, extensions);
            if (hasImages) {
              artworkCount++;
            }
          }
        } catch (error) {
          this.logger.warn(
            { error, artistPath },
            "Failed to scan artist directory during counting"
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        { error, rootPath },
        "Failed to scan root directory during counting"
      );
    }

    const totalWorkUnits = artistCount + artworkCount;
    const summaryMessage = `统计完成：发现 ${artistCount} 个艺术家目录，${artworkCount} 个作品目录，总工作量 ${totalWorkUnits}`;
    onProgress?.({
      phase: "counting",
      message: summaryMessage,
      current: totalWorkUnits,
      total: totalWorkUnits,
      percentage: 0,
    });

    return { totalWorkUnits, artistCount, artworkCount };
  }

  // 检查目录是否包含图片文件
  private async hasImageFiles(
    dirPath: string,
    extensions: string[]
  ): Promise<boolean> {
    try {
      // 规范化路径，处理可能的空格和特殊字符
      const normalizedPath = path.normalize(dirPath);
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          extensions.includes(path.extname(entry.name).toLowerCase())
        ) {
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.warn(
        // @ts-ignore
        { error: error.message, dirPath },
        `Failed to read directory: ${dirPath}`
      );
      return false;
    }
  }

  // 按照新的目录结构扫描：根目录下每个文件夹作为 Artist，Artist 下的子文件夹作为 Artwork
  private async scanArtistDirectories(
    rootPath: string,
    extensions: string[],
    result: ScanResult,
    progressUpdate: (
      increment: number,
      message: string,
      phase?: ScanProgress["phase"]
    ) => void
  ): Promise<void> {
    try {
      const artistEntries = await fs.readdir(rootPath, { withFileTypes: true });

      for (const artistEntry of artistEntries) {
        const artistPath = path.join(rootPath, artistEntry.name);

        // +++ 改动点：在这里加入名称验证和记录 +++
        if (!this.isValidName(artistEntry.name)) {
          const reason = "艺术家目录名包含不支持的字符";
          this.logger.warn(`${reason}: ${artistPath}`);
          result.skippedDirectories.push({ path: artistPath, reason });
          progressUpdate(1, `跳过目录: ${artistEntry.name}`);
          continue;
        }

        // 跳过隐藏目录和文件
        if (
          artistEntry.name.startsWith(".") ||
          artistEntry.name.startsWith("$") ||
          !artistEntry.isDirectory()
        ) {
          continue;
        }

        result.scannedDirectories++;

        progressUpdate(1, `处理艺术家目录: ${artistEntry.name}`);

        // 创建或获取艺术家
        const artist = await this.findOrCreateArtist(artistEntry.name);

        if (!artist) {
          result.errors.push(`Failed to create artist: ${artistEntry.name}`);
          continue;
        }

        // 扫描艺术家目录下的作品
        await this.scanArtworkDirectories(
          artistPath,
          artist.id,
          extensions,
          result,
          progressUpdate
        );
      }
    } catch (error) {
      const errorMsg = `Failed to scan artist directories: ${error instanceof Error ? error.message : "Unknown error"}`;
      result.errors.push(errorMsg);
      this.logger.error({ error, rootPath }, "Artist directories scan failed");
    }
  }

  // 扫描艺术家目录下的作品文件夹
  private async scanArtworkDirectories(
    artistPath: string,
    artistId: number,
    extensions: string[],
    result: ScanResult,
    progressUpdate: (
      increment: number,
      message: string,
      phase?: ScanProgress["phase"]
    ) => void
  ): Promise<void> {
    try {
      const artworkEntries = await fs.readdir(artistPath, {
        withFileTypes: true,
      });

      for (const artworkEntry of artworkEntries) {
        const artworkPath = path.join(artistPath, artworkEntry.name);

        // +++ 改动点：在这里加入名称验证和记录 +++
        if (!this.isValidName(artworkEntry.name)) {
          const reason = "作品目录名包含不支持的字符";
          this.logger.warn(`${reason}: ${artworkPath}`);
          result.skippedDirectories.push({ path: artworkPath, reason });
          progressUpdate(1, `跳过目录: ${artworkEntry.name}`);
          continue;
        }

        // 跳过隐藏目录和文件
        if (
          artworkEntry.name.startsWith(".") ||
          artworkEntry.name.startsWith("$") ||
          !artworkEntry.isDirectory()
        ) {
          continue;
        }

        // 收集该作品目录下的图片
        const images = await this.collectImagesFromDirectory(
          artworkPath,
          extensions
        );

        if (images.length === 0) {
          continue; // 跳过没有图片的目录
        }

        result.foundImages += images.length;
        progressUpdate(
          1,
          `处理作品目录: ${artworkEntry.name} (${images.length}张图片)`,
          "creating"
        );

        // 解析元数据
        const metadata = await this.parseMetadata(artworkPath);

        // 创建作品记录
        await this.createArtworkFromDirectoryV2(
          artworkPath,
          artworkEntry.name,
          artistId,
          images,
          metadata,
          result
        );
      }
    } catch (error) {
      const errorMsg = `Failed to scan artwork directories in ${artistPath}: ${error instanceof Error ? error.message : "Unknown error"}`;
      result.errors.push(errorMsg);
      this.logger.error(
        { error, artistPath },
        "Artwork directories scan failed"
      );
    }
  }

  // 解析元数据文件 (*_metadata.txt)
  private async parseMetadata(artworkPath: string): Promise<MetadataInfo> {
    const metadata: MetadataInfo = {
      description: undefined,
      tags: [],
    };

    const normalizeSection = (line: string) => line.trim().replace(/:$/, "");

    try {
      const entries = await fs.readdir(artworkPath);
      const metadataFile = entries.find((entry) => {
        const lower = entry.toLowerCase();
        // 兼容 *_metadata.txt、*-metadata.txt 与 metadata.txt
        if (/(-|_)?meta\.txt$/.test(lower)) return true;

        return (
          lower.endsWith("_metadata.txt") ||
          lower.endsWith("-metadata.txt") ||
          lower === "metadata.txt"
        );
      });

      if (!metadataFile) {
        return metadata;
      }

      const metadataPath = path.join(artworkPath, metadataFile);
      const content = await fs.readFile(metadataPath, "utf-8");

      // 解析元数据文件内容（兼容 CRLF）
      const lines = content.split(/\r?\n/).map((line) => line.trim());
      let i = 0;

      while (i < lines.length) {
        const raw = lines[i];
        const section = normalizeSection(raw);

        // 处理 Description 段，可能为空或多行
        if (section === "Description") {
          i += 1;
          const descLines: string[] = [];

          // 收集描述内容直到遇到下一个段落标题或文件结束
          while (i < lines.length) {
            const peek = lines[i];
            const peekNorm = normalizeSection(peek);

            // 如果遇到已知的段落标题，停止收集描述
            if (this.isMetadataSection(peek)) {
              break;
            }

            // 即使是空行也收集（保持原始格式）
            descLines.push(peek);
            i += 1;
          }

          const desc = descLines.join("\n").trim();
          if (desc) {
            metadata.description = desc;
          }
          // 不要 continue，让外层循环处理当前的段落标题
          continue;
        }

        // 处理 Tags 段
        if (section === "Tags") {
          i += 1;
          while (i < lines.length) {
            const tagLineRaw = lines[i];

            // 如果遇到下一个段落标题，停止处理标签
            if (this.isMetadataSection(tagLineRaw)) {
              break;
            }

            // 只有非空行才处理
            if (tagLineRaw.trim()) {
              // 支持以 # 或 - 开头的标记
              let t = tagLineRaw.trim();
              if (t.startsWith("#")) t = t.slice(1);
              else if (t.startsWith("- ")) t = t.slice(2);
              t = t.trim();
              if (t) metadata.tags.push(t);
            }
            i += 1;
          }
          // Tags 处理完毕，不需要继续
          break;
        }

        i += 1;
      }

      this.logger.debug(
        `Parsed metadata for ${artworkPath}: ${metadata.tags.length} tags, description: ${!!metadata.description}`
      );
    } catch (error) {
      this.logger.warn({ error, artworkPath }, "Failed to parse metadata file");
    }

    return metadata;
  }

  // 检查是否是元数据文件的段落标题（大小写不敏感，兼容冒号）
  private isMetadataSection(line: string): boolean {
    const sections = [
      "ID",
      "URL",
      "Original",
      "Thumbnail",
      "xRestrict",
      "AI",
      "User",
      "UserID",
      "Title",
      "Description",
      "Tags",
      "Size",
      "Bookmark",
      "Date",
    ];
    const normalized = line.trim().replace(/:$/, "");
    const lower = normalized.toLowerCase();
    return sections.some((s) => s.toLowerCase() === lower);
  }

  // 收集目录下的所有图片文件 - 增强错误处理
  private async collectImagesFromDirectory(
    dirPath: string,
    extensions: string[]
  ): Promise<string[]> {
    const images: string[] = [];

    try {
      // 首先检查路径是否可访问
      if (!(await this.isPathAccessible(dirPath))) {
        return images;
      }

      // 规范化路径，处理可能的空格和特殊字符
      const normalizedPath = path.normalize(dirPath);
      
      // 使用更安全的方式读取目录
      let entries;
      try {
        entries = await fs.readdir(normalizedPath, { withFileTypes: true });
      } catch (fsError) {
        // 如果readdir失败，尝试使用不同的编码方式
        this.logger.warn(
          { 
            error: fsError instanceof Error ? fsError.message : 'Unknown error', 
            dirPath: normalizedPath,
            originalPath: dirPath 
          },
          `Failed to read directory with withFileTypes, trying alternative method: ${normalizedPath}`
        );
        
        try {
          // 尝试不使用withFileTypes选项
          const fileNames = await fs.readdir(normalizedPath);
          entries = [];
          
          // 手动检查每个文件类型
          for (const fileName of fileNames) {
            try {
              const filePath = path.join(normalizedPath, fileName);
              const stat = await fs.stat(filePath);
              entries.push({
                name: fileName,
                isFile: () => stat.isFile(),
                isDirectory: () => stat.isDirectory()
              });
            } catch (statError) {
              this.logger.warn(
                { 
                  error: statError instanceof Error ? statError.message : 'Unknown error', 
                  fileName, 
                  dirPath: normalizedPath 
                },
                `Failed to stat file: ${fileName}`
              );
              continue;
            }
          }
        } catch (fallbackError) {
          this.logger.error(
            { 
              error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error', 
              dirPath: normalizedPath,
              originalPath: dirPath 
            },
            `All methods failed to read directory: ${normalizedPath}`
          );
          return images;
        }
      }

      // 收集图片文件
      for (const entry of entries) {
        try {
          if (entry.isFile && entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
              images.push(path.join(dirPath, entry.name));
            }
          }
        } catch (entryError) {
          this.logger.warn(
            { 
              error: entryError instanceof Error ? entryError.message : 'Unknown error', 
              entryName: entry.name, 
              dirPath: normalizedPath 
            },
            `Failed to check entry: ${entry.name}`
          );
          continue;
        }
      }
    } catch (error) {
      this.logger.error(
        { 
          error: error instanceof Error ? error.message : 'Unknown error', 
          dirPath,
          stack: error instanceof Error ? error.stack : undefined
        },
        `Critical error in collectImagesFromDirectory: ${dirPath}`
      );
    }

    return images;
  }

  // 创建作品记录（V2.2 版本 - 使用多对多标签关系）
  private async createArtworkFromDirectoryV2(
    artworkPath: string,
    artworkTitle: string,
    artistId: number,
    imagePaths: string[],
    metadata: MetadataInfo,
    result: ScanResult
  ): Promise<void> {
    try {
      // 检查是否已存在相同的作品（基于 artistId + title 的唯一约束）
      let artwork;
      try {
        artwork = await this.prisma.artwork.create({
          data: {
            title: artworkTitle,
            description: metadata.description || null,
            artistId: artistId,
          },
        });
        result.newArtworks++;
        this.logger.info(`Created new artwork: ${artworkTitle}`);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          // 命中唯一约束 (artistId, title) 冲突，查找既有记录并更新元数据
          artwork = await this.prisma.artwork.findFirst({
            where: { title: artworkTitle, artistId: artistId },
          });

          if (artwork) {
            // 更新已存在的作品的描述
            artwork = await this.prisma.artwork.update({
              where: { id: artwork.id },
              data: {
                description: metadata.description || artwork.description,
              },
            });
            this.logger.info(`Updated existing artwork: ${artworkTitle}`);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }

      // 处理标签（多对多关系）
      if (metadata.tags.length > 0) {
        await this.updateArtworkTags(artwork.id, metadata.tags);
      }

      // 处理图片
      for (const imagePath of imagePaths) {
        await this.createImageRecord(imagePath, artwork.id, result);
      }
    } catch (error) {
      const errorMsg = `Failed to create artwork for ${artworkPath}: ${error instanceof Error ? error.message : "Unknown error"}`;
      result.errors.push(errorMsg);
      this.logger.error({ error, artworkPath }, "Artwork creation failed");
    }
  }

  // 更新作品标签（多对多关系）
  private async updateArtworkTags(
    artworkId: number,
    tagNames: string[]
  ): Promise<void> {
    try {
      // 首先删除该作品的所有现有标签关联
      await this.prisma.artworkTag.deleteMany({
        where: { artworkId },
      });

      // 为每个标签创建或查找记录，然后建立关联
      for (const tagName of tagNames) {
        if (!tagName.trim()) continue;

        // 查找或创建标签
        const tag = await this.prisma.tag.upsert({
          where: { name: tagName.trim() },
          update: {},
          create: { name: tagName.trim() },
        });

        // 创建作品-标签关联
        await this.prisma.artworkTag.create({
          data: {
            artworkId,
            tagId: tag.id,
          },
        });
      }

      this.logger.debug(
        `Updated tags for artwork ${artworkId}: ${tagNames.length} tags`
      );
    } catch (error) {
      this.logger.error(
        { error, artworkId, tagNames },
        "Failed to update artwork tags"
      );
    }
  }

  private async cleanupExistingData(): Promise<void> {
    try {
      // 使用事务确保原子性：先删 Image，再删 Artwork，最后删 Artist
      await this.prisma.$transaction([
        this.prisma.image.deleteMany({}),
        this.prisma.artwork.deleteMany({}),
        this.prisma.artist.deleteMany({}),
      ]);
      this.logger.info("Cleaned up existing data for force update");
    } catch (error) {
      this.logger.error({ error }, "Failed to cleanup existing data");
      throw error;
    }
  }

  private async cleanupEmptyArtworks(): Promise<number> {
    try {
      // 查找没有图片的作品
      const emptyArtworks = await this.prisma.artwork.findMany({
        where: {
          images: {
            none: {},
          },
        },
        select: { id: true, title: true },
      });

      if (emptyArtworks.length > 0) {
        // 删除这些作品
        const artworkIds = emptyArtworks.map((a) => a.id);
        await this.prisma.artwork.deleteMany({
          where: { id: { in: artworkIds } },
        });

        this.logger.info(
          `Removed ${emptyArtworks.length} artworks without images`
        );
        return emptyArtworks.length;
      }

      return 0;
    } catch (error) {
      this.logger.error({ error }, "Failed to cleanup empty artworks");
      return 0;
    }
  }

  private async findOrCreateArtist(artistName: string) {
    try {
      // 解析艺术家名称，尝试拆分为用户名和用户ID
      const { displayName, username, userId } =
        this.parseArtistName(artistName);

      // 如果解析出了 username + userId，使用 upsert 基于复合唯一键避免竞态
      if (username && userId) {
        try {
          const created = await this.prisma.artist.create({
            data: {
              name: displayName,
              username,
              userId,
              bio: `Artist: ${username} (ID: ${userId})`,
            },
          });
          this.logger.info(
            `Created new artist: ${displayName} (${username}, ${userId})`
          );
          return created;
        } catch (e) {
          // 如果是重复键错误，则查询并返回已有记录
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2002"
          ) {
            const existing = await this.prisma.artist.findUnique({
              where: {
                unique_username_userid: { username, userId },
              } as any,
            });
            if (existing) {
              this.logger.debug(`Found existing artist: ${displayName}`);
              return existing;
            }
          }
          throw e;
        }
      }

      // 否则按原始名称兜底（name 非唯一，无法使用 upsert）
      let artist = await this.prisma.artist.findFirst({
        where: { name: artistName },
      });

      if (!artist) {
        artist = await this.prisma.artist.create({
          data: {
            name: displayName,
            username: null,
            userId: null,
            bio: `Artist discovered from directory: ${artistName}`,
          },
        });
        this.logger.info(`Created new artist: ${displayName}`);
      }

      return artist;
    } catch (error) {
      this.logger.error(
        { error, artistName },
        "Failed to find or create artist"
      );
      return null;
    }
  }

  /**
   * 解析艺术家名称，支持多种格式：
   * - "用户名 (用户ID)" 格式，如 "Aisey (102941617)"
   * - "用户名-用户ID" 格式
   * - 原始名称
   */
  private parseArtistName(artistName: string): {
    displayName: string;
    username: string | null;
    userId: string | null;
  } {
    // 优先匹配 "用户名 (用户ID)" 格式
    let match = artistName.match(/^(.+?)\s*\((\d+)\)$/);

    if (match) {
      const username = match[1].trim();
      const userId = match[2].trim();

      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username,
          username: username,
          userId: userId,
        };
      }
    }

    // 次优匹配 "用户名-数字ID" 或 "用户名-字母数字ID" 格式
    match = artistName.match(/^(.+?)-(\d+|[a-zA-Z0-9]+)$/);

    if (match) {
      const username = match[1].trim();
      const userId = match[2].trim();

      // 确保用户名不为空，用户ID看起来合理（至少2位）
      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username,
          username: username,
          userId: userId,
        };
      }
    }

    // 如果解析失败，返回原始名称
    return {
      displayName: artistName,
      username: null,
      userId: null,
    };
  }

  private async createImageRecord(
    imagePath: string,
    artworkId: number,
    result: ScanResult
  ): Promise<void> {
    try {
      // 计算相对扫描根目录的相对路径（用于容器挂载路径统一）
      let relPath = imagePath;
      const root = this.scanRootAbs;
      if (root) {
        const maybeRel = path.relative(root, imagePath);
        if (!maybeRel.startsWith("..")) {
          relPath = maybeRel.replace(/\\/g, "/");
        }
      }

      // 去重：兼容历史绝对路径与新的相对路径
      const existingImage = await this.prisma.image.findFirst({
        where: { OR: [{ path: relPath }, { path: imagePath }] },
      });

      if (existingImage) {
        this.logger.debug(`Image already exists: ${relPath}`);
        return;
      }

      // 获取图片文件信息
      const stats = await fs.stat(imagePath);

      // 创建图片记录（统一保存相对路径）
      await this.prisma.image.create({
        data: {
          path: relPath,
          size: stats.size,
          artworkId: artworkId,
          // width 和 height 将在后续版本中通过 sharp 获取
        },
      });

      result.newImages++;
      this.logger.debug(`Created image record: ${path.basename(imagePath)}`);
    } catch (error) {
      const errorMsg = `Failed to create image record for ${imagePath}: ${error instanceof Error ? error.message : "Unknown error"}`;
      result.errors.push(errorMsg);
      this.logger.warn({ error, imagePath }, "Image record creation failed");
    }
  }
}
