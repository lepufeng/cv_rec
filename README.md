# Resume Parsing Platform

AI 简历智能填写平台：上传简历 → 多模态模型解析为结构化 JSON → Chrome 插件扫描飞书招聘页面 → 自动逐字段填写。

> 当前聚焦飞书招聘系页面（小鹏等），复杂字段由模型结合简历和页面语义判断。

---

## Quickstart

### 一键启动（推荐）

预装依赖：

| 平台 | 需要预装 |
|---|---|
| Windows | Python 3.11+、Chrome |
| macOS | Python 3.11+、Chrome、`brew install poppler` |
| Linux | Python 3.11+、Chrome/Chromium、`poppler-utils` |

从源码运行需额外安装 Node.js LTS；使用 `scripts/package_release.py` 生成的交付包则不需要。

```bash
python start_cv_rec.py
```

启动器自动完成：创建 `.venv`、安装依赖、构建前端、启动服务并打开浏览器 `http://127.0.0.1:8000`。

首次使用需在 `.env` 中填写 `GLM_API_KEY` 或 `QWEN_API_KEY`，也可在管理员模型配置页填写。

### 安装 Chrome 插件

> 插件未上架 Chrome Web Store，需通过「开发者模式」手动加载。以下为完整步骤。

**第一步：打开扩展管理页**

在 Chrome 地址栏输入 `chrome://extensions` 并回车。

**第二步：开启开发者模式**

页面右上角有一个「开发者模式」开关，点击打开。开启后页面顶部会出现一行操作栏。

**第三步：加载插件**

1. 点击操作栏中的「加载已解压的扩展程序」按钮
2. 在弹出的文件夹选择器中，定位到本项目的 `With_Le/chrome-extension` 目录并点击「选择」
   - ⚠️ 选到 `With_Le/chrome-extension` 这一层即可，**不要**进入其子目录
3. 加载成功后扩展列表会出现「CV Rec Autofill」

**第四步：固定到工具栏（推荐）**

1. 点击 Chrome 地址栏右侧的 🧩 拼图图标（扩展管理）
2. 找到「CV Rec Autofill」，点击📌图钉将其固定到工具栏
3. 之后随时点击工具栏的插件图标即可打开操作弹窗

**第五步：连接平台**

1. 启动后端服务（`python start_cv_rec.py`）
2. 点击插件弹窗中的「打开平台」按钮，或直接访问 `http://127.0.0.1:8000/plugin?autolink=1`
3. 在网页注册/登录后，账号和简历信息会自动同步到插件
4. 插件弹窗状态从「未连接」变为「已连接」即表示配置成功

**常见问题**

| 问题 | 解决方式 |
|---|---|
| 提示「无法加载」 | 确认选中的是 `chrome-extension` 目录本身，不是其父目录或子目录 |
| 重启电脑后插件消失 | 开发者模式下插件不会自动删除；如果被禁用，回到 `chrome://extensions` 重新启用 |
| 弹窗显示「未连接」 | 确认后端已启动，点击「打开平台」登录后等待自动同步 |
| 想更新插件代码 | 回到 `chrome://extensions`，点击插件卡片上的刷新🔄按钮即可 |

生成交付包：

```bash
.venv/bin/python scripts/package_release.py
# → dist/cv-rec-release.zip
```

### 手动开发启动

```bash
# 后端
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # 填写 API Key
uvicorn app.main:app --reload
# API: http://127.0.0.1:8000   Docs: http://127.0.0.1:8000/docs

# 前端（另一终端）
cd web && npm install && npm run dev
# http://localhost:5173  （Vite 已配置 /api 代理）

# 测试
pytest                                        # 后端
cd web && npm run build                       # 前端构建检查
node --test With_Le/chrome-extension/tests/*.test.js  # 插件
```

日志同时输出到控制台与 `data/logs/app.log`（JSON Lines，按大小轮转）。

---

## Web 界面

| 路径 | 角色 | 说明 |
|---|---|---|
| `/login` | 公开 | 用户登录 |
| `/register` | 公开 | 用户注册 |
| `/profile` | 用户 | 简历预览 + 字段级修正 |
| `/upload` | 用户 | 拖拽上传，可开启增强推理 |
| `/plugin` | 用户 | 自动连接 Chrome 插件 / 手动参数兜底 |
| `/admin/stats` | 管理员 | 用户数 / 调用量 / token / 成本 |
| `/admin/models` | 管理员 | 模型配置 + 连通性测试 |
| `/admin/users` | 管理员 | 用户列表 + 简历数 + 累计成本 |

## 插件自动填写流程

安装并连接插件后（见上方 Quickstart），使用流程如下：

1. 在网页端上传简历，等待解析完成
2. 打开飞书招聘系填写页面（如小鹏招聘）
3. 点击工具栏插件图标 → 点击「开始自动填写」
4. 插件自动扫描页面字段、匹配简历内容并执行填写
5. 填写完成后查看弹窗中的结果摘要，部分字段可能需要人工确认

> 非飞书招聘页面会自动停止并提示「当前页面不支持」。

## API 示例

```bash
# 注册
curl -X POST http://127.0.0.1:8000/api/v1/auth/user/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"pass123456"}'

# 上传简历
curl -X POST http://127.0.0.1:8000/api/v1/resumes \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./your_resume.pdf"

# 请求填写方案
curl -X POST http://127.0.0.1:8000/api/v1/fill-plans/plugin-match \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/form_fields.json
```

---

## License

Proprietary, internal use only.
