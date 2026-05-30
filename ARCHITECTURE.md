# Resume Parsing Platform — 框架说明

> 后端服务：上传简历 → 多模态模型解析为结构化 JSON → Chrome 插件扫描小鹏/飞书招聘页面后，返回智能填写方案并执行受控填写。
> 此文档面向后端开发者与对接的浏览器插件同事。

---

## 1. 产品定位

当前版本聚焦小鹏招聘以及其他飞书招聘系公司页面。系统不再追求“所有招聘网站零适配”，而是把 Feishu/Formily/UD 组件链路做深：动态经历模块、搜索选择器、日期范围、重复字段映射、填写后校验和诊断日志。

两个阶段：

- **阶段 A · 简历解析**：用户首次上传简历后异步执行的一次性工作。结果以稳定 Schema 持久化，作为该用户的"简历数据源"。
- **阶段 B · 智能填写**：浏览器插件抓取小鹏/飞书招聘页面表单后调用，每次投递触发一次。LLM 接收（结构化简历 + 表单字段）输入，输出每字段的填写方案与置信度。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI (HTTP API)                       │
│   /auth  /resumes  /fill-plans  /users  /admin  /health     │
└──────┬──────────────┬─────────────┬───────────────┬─────────┘
       │              │             │               │
       ▼              ▼             ▼               ▼
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│ Resume    │  │ Parsing   │  │  Fill     │  │  User     │
│ Service   │  │ Service   │  │  Service  │  │  Service  │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │              │
      └──────────────┴──────┬───────┴──────────────┘
                            │
        ┌───────────────────┼─────────────────┐
        ▼                   ▼                 ▼
┌───────────────┐  ┌──────────────┐  ┌───────────────┐
│ Storage       │  │ Model        │  │ Repositories  │
│ Adapter       │  │ Adapter      │  │ (SQLAlchemy)  │
│ (Local FS)    │  │ (GLM/Qwen)   │  │               │
└───────────────┘  └──────────────┘  └───────┬───────┘
                                             │
                                             ▼
                                     ┌──────────────┐
                                     │  PostgreSQL  │
                                     │  / SQLite    │
                                     └──────────────┘
