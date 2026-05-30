# Resume Parsing Platform

AI 智能简历填写产品的后端服务 + Web 前端 + Chrome 插件。上传简历 → 多模态模型解析为结构化 JSON → 插件扫描小鹏/飞书招聘页面 → 平台返回逐字段填写方案 → 插件执行受控 DOM 填写。

> 当前版本聚焦小鹏招聘及其他飞书招聘系页面，不再承诺覆盖所有招聘网站。复杂字段仍由模型结合结构化简历和页面字段语义判断，确定性 DOM 规则集中服务 Feishu/Formily/UD 组件。

---

## Quickstart

```bash
# 1. 系统依赖（macOS）
brew install poppler          # pdf2image 需要

# 2. 后端
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# 编辑 .env，填写 GLM_API_KEY 或 QWEN_API_KEY（也可启动后通过管理员页面配置）
uvicorn app.main:app --reload
# API: http://127.0.0.1:8000   docs: http://127.0.0.1:8000/docs

# 3. 前端（另一终端）
cd web
npm install
npm run dev
# 浏览器访问 http://localhost:5173
# Vite 已配置 /api 代理，无需 CORS

# 4. 测试
pytest                                  # 后端测试
cd web && npm run build                 # 前端构建检查
node --test With_Le/chrome-extension/tests/*.test.js

# 5. 后端基础连通自检
.venv/bin/python scripts/backend_smoke_check.py

# 6. 简历解析链路自检
.venv/bin/python scripts/resume_parse_chain_check.py

# 7. 简历数据质量自检
.venv/bin/python scripts/resume_data_quality_check.py --resume-id <resume_id>
```

日志默认同时输出到控制台与 `./data/logs/app.log`，文件日志为 JSON Lines，并按大小自动轮转。

## Web 界面

| 路径 | 角色 | 说明 |
|---|---|---|
| `/login` | 公开 | 普通用户登录 |
| `/register` | 公开 | 普通用户注册 |
| `/profile` | 用户 | 简历预览 + 字段级修正 |
| `/upload` | 用户 | 拖拽上传，可单次开启增强推理 |
| `/plugin` | 用户 | 插件连接参数、登录 token、简历 ID 复制入口 |
| `/admin/stats` | 管理员 | 用户数 / 调用量 / token / 成本 |
| `/admin/models` | 管理员 | Provider 切换 + API Key / OCR / 视觉 / 对话 / 推理模型配置 + Thinking 默认策略 + 连通性测试 |
| `/admin/users` | 管理员 | 用户列表 + 简历数 + 累计成本 |

## 插件连接流程

1. 在 Chrome 扩展管理页加载 `With_Le/chrome-extension`。
2. 打开插件弹窗，点击“打开主页”进入 Web 前端注册或登录。
3. 登录后进入 `/plugin`，复制“后端 API”“登录 token”和已解析简历的“简历 ID”。
4. 回到插件弹窗保存配置。
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

## 项目文档

> 当前文档入口见 [DOCS.md](./DOCS.md)。当前数据契约见 [SCHEMA.md](./SCHEMA.md)。旧的全站点调研、Kiro 规格和 mock 后端文档已从主仓库删除，避免继续牵引当前 MVP。

| 文档 | 内容 |
|---|---|
| [DOCS.md](./DOCS.md) | 文档导航、当前文档边界、修改文档同步规则 |
| [SCHEMA.md](./SCHEMA.md) | 当前 `ResumeData v1.6`、插件字段扫描、填表方案数据契约 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构、模块职责、扩展点、API 速查表 |
| [FEISHU_SCOPE_REDUCTION_REVIEW.md](./FEISHU_SCOPE_REDUCTION_REVIEW.md) | 当前飞书招聘范围收缩、保留/删除边界 |
| [PLUGIN_MVP_FIELD_REQUIREMENTS.md](./PLUGIN_MVP_FIELD_REQUIREMENTS.md) | 小鹏/飞书招聘插件字段扫描上报要求 |
| [web/README.md](./web/README.md) | 前端本地开发、路由与构建说明 |

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
- ✅ 浏览器插件连接页 + 小鹏/飞书招聘页面扫描与受控填写
- ✅ 插件运行时门控：非飞书招聘系页面直接停止
- ✅ 后端自动化测试 + 插件 manifest / service worker / autofill smoke 测试

未在 MVP 中：异步队列、对象存储、多模型路由降级、Redis 缓存、敏感字段加密、速率限制 — 见 ARCHITECTURE.md 第 10 节。

---

## License

Proprietary, internal use only.
