# Resume Parsing Platform

AI 智能简历填写产品的后端服务 + Web 前端 + Chrome 插件。上传简历 → 多模态模型解析为结构化 JSON → 插件扫描小鹏/飞书招聘页面 → 平台返回逐字段填写方案 → 插件执行受控 DOM 填写。

> 当前版本聚焦小鹏招聘及其他飞书招聘系页面，不再承诺覆盖所有招聘网站。复杂字段仍由模型结合结构化简历和页面字段语义判断，确定性 DOM 规则集中服务 Feishu/Formily/UD 组件。

---

## Quickstart

### Option A: 一键启动（推荐给测试/交付用户）

先安装基础运行环境：

| 平台 | 需要预装 |
|---|---|
| Windows | Python 3.11+、Chrome |
| macOS | Python 3.11+、Chrome、`brew install poppler` |
| Linux | Python 3.11+、Chrome/Chromium、`poppler-utils` |

如果是从 Git 源码直接运行，还需要 Node.js LTS 来首次构建前端。如果使用 `scripts/package_release.py` 生成的交付包，包内已经包含 `web/dist`，普通用户不需要安装 Node.js。

然后在项目根目录运行：

```bash
python start_cv_rec.py
```

也可以使用平台包装入口：

```bash
# Windows
start_cv_rec.bat

# macOS / Linux
./start_cv_rec.sh
```

启动器会自动完成：

1. 创建 `.venv`
2. 安装后端依赖
3. 首次生成 `.env`
4. 安装前端依赖
5. 构建 `web/dist`
6. 启动 FastAPI，并由后端直接托管前端页面
7. 自动打开浏览器访问 `http://127.0.0.1:8000`

首次解析简历前，需要在 `.env` 中填写 `GLM_API_KEY` 或 `QWEN_API_KEY`，也可以登录后在管理员模型配置页填写。

本地 SQLite 数据库会在首次启动后端时自动创建，默认路径为 `data/dev.db`。`data/` 是本机运行数据目录，不进入 Git，也不会被 `scripts/package_release.py` 打入交付 zip；队友首次运行会得到一个空数据库，需要自行注册账号、配置模型 API key 并上传简历。

Chrome 插件仍需加载一次：

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `With_Le/chrome-extension`
5. 回到网页登录/上传简历，`/plugin?autolink=1` 会自动连接插件

生成交付 zip：

```bash
.venv/bin/python scripts/package_release.py
# 输出 dist/cv-rec-release.zip
```

### Option B: 手动开发启动

```bash
# 1. 后端
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# 编辑 .env，填写 GLM_API_KEY 或 QWEN_API_KEY（也可启动后通过管理员页面配置）
uvicorn app.main:app --reload
# API: http://127.0.0.1:8000   docs: http://127.0.0.1:8000/docs

# 2. 前端（另一终端）
cd web
npm install
npm run dev
# 浏览器访问 http://localhost:5173
# Vite 已配置 /api 代理，无需 CORS

# 3. 测试
pytest                                  # 后端测试
cd web && npm run build                 # 前端构建检查
node --test With_Le/chrome-extension/tests/*.test.js

# 4. 后端基础连通自检
.venv/bin/python scripts/backend_smoke_check.py

# 5. 简历解析链路自检
.venv/bin/python scripts/resume_parse_chain_check.py

# 6. 简历数据质量自检
.venv/bin/python scripts/resume_data_quality_check.py --resume-id <resume_id>

# 7. Chrome 插件打包预检 / 生成 zip
.venv/bin/python scripts/package_extension.py --dry-run
.venv/bin/python scripts/package_extension.py
```

日志默认同时输出到控制台与 `./data/logs/app.log`，文件日志为 JSON Lines，并按大小自动轮转。

## Web 界面

| 路径 | 角色 | 说明 |
|---|---|---|
| `/login` | 公开 | 普通用户登录 |
| `/register` | 公开 | 普通用户注册 |
| `/profile` | 用户 | 简历预览 + 字段级修正 |
| `/upload` | 用户 | 拖拽上传，可单次开启增强推理 |
| `/plugin` | 用户 | 自动连接 Chrome 插件；提供手动参数兜底 |
| `/admin/stats` | 管理员 | 用户数 / 调用量 / token / 成本 |
| `/admin/models` | 管理员 | Provider 切换 + API Key / OCR / 视觉 / 对话 / 推理模型配置 + Thinking 默认策略 + 连通性测试 |
| `/admin/users` | 管理员 | 用户列表 + 简历数 + 累计成本 |

## 插件连接流程

1. 在 Chrome 扩展管理页加载 `With_Le/chrome-extension`。
2. 打开插件弹窗，点击“打开平台”进入 Web 前端注册或登录。
3. 登录后网页会进入 `/plugin?autolink=1`，自动把平台地址、登录 token 和可用简历 ID 写入插件。
4. 如浏览器未检测到插件，可在 `/plugin` 复制手动连接参数到插件弹窗保存。
5. 打开小鹏或飞书招聘系简历填写页，点击“开始自动填写”。插件会扫描页面字段、请求后端匹配方案，并执行受控 DOM 填写；非飞书招聘页面会直接停止并提示不支持。

## 完整调用示例

```bash
# 注册用户（拿到 Bearer token）
curl -X POST http://127.0.0.1:8000/api/v1/auth/user/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"pass123456"}'

# → {"user_id":"...","username":"alice","token":"...","is_admin":false}

# 上传简历（同步等待解析完成）
TOKEN=...
curl -X POST http://127.0.0.1:8000/api/v1/resumes \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./your_resume.pdf" \
  -F "thinking_mode=disabled"

# 请求填写方案。把示例里的 resumeId 替换为上传简历后返回的真实 ID。
curl -X POST http://127.0.0.1:8000/api/v1/fill-plans \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/form_fields.json

# 插件兼容方案接口（返回 mappings/actions/skipped/sectionActions）
curl -X POST http://127.0.0.1:8000/api/v1/fill-plans/plugin-match \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/form_fields.json
```

---

## 当前 MVP 范围

- ✅ 简历上传（PDF/DOCX/PNG/JPG）+ 同步多模态解析
- ✅ 结构化 JSON 输出（`schema_version=1.6`，含教育排名 `ranking`、实习经历 `internship_experience`、校园经历 `campus_experience`、工具技能 `skills.tools` 与动态事实 `facts`）
- ✅ 用户手动修正解析结果
- ✅ 智能填写方案接口
- ✅ 填写方案缓存（DB 实现，TTL 7 天）
- ✅ 简历内容哈希去重
- ✅ Bearer token 认证 + 用户隔离
- ✅ GLM / Qwen 模型切换 + 运行时管理员配置
- ✅ 管理员后台（模型配置 / 用户管理 / 成本统计）
- ✅ React 前端（用户预览 / 上传 / 管理员后台）
- ✅ 浏览器插件自动连接页 + 小鹏/飞书招聘页面扫描与受控填写
- ✅ 插件运行时门控：非飞书招聘系页面直接停止
- ✅ 后端自动化测试 + 插件 manifest / service worker / autofill smoke 测试

未在 MVP 中：异步队列、对象存储、多模型路由降级、Redis 缓存、敏感字段加密、速率限制。

---

## License

Proprietary, internal use only.