```

### 分层

| 层 | 职责 |
|---|---|
| **API** (`app/api/`) | HTTP 路由、参数校验、认证、错误转换 |
| **Service** (`app/services/`) | 业务编排、事务边界、调用模型/存储/Repo |
| **Adapter** (`app/adapters/`) | 模型与存储抽象，可插拔，是核心扩展点 |
| **Repository** (`app/repositories/`) | 数据访问，单一职责 |
| **Model** (`app/models/`) | SQLAlchemy ORM |
| **Schema** (`app/schemas/`) | Pydantic 数据契约（与插件端的接口） |
| **Parsers** (`app/parsers/`) | PDF/DOCX/图片预处理 |
| **Prompts** (`app/prompts/`) | LLM 系统提示与用户提示模板 |
| **Core** (`app/core/`) | 配置、日志、DB、安全工具、自定义异常 |

---

## 3. 目录结构

```
cv_rec/
├── app/
│   ├── api/                 路由 + 错误处理 + 依赖注入
│   │   └── v1/              v1 接口
│   ├── adapters/
│   │   ├── models/          GLM/Qwen 多模态模型适配器
│   │   └── storage/         本地/对象存储适配器
│   ├── core/                config / db / logging / exceptions / security
│   ├── models/              SQLAlchemy ORM
│   ├── parsers/             文档预处理
│   ├── prompts/             LLM 提示模板
│   ├── repositories/        数据访问层
│   ├── schemas/             Pydantic 契约
│   ├── services/            业务编排
│   └── main.py              FastAPI 入口
├── tests/
│   ├── unit/                Schema / 预处理 / 工具函数
│   ├── integration/         端到端 API 流程
│   ├── fakes/               FakeModel
│   └── fixtures/            测试样本
├── web/                     用户端/管理员端 React 前端
├── With_Le/chrome-extension/ 浏览器插件（队友项目，已纳入仓库管理）
├── data/uploads/            本地文件存储根目录（.gitignore）
├── docker-compose.yml       Postgres 可选栈
├── Dockerfile
├── .env.example
├── pyproject.toml
├── DOCS.md                  文档导航与维护规则
├── SCHEMA.md                当前数据契约说明
├── ARCHITECTURE.md          本文件
└── README.md                Quickstart 与项目入口
```

---

## 4. 核心数据契约

### 4.1 ResumeData（阶段 A 输出）

完整字段定义见 `SCHEMA.md`；代码定义在 `app/schemas/resume.py`，`schema_version = "1.6"`。顶层模块：

| 字段 | 类型 | 说明 |
|---|---|---|
| `basic_info` | `BasicInfo` | 姓名、性别、生日、电话、邮箱、籍贯、政治面貌等 |
| `job_intent` | `JobIntent?` | 求职意向、期望薪资、到岗时间 |
| `education` | `list[Education]` | 教育经历，按时间倒序 |
| `internship_experience` | `list[InternshipExperience]` | 实习经历，按时间倒序 |
| `work_experience` | `list[WorkExperience]` | 正式工作、兼职、合同制等非实习工作经历，按时间倒序 |
| `campus_experience` | `list[CampusExperience]` | 学生组织、社团、志愿服务、班级职务等校园经历 |
| `project_experience` | `list[ProjectExperience]` | 项目经历 |
| `skills` | `Skills` | 编程语言、框架/包、数据库、中间件、云原生、工具、软技能分类 |
| `certifications` | `list[Certification]` | 证书 |
| `languages` | `list[Language]` | 语言能力 |
| `self_evaluation` | `str?` | 自我评价原文 |
| `facts` | `list[ResumeFact]` | 可长期复用的动态事实，用于长尾表单语义填写 |

设计原则：
- 缺失字段使用 `null` 或 `[]`，**绝不编造**
- 时间统一 `YYYY-MM` 字符串
- 固定字段只承接高频、稳定、跨招聘系统复用率高的信息；长尾信息先进入 `facts` / `extra_sections`
- GPA 等异构字段保留原始字符串（如 `"3.8/4.0"` 或 `"85分"`）；教育排名使用 `education[].ranking`
- 实习经历使用 `internship_experience[]`，明确标注为实习/Intern 的经历不再混入 `work_experience`
- 实习/工作经历部门/团队使用 `internship_experience[].department` / `work_experience[].department`
- 学生简历高频校园经历使用 `campus_experience[]`，不再只作为长尾 `facts`
- Office、Tableau、Power BI 等非编程工具使用 `skills.tools`
- 固定 schema 不覆盖但具备复用价值的信息进入 `facts`，每条保留 `label/value/source_text/confidence`
- 新字段晋升标准：常见招聘表单高频询问、语义稳定、比 `facts` 更利于自动填表和人工修正
- `schema_version` 用于向后兼容

### 4.2 FillPlan（阶段 B 输入输出）

定义在 `app/schemas/fill_plan.py`。

**请求**：

```jsonc
POST /api/v1/fill-plans
{
  "resumeId": "uuid",                    // 不传则用最新简历
  "url": "https://jobs.foo.com/apply",
  "fields": [
    {"fieldId": "name", "label": "姓名", "type": "text", "widget": "text-input", "required": true},
    {"fieldId": "gender", "label": "性别", "type": "select", "widget": "pseudo-radio", "options": ["男","女"], "enumerable": true},
    {"fieldId": "work_exp", "label": "工作经历", "type": "repeater",
     "subFields": [{"fieldId": "company", "label": "公司", "type": "text"}]}
  ],
  "user_overrides": {"phone": "13912345678"}
}
```

**响应**：

```jsonc
{
  "plan_id": "uuid",
  "filled": {
    "name": {
      "value": "张三",
      "confidence": 1.0,
      "reasoning": "直接来自 basic_info.name",
      "source": "basic_info.name"
    },
    "gender": {"value": "男", "confidence": 1.0, ...},
    "work_exp": {"value": [{"company": "字节跳动", ...}], ...}
  },
  "needs_user_input": ["height", "weight"],
  "warnings": [],
  "cache_hit": false,
  "model_used": "glm-4.6v-flash",
  "cost_cny": "0.000123"
}
```

`needs_user_input` 列出无法填写的字段。`cache_hit` 表示是否命中缓存（同一用户 + 简历版本 + 表单结构相同时复用历史方案，TTL 7 天）。

---

## 5. 关键工作流

### 5.1 上传与解析

```
Client                API           ResumeService            ParsingService
  │  POST /resumes      │                  │                       │
  │ ──file──────────────▶                  │                       │
  │                     │ ──upload_and_parse──▶                    │
  │                     │                  │ check size/format     │
  │                     │                  │ sha256 dedup          │
  │                     │                  │ persist file          │
  │                     │                  │ route by file type    │
  │                     │                  │ PDF/Image → OCR       │
  │                     │                  │ DOCX → preprocess     │
  │                     │                  │ ──parse──────────────▶│
  │                     │                  │ call OCR/Chat or VLM  │
  │                     │                  │ ◀──ResumeData & cost──│
  │                     │                  │ persist parsed_data   │
  │                     │                  │ insert CostLog        │
  │ ◀── ResumeDetail ───│                  │                       │
