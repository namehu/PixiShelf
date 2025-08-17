#!/usr/bin/env node

/**
 * 配置管理CLI工具
 * 提供配置验证、导出、健康检查等功能
 */

import { program } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  initializeConfig,
  getConfig,
  getConfigSummary,
  checkConfigHealth,
  validateCurrentConfig,
  exportConfig,
  getEnvExample,
} from '../config';
import { checkRequiredEnvVars } from '../config/env-mapping';

// 加载环境变量
dotenv.config();

program
  .name('config-cli')
  .description('PixiShelf API 配置管理工具')
  .version('1.0.0');

// 验证配置命令
program
  .command('validate')
  .description('验证当前配置')
  .option('-v, --verbose', '显示详细信息')
  .action(async (options: { verbose?: boolean }) => {
    try {
      console.log('🔍 正在验证配置...');
      
      // 检查必需的环境变量
      const envCheck = checkRequiredEnvVars();
      if (!envCheck.isValid) {
        console.error('❌ 缺少必需的环境变量:');
        envCheck.missing.forEach(env => console.error(`  - ${env}`));
        process.exit(1);
      }
      
      // 初始化配置
      await initializeConfig({ validate: true });
      
      // 验证配置
      const validation = validateCurrentConfig();
      const health = checkConfigHealth();
      
      if (validation.isValid && health.isHealthy) {
        console.log('✅ 配置验证通过');
      } else {
        console.log('❌ 配置验证失败');
      }
      
      if (validation.errors.length > 0) {
        console.log('\n🚨 配置错误:');
        validation.errors.forEach(error => console.log(`  - ${error}`));
      }
      
      if (validation.warnings.length > 0) {
        console.log('\n⚠️  配置警告:');
        validation.warnings.forEach(warning => console.log(`  - ${warning}`));
      }
      
      if (health.recommendations.length > 0) {
        console.log('\n💡 建议:');
        health.recommendations.forEach(rec => console.log(`  - ${rec}`));
      }
      
      if (options.verbose) {
        console.log('\n📊 配置摘要:');
        const summary = getConfigSummary();
        console.log(JSON.stringify(summary, null, 2));
      }
      
    } catch (error) {
      console.error('❌ 配置验证失败:', (error as Error).message);
      process.exit(1);
    }
  });

