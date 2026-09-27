---
name: status-polling
description: 案件分析状态轮询。每5秒查询一次案件处理进度，同步更新案件处理流程、分析进度、五类产物生成进度。触发词：status-polling、轮询状态、查询进度。
metadata:
  {
    "openclaw":
      {
        "emoji": "🔄",
        "os": ["linux", "darwin", "win32"]
      }
  }
---

# 案件分析状态轮询

## 触发条件

当用户启动案件分析后，自动激活状态轮询。轮询间隔 5 秒。

## 轮询目标

读取任务状态文件：`${outputDir}/.lawclaw-task-${taskId}.json`

## 状态阶段定义

| 阶段 | currentStep | 说明 | 进度范围 |
|------|-------------|------|----------|
| 案件材料扫描 | `scanning` | 扫描案件目录下的文件 | 0-15% |
| 图像识别 | `ocr` | 对图片/PDF 进行 OCR 识别 | 15-25% |
| 文件脱敏 | `desensitizing` | 脱敏处理 | 25-35% |
| 本地索引 | `indexing` | 建立本地索引 | 35-40% |
| 脱敏片段提交 | `submitting` | 提交给 OpenClaw agent | 40-50% |
| 案件分析 | `analyzing` | agent 进行案件分析 | 50-60% |
| 五类产物生成 | `drafting` | 生成五类法律文书 | 60-80% |
| 来源校验 | `verifying_sources` | 校验来源依据 | 80-85% |
| 文档交付 | `delivering_docx` | 生成 .docx 文件 | 85-90% |
| 用户审核 | `user_review` | 等待用户审核 | 90-95% |
| 导出 PDF | `exporting_pdf` | 导出 PDF | 95-98% |
| 完成 | `completed` | 分析完成 | 100% |

## 轮询逻辑

```bash
# 每 5 秒读取一次状态文件
while true; do
  sleep 5
  # 读取状态文件
  cat "${outputDir}/.lawclaw-task-${taskId}.json"
  # 解析并更新 UI
done
```

## 状态文件结构

```json
{
  "taskId": "string",
  "status": "running|completed|failed|cancelled",
  "currentStep": "scanning|ocr|...|completed",
  "progress": 0-100,
  "runner": "openclaw_native|model_stream|local_fallback",
  "products": [
    {
      "type": "case_analysis_report",
      "status": "pending|running|completed|failed",
      "progress": 0-100
    }
  ],
  "steps": [
    {
      "id": "scanning",
      "status": "completed|running|pending|failed"
    }
  ],
  "logs": ["message1", "message2"],
  "error": "error message if failed",
  "updatedAt": "ISO timestamp"
}
```

## UI 同步规则

### 1. 案件处理流程（SnakeProgressCard）

从 `steps` 数组渲染，每个 step 对应一个节点：
- `completed` → 绿色 ✓
- `running` → 蓝色旋转
- `pending` → 灰色
- `failed` → 红色 ✗

### 2. 分析进度（PipelineMessageCard）

从 `progress` 和 `currentStep` 渲染：
- 进度条：0-100%
- 当前阶段文本：映射到中文名称
- 运行器标识：`openclaw_native` / `model_stream` / `local_fallback`

### 3. 五类产物生成进度（ProductBranchProgress）

从 `products` 数组渲染：
- 每个 product 独立进度条
- 状态：pending → running → completed/failed
- 进度：0-100%

## 最小输出原则

轮询结果只输出三行摘要：

```
进度: ${progress}% | 阶段: ${中文阶段名} | 产物: ${completedProducts}/${totalProducts}
```

示例：
```
进度: 65% | 阶段: 五类产物生成 | 产物: 2/5
```

## 错误处理

- 状态文件不存在 → 显示"等待任务启动..."
- 状态文件解析失败 → 显示"状态读取异常"
- 任务失败 → 显示错误信息和失败阶段
- 任务取消 → 显示"任务已取消"

## 生命周期

1. 用户点击"开始分析" → 轮询启动
2. 状态变为 `completed` / `failed` / `cancelled` → 轮询停止
3. 用户关闭页面 → 轮询停止