```

去重：相同 `(user_id, sha256(content))` 已有 `completed` 记录时直接返回，不再调用模型。

文件类型路由：
- `pdf/png/jpg/jpeg`：优先调用 OCR 模型（如 `glm-ocr` 的 `layout_parsing`）提取 Markdown/文本，再由对话模型结构化为 `ResumeData`；OCR 失败时回退到原视觉模型路径。
- `docx`：本地抽取段落/表格文本后走视觉模型路径；管理员可将视觉模型配置为 `glm-4.6v` 作为 DOCX/兜底解析模型。

Thinking 模式：
- 管理员可配置默认 `model_thinking_mode`，用户上传时可通过 multipart 字段 `thinking_mode=enabled|disabled` 单次覆盖。
- 当前对支持的 GLM-5 / GLM-4.7 系列在关闭时传入 `thinking: {"type": "disabled"}`；开启时不传该禁用参数，使用模型默认推理行为。
- `cost_logs` 记录模型返回的实际 token 与成本；结构化日志的 `model_http_request_started` 会记录本次 `thinking_mode`。

### 5.2 智能填写

```
Extension          API            FillService                  ChatModel
   │ POST /fill-plans/plugin-match        │                          │
   │ ────────────────▶│ ──create_plan──▶│                          │
   │                  │                  │ load parsed_data         │
   │                  │                  │ structure_hash = sha(form)│
   │                  │                  │ cache.get(user, resume, hash)│
   │                  │             ┌────┴─── if hit & version matches:
   │                  │             │           cache_hit=true; return
   │                  │             └────┐
   │                  │                  │ ──chat──────────────────▶│
   │                  │                  │ ◀──FillPlan JSON─────────│
   │                  │                  │ validate against Schema  │
   │                  │                  │ cache.set(ttl=7d)        │
   │                  │                  │ insert CostLog           │
   │ ◀── FillPlan + mappings ────────────│                          │
```

当前 MVP 中，插件主流程只展示匹配方案预览，不执行真实 DOM 填写；真实填写执行器与填写反馈学习链路是下一阶段工作。

`POST /fill-plans` 与 `POST /fill-plans/plugin-match` 均可选传入 `thinkingMode=enabled|disabled`。填表方案缓存会把 thinking 模式纳入 `form_structure_hash`，避免用户切换增强推理后仍命中普通模式生成的旧方案。

### 5.3 用户修正后缓存失效

`PATCH /resumes/{id}` deep-merge 后 `parsed_data_version += 1`，并删除该简历名下所有 `FillPlanCache` 记录。下次填写请求会重新调用模型。

---

## 6. 扩展点

### 6.1 新增模型适配器

实现 `ChatModel` / `VisionModel` 协议（`app/adapters/models/base.py`）：

```python
class MyModel:
    chat_model_id = "my-model-x"
    vision_model_id = "my-model-vx"

    async def chat(self, system, user, *, response_format="json", temperature=0.0) -> ModelResponse:
        ...

    async def vision_chat(self, system, user, images, *, response_format="json", temperature=0.0) -> ModelResponse:
        ...
