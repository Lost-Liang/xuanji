#!/usr/bin/env node
/**
 * 插入 workflow V2 到 graph_definitions 表
 *
 * 功能：
 * 1. 读取 ruoyi-dev-flow-v2.yaml 文件
 * 2. 转换为 GraphDef 对象
 * 3. 插入/更新到数据库
 */

import { db } from '../dist/db.mjs'
import { loadWorkflowFromFile, mapYamlToGraphDef } from '../dist/graph/yaml-loader.mjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 获取当前文件所在目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// YAML 文件路径（相对于项目根目录）
const YAML_PATH = join(__dirname, '../workflows/ruoyi-dev-flow-v2.yaml')

async function main() {
  console.log('开始插入 workflow V2 到数据库...\n')

  try {
    // Step 1: 读取 YAML 文件
    console.log('Step 1: 读取 YAML 文件')
    console.log(`  路径: ${YAML_PATH}`)

    const workflowDef = await loadWorkflowFromFile(YAML_PATH)
    console.log(`  ✓ 加载成功: ${workflowDef.id}`)
    console.log(`    节点数: ${workflowDef.nodes.length}`)
    console.log(`    边数: ${workflowDef.edges.length}\n`)

    // Step 2: 转换为 GraphDef
    console.log('Step 2: 转换为 GraphDef')
    const graphDef = mapYamlToGraphDef(workflowDef)
    console.log(`  ✓ 转换成功: ${graphDef.id}`)
    console.log(`    名称: ${graphDef.name}\n`)

    // Step 3: 插入/更新数据库
    console.log('Step 3: 插入/更新数据库')

    const result = await db.graph_definitions.upsert({
      where: { id: 'ruoyi-dev-flow-v2' },
      create: {
        id: 'ruoyi-dev-flow-v2',
        name: '若依研发流程 V2',
        description: '真正的 TDD + 编译检查 + 安全扫描 + 修复验证',
        plugin_id: null,
        definition_json: graphDef,
        created_at: new Date(),
        updated_at: new Date()
      },
      update: {
        name: '若依研发流程 V2',
        description: '真正的 TDD + 编译检查 + 安全扫描 + 修复验证',
        definition_json: graphDef,
        updated_at: new Date()
      }
    })

    console.log(`  ✓ 数据库操作成功`)
    console.log(`    ID: ${result.id}`)
    console.log(`    创建时间: ${result.created_at.toISOString()}`)
    console.log(`    更新时间: ${result.updated_at.toISOString()}\n`)

    console.log('✅ Workflow V2 已成功插入到 graph_definitions 表\n')

  } catch (error) {
    console.error('❌ 错误:', error)
    process.exit(1)
  } finally {
    await db.$disconnect()
  }
}

main()