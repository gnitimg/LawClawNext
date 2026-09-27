---
name: rag-knowledge-base
description: RAG 知识库管理。添加 URL/PDF/文件到知识库，语义检索相关内容。当用户提到"知识库""检索知识库""添加到知识库""搜索知识库"时触发。
metadata:
  {
    "openclaw":
      {
        "emoji": "📚",
        "os": ["linux", "darwin", "win32"]
      }
  }
---

# RAG 知识库

基于 ChromaDB + 硅基流动 BGE-M3 的本地知识库系统。支持添加网页、PDF、本地文件，并进行语义检索。

## 系统信息

- **工作目录**：当前案件工作区内由 LawClaw 创建的知识库目录
- **向量数据库**: ChromaDB (本地持久化)
- **Embedding**: 硅基流动 BAAI/bge-m3 (1024维)
- **Python**: python3

## 操作命令

所有操作都在当前案件工作区内执行。不得假设存在 Linux home、OpenClaw 工作区或 WSL。

### 1. 添加数据源

```bash
# 添加网页（自动写入 sources.json + 立即索引）
python3 -m rag.core add "https://example.com/article"

# 添加 PDF
python3 -m rag.core add "/path/to/document.pdf"

# 添加本地文件（指定名称）
python3 -m rag.core add "/path/to/file.md" --name "民法典节选"

# 查看 sources.json 中的所有数据源
python3 -m rag.core sources

# 同步 sources.json 到知识库（批量索引新增项）
python3 -m rag.core sync

# 启用/禁用数据源
python3 -m rag.core enable "https://xxx.com"
python3 -m rag.core disable "https://xxx.com"
```

### sources.json 格式

```json
{
  "sources": [
    {
      "target": "https://wenshu.court.gov.cn/",
      "type": "weblink",
      "name": "中国裁判文书网",
      "enabled": true
    },
    {
      "target": "/path/to/file.pdf",
      "type": "document",
      "name": "案件材料",
      "enabled": true
    }
  ]
}
```

type 可选值: `weblink` | `document` | `pdf`

### 2. 语义检索

```bash
python3 -m rag.core search "盗窃罪的量刑标准"
```

返回格式化结果，包含相似度分数和来源信息。

### 3. 列出所有来源

```bash
python3 -m rag.core list
```

### 4. 统计信息

```bash
python3 -m rag.core stats
```

### 5. 删除来源

```bash
python3 -m rag.core remove "https://example.com/article"
```

## 工作流程

### 用户添加知识库内容时

1. 执行 `python3 -m rag.core add "<URL或路径>"`
2. 确认添加成功，报告分块数
3. 更新 `memory/YYYY-MM-DD.md` 记录

### 用户提问需要检索时

1. 执行 `python3 -m rag.core search "<问题>"`
2. 将检索结果作为上下文
3. 结合检索结果回答用户问题
4. 引用来源

### 批量添加

当用户提供多个 URL 时，逐个执行 add 命令。每次添加间隔 2 秒避免 API 限流。

```bash
python3 -m rag.core add "URL1"
sleep 2
python3 -m rag.core add "URL2"
sleep 2
python3 -m rag.core add "URL3"
```

## 集成法律工作流

### 法条检索增强

当法律任务需要法条验证时：
1. 先从知识库检索相关法条
2. 再用 WebSearch 验证
3. 两者结合给出答案

### 判例库建设

逐步添加常用判例到知识库：
```bash
# 添加裁判文书网的判例页面
python3 -m rag.core add "https://wenshu.court.gov.cn/..."

# 添加法律数据库
python3 -m rag.core add "https://flk.npc.gov.cn/..."
```

## 注意事项

1. **网页抓取限制**: 部分网站有反爬机制，可能抓取失败
2. **PDF 质量**: 扫描版 PDF 无法提取文字，需要 OCR
3. **向量库大小**: ChromaDB 存储在本地 `rag/chroma_db/` 目录
4. **API 限流**: 硅基流动 API 有频率限制，批量添加时需间隔
5. **数据安全**: 所有数据存储在本地，不上传第三方