```

然后在 `app/adapters/models/__init__.py` 的 `get_model()` 工厂中注册新 provider。`Settings.model_provider` 同步增加枚举即可。

### 6.2 新增存储后端

实现 `StorageBackend` 协议（`app/adapters/storage/base.py`）：

```python
class OSSStorage:
    async def save(self, key, data, content_type): ...
    async def get(self, key): ...
    async def delete(self, key): ...
    async def exists(self, key): ...
```

在 `app/adapters/storage/__init__.py` 工厂中按 `Settings.storage_backend` 分支选择。

### 6.3 引入异步任务队列（v2）

当前阶段 A 同步执行（3-15 秒）。生产规模下需要切换为异步：

1. 在 `Settings` 增加 `redis_url` 与 `worker_mode`
2. 用 RQ 或 arq 包装 `ParsingService.parse` 为后台任务
3. `ResumeService.upload_and_parse` 改为投递任务后立刻返回 `pending` 状态
4. 前端轮询 `/resumes/{id}/status` 直到 `completed`

ORM 已预留 `parse_status / parse_started_at / parse_completed_at` 字段。

### 6.4 模型路由 + 失败降级（v2）

当前为单模型直连。要升级为 `economy / standard / flagship` 三档路由：

1. `app/adapters/models/router.py` 维护 `(tier, capability) -> model_id` 映射
2. `with_fallback` 包装：主模型超时/限流 → 重试 → 切备用模型
3. `Settings` 增加 `parsing_default_model / parsing_fallback_model` 配置

这部分目前仅保留接口边界，等产品稳定后再单独补充 v2 设计文档。

---

## 7. 配置项

所有配置走 `.env`（见 `.env.example`）。关键项：

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_ENV` | `dev` | `dev` / `prod` / `test` |
| `DATABASE_URL` | SQLite | 本地默认 `sqlite+aiosqlite:///./data/dev.db`；生产换 PG |
| `LOG_TO_FILE` | `true` | 是否将结构化日志写入文件 |
| `LOG_FILE_PATH` | `./data/logs/app.log` | 自动记录日志文件路径 |
| `LOG_FILE_MAX_MB` | `10` | 单个日志文件大小上限，超过后轮转 |
| `LOG_FILE_BACKUP_COUNT` | `5` | 保留的轮转日志文件数量 |
| `LOG_REQUEST_ENABLED` | `true` | 是否自动记录 HTTP 请求摘要 |
| `STORAGE_BACKEND` | `local` | 当前仅 `local`，OSS 待实现 |
| `STORAGE_LOCAL_PATH` | `./data/uploads` | 本地存储根目录 |
| `MODEL_PROVIDER` | `glm` | `glm` / `qwen` / `fake`（测试用） |
| `MODEL_THINKING_MODE` | `disabled` | 默认是否开启 Thinking；用户/插件请求可覆盖 |
| `GLM_API_KEY` | - | 智谱平台 API Key |
| `GLM_OCR_MODEL` | `glm-ocr` | PDF / 图片简历优先 OCR 模型 |
| `GLM_VISION_MODEL` | `glm-4.6v-flash` | DOCX / OCR 失败兜底视觉模型 |
| `GLM_CHAT_MODEL` | `glm-4.6v-flash` | OCR 文本结构化与表单填写模型 |
| `MAX_FILE_SIZE_MB` | `10` | 单文件上限 |
| `FILL_PLAN_CACHE_TTL_DAYS` | `7` | 填写方案缓存有效期 |

---

## 8. API 速查表

