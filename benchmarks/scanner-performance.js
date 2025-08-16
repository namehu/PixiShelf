/**
 * 文件扫描器性能基准测试
 * 比较优化前后的性能差异
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 模拟的测试数据生成器
class TestDataGenerator {
  constructor(basePath) {
    this.basePath = basePath;
  }

  async generateTestStructure(artistCount = 10, artworksPerArtist = 5, imagesPerArtwork = 3) {
    console.log(`生成测试数据: ${artistCount} 个艺术家, 每个 ${artworksPerArtist} 个作品, 每个作品 ${imagesPerArtwork} 张图片`);
    
    // 清理现有测试数据
    await this.cleanup();
    
    // 创建基础目录
    await fs.mkdir(this.basePath, { recursive: true });
    
    for (let i = 1; i <= artistCount; i++) {
      const artistName = `Artist${i.toString().padStart(3, '0')} (${1000 + i})`;
      const artistPath = path.join(this.basePath, artistName);
      await fs.mkdir(artistPath, { recursive: true });
      
      for (let j = 1; j <= artworksPerArtist; j++) {
        const artworkName = `Artwork${j.toString().padStart(3, '0')}`;
        const artworkPath = path.join(artistPath, artworkName);
        await fs.mkdir(artworkPath, { recursive: true });
        
        // 创建元数据文件
        const metadataContent = `Title: ${artworkName}
Description: Test artwork description for ${artworkName}
Tags:
- tag${j}
- test
- benchmark`;
        await fs.writeFile(path.join(artworkPath, 'metadata.txt'), metadataContent);
        
        // 创建模拟图片文件
        for (let k = 1; k <= imagesPerArtwork; k++) {
          const imageName = `image${k.toString().padStart(3, '0')}.jpg`;
          const imagePath = path.join(artworkPath, imageName);
          // 创建一个小的模拟文件
          await fs.writeFile(imagePath, Buffer.alloc(1024, 0)); // 1KB 模拟图片
        }
      }
    }
    
    console.log(`测试数据生成完成: ${this.basePath}`);
  }
  
  async cleanup() {
    try {
      await fs.rm(this.basePath, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  }
}

// 性能测试运行器
class PerformanceBenchmark {
  constructor() {
    this.results = [];
  }
  
  async runBenchmark(name, testFunction, iterations = 1) {
    console.log(`\n开始基准测试: ${name}`);
    const times = [];
    const memoryUsages = [];
    
    for (let i = 0; i < iterations; i++) {
      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }
      
      const startMemory = process.memoryUsage();
      const startTime = performance.now();
      
      try {
        await testFunction();
      } catch (error) {
        console.error(`测试失败 (第${i + 1}次):`, error.message);
        continue;
      }
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      
      const duration = endTime - startTime;
      const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
      
      times.push(duration);
      memoryUsages.push(memoryDelta);
      
      console.log(`  第${i + 1}次: ${duration.toFixed(2)}ms, 内存变化: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const avgMemory = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    const result = {
      name,
      iterations,
      avgTime: avgTime.toFixed(2),
      minTime: minTime.toFixed(2),
      maxTime: maxTime.toFixed(2),
      avgMemory: (avgMemory / 1024 / 1024).toFixed(2),
      times,
      memoryUsages
    };
    
    this.results.push(result);
    
    console.log(`${name} 完成:`);
    console.log(`  平均时间: ${result.avgTime}ms`);
    console.log(`  最快时间: ${result.minTime}ms`);
    console.log(`  最慢时间: ${result.maxTime}ms`);
    console.log(`  平均内存: ${result.avgMemory}MB`);
    
    return result;
  }
  
  generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('性能基准测试报告');
    console.log('='.repeat(80));
    
    this.results.forEach(result => {
      console.log(`\n${result.name}:`);
      console.log(`  迭代次数: ${result.iterations}`);
      console.log(`  平均时间: ${result.avgTime}ms`);
      console.log(`  时间范围: ${result.minTime}ms - ${result.maxTime}ms`);
      console.log(`  平均内存: ${result.avgMemory}MB`);
    });
    
    // 性能对比
    if (this.results.length >= 2) {
      console.log('\n性能对比:');
      const baseline = this.results[0];
      for (let i = 1; i < this.results.length; i++) {
        const current = this.results[i];
        const speedup = (parseFloat(baseline.avgTime) / parseFloat(current.avgTime)).toFixed(2);
        const memoryRatio = (parseFloat(current.avgMemory) / parseFloat(baseline.avgMemory)).toFixed(2);
        
        console.log(`  ${current.name} vs ${baseline.name}:`);
        console.log(`    速度提升: ${speedup}x`);
        console.log(`    内存比率: ${memoryRatio}x`);
      }
    }
  }
}

// 模拟扫描器测试
class MockScannerTest {
  constructor(testDataPath, enableOptimizations = false) {
    this.testDataPath = testDataPath;
    this.enableOptimizations = enableOptimizations;
  }
  
  async simulateScan() {
    // 模拟文件系统扫描
    const startTime = Date.now();
    let fileCount = 0;
    let dirCount = 0;
    
    await this.scanDirectory(this.testDataPath);
    
    async function scanDirectory(dirPath) {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        if (this.enableOptimizations) {
          // 模拟并发处理
          const tasks = entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              dirCount++;
              await scanDirectory.call(this, fullPath);
            } else {
              fileCount++;
              // 模拟文件处理
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          });
          
          await Promise.all(tasks);
        } else {
          // 模拟串行处理
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              dirCount++;
              await scanDirectory.call(this, fullPath);
            } else {
              fileCount++;
              // 模拟文件处理
              await new Promise(resolve => setTimeout(resolve, 2));
            }
          }
        }
      } catch (error) {
        // 忽略扫描错误
      }
    }
    
    await scanDirectory.call(this, this.testDataPath);
    
    const duration = Date.now() - startTime;
    
    return {
      duration,
      fileCount,
      dirCount,
      throughput: fileCount / (duration / 1000)
    };
  }
}

// 主测试函数
async function runPerformanceTests() {
  const testDataPath = path.join(__dirname, 'test-data');
  const generator = new TestDataGenerator(testDataPath);
  const benchmark = new PerformanceBenchmark();
  
  try {
    console.log('文件扫描器性能基准测试');
    console.log('='.repeat(50));
    
    // 生成测试数据
    await generator.generateTestStructure(20, 10, 5); // 20个艺术家，每个10个作品，每个作品5张图片
    
    // 测试传统扫描方法
    await benchmark.runBenchmark(
      '传统串行扫描',
      async () => {
        const scanner = new MockScannerTest(testDataPath, false);
        return await scanner.simulateScan();
      },
      3
    );
    
    // 测试优化后的扫描方法
    await benchmark.runBenchmark(
      '优化并发扫描',
      async () => {
        const scanner = new MockScannerTest(testDataPath, true);
        return await scanner.simulateScan();
      },
      3
    );
    
    // 生成报告
    benchmark.generateReport();
    
  } catch (error) {
    console.error('基准测试失败:', error);
  } finally {
    // 清理测试数据
    await generator.cleanup();
  }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  runPerformanceTests().catch(console.error);
}

export { runPerformanceTests, TestDataGenerator, PerformanceBenchmark };