// 显示配置命令
program
  .command('show')
  .description('显示当前配置')
  .option('-s, --section <section>', '显示特定配置节 (server, database, scanner, auth, log, monitoring)')
  .option('-p, --path <path>', '显示特定配置路径 (例如: scanner.maxConcurrency)')
  .option('--summary', '只显示配置摘要')
  .action(async (options: { section?: string; path?: string; summary?: boolean }) => {
    try {
      await initializeConfig();
      
      if (options.summary) {
        const summary = getConfigSummary();
        console.log('📊 配置摘要:');
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      
      const config = getConfig();
      
      if (options.section) {
        if (config[options.section as keyof typeof config]) {
          console.log(`📋 ${options.section} 配置:`);
          console.log(JSON.stringify(config[options.section as keyof typeof config], null, 2));
        } else {
          console.error(`❌ 配置节 '${options.section}' 不存在`);
          console.log('可用的配置节: server, database, scanner, auth, log, monitoring');
          process.exit(1);
        }
      } else if (options.path) {
        const value = options.path.split('.').reduce((obj: any, key: string) => obj?.[key], config);
        if (value !== undefined) {
          console.log(`📋 ${options.path}:`);
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.error(`❌ 配置路径 '${options.path}' 不存在`);
          process.exit(1);
        }
      } else {
        console.log('📋 完整配置:');
        console.log(JSON.stringify(config, null, 2));
      }
      
    } catch (error) {
      console.error('❌ 获取配置失败:', (error as Error).message);
      process.exit(1);
    }
  });

// 导出配置命令
program
  .command('export')
  .description('导出配置到文件')
  .argument('<file>', '输出文件路径')
  .option('-f, --format <format>', '输出格式 (json, yaml)', 'json')
  .action(async (file: string, options: { format?: string }) => {
    try {
      await initializeConfig();
      
      const outputPath = path.resolve(file);
      
      if (options.format === 'json') {
        await exportConfig(outputPath);
        console.log(`✅ 配置已导出到: ${outputPath}`);
      } else if (options.format === 'yaml') {
        // 简单的YAML导出（需要yaml库的话可以添加）
        const config = getConfig();
        const yamlContent = JSON.stringify(config, null, 2)
          .replace(/\{/g, '')
          .replace(/\}/g, '')
          .replace(/"/g, '')
          .replace(/,$/gm, '')
          .replace(/^\s*$/gm, '');
        
        await fs.writeFile(outputPath, yamlContent, 'utf-8');
        console.log(`✅ 配置已导出到: ${outputPath} (简化YAML格式)`);
      } else {
        console.error('❌ 不支持的格式，支持的格式: json, yaml');
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ 导出配置失败:', (error as Error).message);
      process.exit(1);
    }
  });

// 生成环境变量示例命令
program
  .command('env-example')
  .description('生成环境变量示例文件')
  .option('-o, --output <file>', '输出文件路径', '.env.example')
  .action(async (options: { output?: string }) => {
    try {
      const envExample = getEnvExample();
      const outputPath = path.resolve(options.output || '.env.example');
      
      await fs.writeFile(outputPath, envExample, 'utf-8');
      console.log(`✅ 环境变量示例已生成: ${outputPath}`);
      
    } catch (error) {
      console.error('❌ 生成环境变量示例失败:', (error as Error).message);
      process.exit(1);
    }
  });

// 健康检查命令
program
  .command('health')
  .description('检查配置健康状态')
  .option('--exit-code', '根据健康状态设置退出码')
  .action(async (options: { exitCode?: boolean }) => {
    try {
      await initializeConfig();
      
      const health = checkConfigHealth();
      
      console.log('🏥 配置健康检查:');
      console.log(`状态: ${health.isHealthy ? '✅ 健康' : '❌ 不健康'}`);
      
      if (health.issues.length > 0) {
        console.log('\n🚨 问题:');
        health.issues.forEach(issue => console.log(`  - ${issue}`));
      }
      
      if (health.recommendations.length > 0) {
        console.log('\n💡 建议:');
        health.recommendations.forEach(rec => console.log(`  - ${rec}`));
      }
      
      if (options.exitCode && !health.isHealthy) {
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ 健康检查失败:', (error as Error).message);
      if (options.exitCode) {
        process.exit(1);
      }
    }
  });

// 检查环境变量命令
program
  .command('check-env')
  .description('检查环境变量设置')
  .action(() => {
    try {
      console.log('🔍 检查环境变量...');
      
      const envCheck = checkRequiredEnvVars();
      
      if (envCheck.isValid) {
        console.log('✅ 所有必需的环境变量都已设置');
      } else {
        console.log('❌ 缺少必需的环境变量:');
        envCheck.missing.forEach(env => console.log(`  - ${env}`));
        
        console.log('\n💡 请设置这些环境变量或创建 .env 文件');
        console.log('可以使用以下命令生成示例文件:');
        console.log('  npm run config env-example');
      }
      
    } catch (error) {
      console.error('❌ 检查环境变量失败:', (error as Error).message);
      process.exit(1);
    }
  });

// 配置向导命令
program
  .command('wizard')
  .description('配置设置向导')
  .action(async () => {
    console.log('🧙 配置设置向导');
    console.log('\n这个向导将帮助您设置 PixiShelf API 的基本配置。');
    
    try {
      // 检查环境变量
      const envCheck = checkRequiredEnvVars();
      if (!envCheck.isValid) {
        console.log('\n❌ 首先需要设置必需的环境变量:');
        envCheck.missing.forEach(env => console.log(`  - ${env}`));
        console.log('\n请创建 .env 文件并设置这些变量，然后重新运行向导。');
        console.log('可以使用以下命令生成示例文件:');
        console.log('  npm run config env-example');
        return;
      }
      
      // 初始化配置
      await initializeConfig();
      
      // 显示当前配置摘要
      const summary = getConfigSummary();
      console.log('\n📊 当前配置摘要:');
      console.log(`  环境: ${summary.env}`);
      console.log(`  已初始化: ${summary.initialized}`);
      console.log(`  验证状态: ${summary.validation.isValid ? '✅ 通过' : '❌ 失败'}`);
      
      // 健康检查
      const health = checkConfigHealth();
      if (!health.isHealthy) {
        console.log('\n⚠️  发现配置问题:');
        health.issues.forEach(issue => console.log(`  - ${issue}`));
      }
      
      if (health.recommendations.length > 0) {
        console.log('\n💡 配置建议:');
        health.recommendations.forEach(rec => console.log(`  - ${rec}`));
      }
      
      console.log('\n✅ 配置向导完成！');
      console.log('\n📚 更多配置选项请参考:');
      console.log('  - 使用 "npm run config show" 查看完整配置');
      console.log('  - 使用 "npm run config validate" 验证配置');
      console.log('  - 查看文档: docs/config-usage-examples.md');
      
    } catch (error) {
      console.error('❌ 配置向导失败:', (error as Error).message);
      process.exit(1);
    }
  });

// 解析命令行参数
program.parse();