所有接口前缀 `/api/v1`。除 `/health` 与 `/auth/*` 外，需 `Authorization: Bearer <token>` 头。

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/health` | 探活 | 否 |
| POST | `/auth/user/register` | 普通用户注册，返回登录 token | 否 |
| POST | `/auth/user/login` | 普通用户登录，返回登录 token | 否 |
| GET | `/users/me` | 当前用户信息 | 是 |
| POST | `/resumes` | 上传简历（multipart/form-data 字段名 `file`，可选 `thinking_mode`） | 是 |
| GET | `/resumes` | 当前用户简历列表 | 是 |
| GET | `/resumes/{id}` | 获取结构化简历 | 是 |
| GET | `/resumes/{id}/status` | 查询解析状态 | 是 |
| PATCH | `/resumes/{id}` | 修正结构化数据（`{"patch": {...}}` deep-merge） | 是 |
| DELETE | `/resumes/{id}` | 删除简历及关联缓存与原始文件 | 是 |
| POST | `/resumes/{id}/reparse` | 重新解析已上传简历 | 是 |
| POST | `/fill-plans` | 提交表单字段，返回填写方案（可选 `thinkingMode`） | 是 |
| POST | `/fill-plans/plugin-scan` | 插件扫描 payload 校验，不调用模型 | 是 |
| POST | `/fill-plans/plugin-match` | 插件兼容方案接口，返回 `mappings/skipped/sectionActions` | 是 |

错误响应统一格式：

```json
{
  "code": "RESUME_NOT_FOUND",
  "message": "Resume not found",
  "details": {},
  "request_id": "uuid"
}
```

---

## 9. 本地开发

### 9.1 环境要求

- Python 3.11+（开发期实测 3.13 OK）
- macOS：`brew install poppler`（pdf2image 依赖）
- Linux：`apt-get install poppler-utils`

### 9.2 一键启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
# 编辑 .env，至少填写 GLM_API_KEY 或 QWEN_API_KEY；MVP 阶段用 glm-4.6v-flash 限免模型

uvicorn app.main:app --reload
# 服务启动在 http://127.0.0.1:8000
# 接口文档自动生成：http://127.0.0.1:8000/docs
```

### 9.3 测试

```bash
pytest                   # 全部测试
pytest tests/unit -v     # 仅单元测试
pytest tests/integration # 仅集成测试
```

测试默认使用 `MODEL_PROVIDER=fake`，不会真实调用云 API。

### 9.4 真实模型烟囱测试

```bash
export MODEL_PROVIDER=glm
export GLM_API_KEY=sk-...
uvicorn app.main:app --reload &

# 注册
curl -X POST http://127.0.0.1:8000/api/v1/auth/user/register \
     -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"pass123456"}'
# → {"user_id": "...", "username": "alice", "token": "...", "is_admin": false}

# 上传简历
TOKEN=...
curl -X POST http://127.0.0.1:8000/api/v1/resumes \
     -H "Authorization: Bearer $TOKEN" \
     -F "file=@./examples/sample.pdf"
```

---

## 10. 已知限制 & v2 路线

当前 MVP 为 3 天交付的最小闭环。**不**包含以下能力，但代码结构已为其预留接口：

| 已知限制 | v2 计划 |
|---|---|
| 仅本地文件系统存储 | OSS / S3 适配器 |
| 单模型直连，无降级 | ModelRouter + 多档路由 |
| 阶段 A 同步阻塞 | RQ/arq 异步队列 |
| 内存级缓存（DB 表） | Redis |
| 仅一份默认简历 | 多简历管理 + 默认切换 |
| API Key 简单认证 | OAuth2 / 微信登录 |
| 无加密敏感字段 | AES-GCM 加密身份证号、银行卡 |
| 无速率限制 | slowapi 中间件 |
| 无成本限额 | per-user 当日额度 + 自动降级 |
| 无 PBT | Hypothesis 7 条不变量测试 |

v2 设计不再从旧 Kiro 规格继承，后续扩展应重新围绕小鹏/飞书招聘实际样本设计。

---

## 11. 关键设计决策记录

1. **同步 vs 异步解析**：MVP 选同步。3-15 秒在用户侧可接受，省去队列基础设施。预留状态机字段以支持未来切换为异步。
2. **GLM/Qwen 可切换模型配置**：MVP 通过管理员页面配置 OCR、视觉、对话和推理模型，优先保证解析质量与填写稳定性；成本测算不再作为主仓库里的独立脚本保留。
3. **聚焦飞书招聘底座**：MVP 不再承担全站点泛化成本。表单字段语义仍由 LLM 判断，但 DOM 规则和测试样本优先服务 Feishu/Formily/UD 结构。
4. **填写方案缓存以表单结构哈希为 key**：同一公司不同岗位的表单大概率结构一致，缓存命中率应接近 30%，是省成本的关键优化。
5. **存储 / 模型 / 缓存全部抽象成接口**：上云迁移时仅切换实现类，业务代码零改动。
