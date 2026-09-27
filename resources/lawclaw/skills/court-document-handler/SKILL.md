---
name: court-document-handler
description: Use when message contains "广西法院短信平台" or "法院向您发送" or "sfsdw" or "文书详见" or case number pattern (20XX)桂. 法院送达短信自动处理，必须使用 openclaw browser 命令（不能用 web_fetch），自动下载PDF、提取信息、微信汇报并发送PDF、设置提醒。全自动，无需人工干预。
metadata:
  {
    "openclaw": {
      "emoji": "⚖️",
      "os": ["linux", "darwin", "win32"]
    }
  }
---

# Court Document Handler

自动处理法院送达短信，下载文书、提取信息、微信汇报并发送PDF、设置提醒。**全自动处理，无需人工干预。**

## ⚠️ 重要：必须使用浏览器

**这个 skill 必须使用 `openclaw browser` 命令来处理！**

- ❌ 不能用 `web_fetch`（法院系统需要验证码）
- ✅ 必须用 `openclaw browser start` 启动浏览器
- ✅ 用 `openclaw browser open` 访问链接
- ✅ 用 `openclaw browser type` 输入验证码 886288
- ✅ 用 `openclaw browser download` 下载 PDF

## Trigger

收到包含以下特征的短信内容：
- 发送方：广西法院短信平台 / 法院送达
- 包含链接：`http://171.106.48.55:28083/sfsdw//r/`
- 包含案号格式：`(20XX)桂XXXX民初XXXX号`

## Workflow

```
收到短信 → 提取链接 → 浏览器访问 → 手机验证(886288) → 获取文书 → 下载PDF → 提取信息 → 微信汇报+发送PDF → 设置提醒
```

## Configuration

### 固定配置
```yaml
phone_suffix: "886288"  # 手机号后六位验证
timezone: "Asia/Shanghai"  # 默认时区（北京时间）
```

### 提醒规则

| 文书类型 | 提醒时机 | 提醒内容 |
|---------|---------|---------|
| 传票/出庭通知 | 开庭前1天 09:00 | 开庭时间、地点、注意事项 |
| 判决书 | 收到后15天 09:00 | 上诉截止日提醒 |
| 应诉通知书 | 收到后10天 09:00 | 答辩截止日提醒 |
| 举证通知书 | 截止日前3天 09:00 | 举证截止日提醒 |
| 其他 | 无 | 仅汇报，不设提醒 |

## Step-by-Step

### 1. 提取链接

从短信中正则匹配：
```
http://171\.106\.48\.55:28083/sfsdw//r/[A-Za-z0-9]+
```

### 2. 浏览器操作

使用 `openclaw browser` 命令：

```bash
# 启动浏览器
openclaw browser start

# 打开链接
openclaw browser open "<LINK>"

# 等待页面加载
sleep 2

# 获取页面快照
openclaw browser snapshot --interactive

# 输入手机号后六位
openclaw browser type e2 "886288"

# 点击确认
openclaw browser click e4

# 等待验证
sleep 3

# 获取文书列表
openclaw browser snapshot --interactive
```

### 3. 获取案件信息

点击文书链接后，使用evaluate提取：

```bash
openclaw browser evaluate --fn '() => document.body.innerText'
```

### 4. 下载PDF

```bash
# 点击下载按钮（ref从snapshot获取）
openclaw browser download <REF> "<filename>.pdf"
```

PDF保存位置：`/tmp/openclaw/downloads/`

### 5. 提取PDF内容

```bash
pdftotext /tmp/openclaw/downloads/<filename>.pdf -
```

### 6. 解析关键信息

**必提取字段：**
- 案号
- 案由
- 法院
- 被传唤人/当事人
- 承办人

**条件提取（传票）：**
- 开庭时间
- 开庭地点

**条件提取（判决书）：**
- 判决日期（用于计算上诉期）

### 7. 微信汇报并发送PDF

```bash
# 发送汇报消息
openclaw message send \
  --channel openclaw-weixin \
  --account e1a1470017fa-im-bot \
  -t "o9cq803rIUlhkxQniI8yry_atp88@im.wechat" \
  -m "<REPORT>"

# 发送PDF文件
openclaw message send \
  --channel openclaw-weixin \
  --account e1a1470017fa-im-bot \
  -t "o9cq803rIUlhkxQniI8yry_atp88@im.wechat" \
  --media "/tmp/openclaw/downloads/<filename>.pdf" \
  -m "文书原件"
```

汇报模板：
```
📋 法院文书处理完成

【案件信息】
案号：<CASE_NUMBER>
案由：<CASE_TYPE>
法院：<COURT>
被传唤人：<PERSON>
承办人：<JUDGE>

【开庭信息】（仅传票）
📅 时间：<COURT_DATE>
📍 地点：<COURT_VENUE>

【已设置提醒】
⏰ <REMINDER_INFO>

【注意事项】
• 携带传票及有效身份证明报到
• 带齐全部证据原件

📄 文书PDF已发送，请查收。
```

### 8. 设置提醒

使用 `openclaw cron add` 命令创建提醒任务，**必须指定时区 --tz "Asia/Shanghai"**：

```bash
# 开庭前1天提醒示例
openclaw cron add \
  --name "开庭提醒-<CASE_NUMBER>" \
  --at "<REMINDER_DATETIME>" \
  --tz "Asia/Shanghai" \
  --message "开庭提醒：<CASE_NUMBER> 明天开庭" \
  --channel openclaw-weixin \
  --to "o9cq803rIUlhkxQniI8yry_atp88@im.wechat" \
  --announce \
  --delete-after-run
```

**⚠️ 重要：必须使用 --tz "Asia/Shanghai"，否则时间会被当作UTC处理！**

### 9. 关闭浏览器

```bash
openclaw browser stop
```

## Error Handling

| 错误 | 处理 |
|-----|------|
| 链接无法访问 | 微信通知用户手动处理 |
| 验证失败 | 重试一次，仍失败则通知用户 |
| PDF下载失败 | 尝试批量下载，或截图保存 |
| 解析失败 | 发送原始文本，标注"解析失败" |

**重要：所有错误处理后都应发送微信通知，确保用户知晓状态。**

## Example Session

```
用户发送：【广西法院短信平台】...文书详见:http://171.106.48.55:28083/sfsdw//r/ABC123

助手：
1. 识别为法院短信 → 触发skill
2. 提取链接：http://171.106.48.55:28083/sfsdw//r/ABC123
3. 启动浏览器 → 访问链接
4. 输入验证码 886288 → 点击确认
5. 获取文书列表 → 点击文书
6. 下载PDF → 提取内容
7. 解析信息：案号、案由、时间、地点
8. 微信发送汇报
9. 创建开庭提醒cron
10. 关闭浏览器
```

## Notes

- **全自动处理，无需人工干预**
- 浏览器操作需等待页面加载，使用 `sleep` 确保稳定
- PDF文件较大时下载可能需要超时设置
- 提醒时间固定为 09:00，可后续调整
- **⚠️ 设置提醒时必须使用 --tz "Asia/Shanghai"，否则时间会被当作UTC处理**
- 仅支持广西法院短信平台链接，其他省份需扩展
- 微信账号：`e1a1470017fa-im-bot`，用户ID：`o9cq803rIUlhkxQniI8yry_atp88@im.wechat`
