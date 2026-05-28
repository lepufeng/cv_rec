# Resume Parsing Platform

AI 智能简历填写产品的后端服务 + Web 前端。上传简历 → 多模态模型解析为结构化 JSON → 浏览器插件提交目标网页表单字段 → 平台返回逐字段填写方案。

> 不依赖预定义"标签库"。每次投递时由 LLM 实时理解目标网页，从结构化简历中匹配填入。新 ATS 站点零适配。

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
| `/login` | 公开 | 登录 / 注册（首位用户自动成为管理员） |
| `/profile` | 用户 | 简历预览 + 字段级修正 |
| `/upload` | 用户 | 拖拽上传，可单次开启增强推理 |
| `/admin/stats` | 管理员 | 用户数 / 调用量 / token / 成本 |
| `/admin/models` | 管理员 | Provider 切换 + API Key / OCR / 视觉 / 对话 / 推理模型配置 + Thinking 默认策略 + 连通性测试 |
| `/admin/users` | 管理员 | 用户列表 + 简历数 + 累计成本 |

## 完整调用示例

```bash
# 注册用户（拿到 api_key 仅此一次）
curl -X POST http://127.0.0.1:8000/api/v1/users/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice"}'

# → {"user_id":"...","username":"alice","api_key":"cvr_xxx..."}

# 上传简历（同步等待解析完成）
KEY=cvr_xxx
curl -X POST http://127.0.0.1:8000/api/v1/resumes \
  -H "Authorization: Bearer $KEY" \
  -F "file=@./your_resume.pdf" \
  -F "thinking_mode=disabled"

# 请求填写方案
curl -X POST http://127.0.0.1:8000/api/v1/fill-plans \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d @./examples/form_fields.json
```

---

## 项目文档

> 当前文档入口见 [DOCS.md](./DOCS.md)。当前数据契约见 [SCHEMA.md](./SCHEMA.md)。历史 `HANDOFF.md` 与 `.kiro/specs` 只作背景参考，当前行为以代码和 `SCHEMA.md` 为准。

| 文档 | 内容 |
|---|---|
| [DOCS.md](./DOCS.md) | 文档导航、当前/历史文档边界、修改文档同步规则 |
| [SCHEMA.md](./SCHEMA.md) | 当前 `ResumeData v1.6`、插件字段扫描、填表方案数据契约 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构、模块职责、扩展点、API 速查表 |
| [PRODUCT_FLOW_PRD.md](./PRODUCT_FLOW_PRD.md) | 产品功能关系、数据流程图、PRD 原型、插件协议与自学习路线图 |
| [PLUGIN_INTEGRATION_REVIEW.md](./PLUGIN_INTEGRATION_REVIEW.md) | 队友插件扫描 JSON 对接评审、兼容性结论与改造清单 |
| [E2E_SELF_CHECKLIST.md](./E2E_SELF_CHECKLIST.md) | 端到端跑通自查表：后端、插件、填表、反馈、自学习 |
| [ATS_FIELD_REVIEW.md](./ATS_FIELD_REVIEW.md) | 主流招聘/ATS 表单字段调研与 schema 复查清单 |
| [web/README.md](./web/README.md) | 前端本地开发、路由与构建说明 |
| [HANDOFF.md](./HANDOFF.md) | 历史交接记录，部分 schema/API 信息可能已过期 |
| [.kiro/specs/resume-parsing-platform/requirements.md](./.kiro/specs/resume-parsing-platform/requirements.md) | 需求文档（含 v2） |
| [.kiro/specs/resume-parsing-platform/design.md](./.kiro/specs/resume-parsing-platform/design.md) | 完整技术设计（含 v2） |
| [.kiro/specs/resume-parsing-platform/tasks.md](./.kiro/specs/resume-parsing-platform/tasks.md) | 3 天 MVP 实施计划 |

---

## 当前 MVP 范围

- ✅ 简历上传（PDF/DOCX/PNG/JPG）+ 同步多模态解析
- ✅ 结构化 JSON 输出（`schema_version=1.6`，含教育排名 `ranking`、实习经历 `internship_experience`、校园经历 `campus_experience`、工具技能 `skills.tools` 与动态事实 `facts`）
- ✅ 用户手动修正解析结果
- ✅ 智能填写方案接口
- ✅ 填写方案缓存（DB 实现，TTL 7 天）
- ✅ 简历内容哈希去重
- ✅ API Key 认证 + 用户隔离
- ✅ GLM / Qwen 模型切换 + 运行时管理员配置
- ✅ 管理员后台（模型配置 / 用户管理 / 成本统计）
- ✅ React 前端（用户预览 / 上传 / 管理员后台）
- ✅ 53 项后端自动化测试

未在 MVP 中：异步队列、对象存储、多模型路由降级、Redis 缓存、敏感字段加密、速率限制 — 见 ARCHITECTURE.md 第 10 节。

---

## License

Proprietary, internal use only.
