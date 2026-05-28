# Resume Parsing Platform · 项目交接摘要

> 历史说明：本文记录 Kiro 阶段到早期 MVP 的交接上下文。当前数据契约、文档入口与最新开发约定请优先看 `DOCS.md` 和 `SCHEMA.md`；本文中的 schema/API 细节可能落后于当前代码。
>
> 写给接手开发者（codex / 其他 LLM agent / 新同事）。
> 完整覆盖项目从立项到当前状态的所有重要决策、实施步骤、踩过的坑和解决方案。
>
> 配套文档：
> - `README.md` — Quickstart
> - `DOCS.md` — 当前文档导航与维护规则
> - `SCHEMA.md` — 当前 ResumeData / FillPlan 数据契约
> - `ARCHITECTURE.md` — 模块分层、扩展点、API 速查
> - `.kiro/specs/resume-parsing-platform/{requirements,design,tasks}.md` — 完整 spec
> - `cost_experiment.py` — 成本测算脚本（可重跑）

---

## 0. 产品定位（一句话）

让用户在浏览器中投简历时，AI 实时理解目标网页表单字段，从结构化简历自动填入。**不依赖预定义的字段标签库**，每次现场判断。

差异化于市场上的 Simplify Copilot / autofill.sh / FormPilot 等产品 —— 它们都是预先把简历"过度标签化"，再做关键词映射。我们做"AI 像人一样思考"。

---

## 1. 团队分工

- **本仓库（你即将接手的部分）**：解析平台 + 智能填写后端 + 管理/用户 Web UI
- **另一同事**：浏览器插件（Edge），负责抓取目标网页的表单字段、调用本平台 API、把返回的填写方案应用到页面
- 浏览器插件**不在本仓库**

平台后端通过两个核心 API 与插件协作：
1. `POST /api/v1/resumes`（用户上传简历，同步等待解析）
2. `POST /api/v1/fill-plans`（插件提交表单字段，返回填写方案）

---

## 2. 早期决策记录（讨论得出的共识）

### 2.1 浏览器插件 vs 本地 App
- **结论**：插件方向（参考 Simplify、Open Applier 等），跨平台、用户安装门槛低
- 本仓库聚焦后端，不卷入插件实现

### 2.2 双阶段架构
- **阶段 A（解析）**：用户上传简历 → VLM 解析为结构化 JSON → 持久化为该用户的"简历数据源"
- **阶段 B（智能填写）**：插件提交表单字段 → LLM 结合简历 JSON 生成填写方案
- 两阶段解耦，A 的输出是 B 的输入，但 B 不感知 A 的实现

### 2.3 模型选型
- 国产模型优先（合规 + 中文 + 成本）
- 开发期目标：GLM-4.6V-Flash（限免）/ glm-4.6v-flashx（极便宜）
- 生产建议：qwen-vl-plus 或 GLM-4.6V（标准档）
- **glm-4.6v-flashx 已被验证在简历顶部小字识别上能力不足**（详见 §6 已知问题）

### 2.4 成本压测结论（cost_experiment.py 的产出）
- 单份简历解析：0.005 ~ 0.03 元（按模型档位）
- 单次填写方案：0.005 ~ 0.018 元
- 端到端商业模型：¥9.9/月套餐毛利率 ≈ 98%
- 全优化（提示词缓存 + 表单方案缓存 + 分级路由）可省 30%+

### 2.5 本地 vs 云端
- 本地优先（macOS M4 Pro 上跑通），架构上预留无痛上云路径
- SQLite + 本地 FS 起步；Postgres / OSS 接口已抽象但只有 stub 实现
- 同步阻塞 + DB 缓存起步；异步队列 / Redis 在 v2 路线

---

## 3. 核心架构（30 秒概览）

```
[FastAPI v1 routes]                ← 用户 + 管理员两套独立认证
       ↓
[Service layer: User/Resume/Parsing/Fill/Config/Admin]
       ↓
[Adapter layer]                    ← 关键扩展点
   ├─ Model: ChatModel/VisionModel Protocol
   │   └─ OpenAICompatClient (GLM, Qwen 同接口)
   │   └─ FakeModel (测试用)
   ├─ Storage: StorageBackend Protocol
   │   └─ LocalFSStorage (OSS stub 已留)
   └─ Cache: 用 DB 表 (Redis 适配在 v2 路线)
       ↓
[Repository layer + SQLAlchemy ORM + SQLite/Postgres]
```

**关键文件夹**：
- `app/schemas/` — Pydantic 数据契约（与插件端的硬契约）
- `app/prompts/` — Stage A & B 的 system prompt（**最敏感，改动需小心**）
- `app/adapters/` — 模型 / 存储 / 缓存抽象，可插拔扩展点
- `web/src/` — React 前端

---

## 4. 实施时间线（按需求/讨论 → 改动 → 影响）

### Day 0 · 立项与调研

**做了什么**：
- 比较插件 vs 本地 App 路径
- 模型选型成本调研（GLM / 通义 / Kimi 三家）
- 写 `cost_experiment.py` 实跑 token 消耗，得出双阶段成本模型

**产出**：
- 产品方向锁定：插件 + 解析平台
- 模型策略：MVP 用 GLM 限免，生产用 qwen-vl-plus

### Day 1 · Spec 三件套

**做了什么**：
按 Kiro spec 流程：Requirements → Design → Tasks，三阶段都让用户审阅后才推进。

**产出**：
- `.kiro/specs/resume-parsing-platform/requirements.md` — 10 条需求 + EARS 验收标准
- `.kiro/specs/resume-parsing-platform/design.md` — 完整技术设计（含 PBT 不变量、上云迁移路径）
- `.kiro/specs/resume-parsing-platform/tasks.md` — 18 个顶层任务

**关键决策**：
- 3 天 MVP 砍掉了：异步队列、OSS、Redis、多模型路由、PBT、加密、限流、多简历
- 这些都在 design.md 中保留接口，v2 再做

### Day 1-3 · MVP 后端实施

**Project skeleton**：
```
pyproject.toml + Dockerfile + docker-compose.yml + .env.example
app/{api/v1, services, adapters/{models,storage}, parsers, prompts, schemas, repositories, models, core}
tests/{unit, integration, fakes, fixtures}
```

**核心模块**：
- `app/core/config.py` — pydantic-settings，全部环境变量外置
- `app/core/security.py` — 早期是 SHA256 + API Key（后改为 PBKDF2 + 用户名密码，见 §5.2）
- `app/core/db.py` — SQLAlchemy async + SQLite 默认
- `app/adapters/models/openai_compat.py` — 统一的 OpenAI 兼容客户端，GLM/Qwen 共用
- `app/parsers/preprocess.py` — PDF→图片 / DOCX→文本 / 图片预处理
- 4 个 Service：User / Resume / Parsing / Fill
- 4 张表：User / Resume / FillPlanCache / CostLog（后期加 AppConfig）

**关键设计点**：
- **同步阻塞解析**（3-15s 用户能接受，省去队列基础设施；预留 status 字段以便未来切异步）
- **内容哈希去重**（同一用户重复上传相同 PDF 不再调用模型）
- **填写方案缓存**（key = `(user_id, resume_id, sha256(form_structure))`，TTL 7 天）
- **简历 patch 触发缓存失效**（version+1 + 删除该简历所有 fill_plan_cache）

**测试**：
- 33 项测试（含 FakeModel 驱动的 e2e、内容哈希去重、缓存失效、用户隔离 403）

### Day 3 · MVP 前端

**技术栈**：
- React 18 + TypeScript + Vite + Tailwind CSS + react-router v6 + Zustand

**实施**：
- `web/src/lib/api.ts` — typed fetch 封装 + endpoints 定义
- `web/src/components/` — UI 共用组件、布局、路由守卫
- `web/src/pages/` — Login（旧版）/ Profile / Upload / admin/{Stats, ModelConfig, Users}
- 设计风格：参考 simplify.jobs，浅灰背景 + 白色卡片 + indigo 主色 + Inter 字体

---

## 5. MVP 之后的迭代（这是大头，每一项都是用户反馈推动的修改）

### 5.1 ✅ 管理员后台扩展（Codex 接手前的需求）

**用户需求**：
- 管理员能在 UI 里配置模型 API Key（不要让用户改 .env）
- 用户列表 + 成本统计
- 模型连通性测试

**实施**：
- 新增 `AppConfig` K/V 表 — 持久化运行时模型配置，覆盖 `.env`
- `User.is_admin` 字段
- 5 个 admin endpoint：`/admin/{config/model, config/model/test, users, stats}`
- 模型工厂改为优先读 DB 配置回落 .env：`build_model_from_config()`
- 前端增加 3 个管理员页面：`/admin/{stats, models, users}`

### 5.2 ⚠️ 重大改动：认证体系重构（用户名 + 密码）

**用户需求原话**：
> 我没保存注册用户额弹出的 apikey。你更改一下逻辑。我需要让用户和管理员从两个不同的页面登录，以体现纯净性。此外，管理员采用账户名和自定义密码，不实用 api-key；用户则同样需注册账户和密码。登录后用户端不应看到管理员端显示的页面

**改动要点**（重要 — 替换了原始的 API Key 认证）：
- `User.api_key_hash` → `User.password_hash`（PBKDF2-HMAC-SHA256，200k iterations，per-user salt）
- 新增 stateless 会话 Token：HMAC-SHA256 签名的 `{uid, role, exp}` JSON，用于 Bearer auth
- 4 个 auth 路由：
  - `POST /auth/user/register`
  - `POST /auth/user/login`
  - `GET /auth/admin/bootstrap-status`（首次访问检测）
  - `POST /auth/admin/bootstrap`（创建首个 admin，之后被锁死）
  - `POST /auth/admin/login`
- 严格隔离：
  - 用户 token 调 `/admin/*` → 403
  - 管理员 token 调 `/resumes` → 403（管理员不能用用户功能）
  - 用户在管理员入口登录 → 403
  - 管理员在用户入口登录 → 403
- 前端拆分：
  - `/login` `/register`（用户，浅色 indigo 主题）
  - `/admin/login`（管理员，暗色主题；首次自动显示 bootstrap 表单）
- 路由守卫：用户访问 `/admin/*` 重定向到 `/profile`；管理员访问 `/profile` 重定向到 `/admin/stats`

**测试影响**：
- 重写 conftest.py 的 fixture
- 新增 7 项 admin 集成测试
- 旧的 e2e 测试改用 `make_user` / `make_admin` 工厂

### 5.3 关键 Schema 演进：路径 B —— extra_sections（开放扩展段）

**用户原话**：
> 目前你设置的每一小项标题，如"荣誉/奖项"这一项，是你直接预设的用户会有的一项内容，还是可以做到实时根据用户简历内容判断，并且渲染

**讨论得出的方案**：
预设字段名（如"荣誉/奖项"、"主要课程"）保持稳定，作为与浏览器插件的硬契约；但允许 AI 在解析时把"标准 schema 装不下"的内容收集到 `extra_sections`，由 AI 自取标题、自选样式（pills/list/text）。前端按 AI 决定动态渲染。

**改动**：
- `schema_version` 从 1.0 升至 1.1
- `ResumeData` / `Education` / `WorkExperience` / `ProjectExperience` 四个层级都加 `extra_sections: list[ExtraSection] = []`
- `ExtraSection { title, style: pills|list|text, items: list[str] }`
- 前端新建 `<DynamicSection>` 组件，按 AI 输出动态渲染
- Stage A prompt 增加"开放扩展段"规则块（10+ 行示例标题）
- **Stage B prompt 增加"跨标题语义匹配"核心能力**：明确告诉 LLM 不要要求字面一致，给出 7 组同义词示例（"研究经历"⟷"研究背景"⟷"学术经历"等）

**为什么重要**：
这是产品差异化的核心。当前用户简历里有"研究背景"、招聘网站表单要"研究经历"，AI 在 Stage B 能跨标题语义匹配填入。`extra_sections` 增强了简历信息保留度，间接提升 Stage B 准确率。

### 5.4 一连串 prompt + schema 调优（共解决 7+ 个真实 bug）

每一个都源自用户上传真实简历后发现的问题。**每个修复都是 prompt 改进 + schema validator 兜底"双保险"**。

#### Bug 1: 输出截断
- **现象**：简历解析后 work_experience / project_experience 为空数组
- **根因**：`max_tokens` 没设，glm thinking 模型 reasoning_tokens 吃掉一半，可见 JSON 被截断
- **修复**：
  - `OpenAICompatClient.__init__` 加 `max_tokens=8192`
  - 检测 `finish_reason == "length"` 显式抛 `MODEL_OUTPUT_TRUNCATED` 不让残缺 JSON 通过
  - Prompt 加"避免冗长推理"提示

#### Bug 2: degree 枚举外值导致整份解析失败
- **现象**：模型给"加州大学戴维斯分校"输出 `degree: "交换生"`，Pydantic 严格拒绝整份 JSON
- **根因**：原文里有"交换生"字样模型直接抄，没映射到 5 个允许枚举
- **修复**：
  - Pydantic `field_validator` 兜底 — 不在枚举的值自动改为 "其他"（gender / marital_status / degree 都加）
  - Prompt 明确"非枚举值映射为'其他'"

#### Bug 3: ExtraSection.style 模型可能输出非法值
- **修复**：`style` validator 自动 fallback 到 `"list"`

#### Bug 4: 项目第一个圆点丢失
- **现象**：原文 3 条 bullet 列表，模型把第一条放到 `description`，achievements 只剩 2 条
- **修复**：
  - Prompt 明确"如果原文是连续 bullet 列表，全部放 achievements，description 必须为 null"
  - 前端 `ExperienceItem` 把 description（如有）也作为 bullet 渲染（视觉上看不出差异）

#### Bug 5: honors 引号污染
- **现象**：DB 里出现 `"2024-2025学年'校级三好学生奖学金'"`（中间有 ASCII 单引号）和 `"'校级一等奖学金'"`
- **根因**：原 PDF 用中文弯引号包裹奖项名，VLM OCR 时部分转成 ASCII 单引号；模型按分号拆分时没剥干净
- **修复**：
  - `_strip_wrapping_quotes` validator：两 pass 清理
    - Pass 1：剥外层成对引号（中文弯引号 / ASCII / 法语 « »）
    - Pass 2：字符串内 ASCII 直引号偶数对全部删除（CJK 引号保留 — 是真实内容）
  - 应用于 honors / courses / achievements / tech_stack / extra_sections.items

#### Bug 6: tech_stack 把算法当框架
- **现象**：项目"心理健康预测"的 tech_stack = `["Stacking", "LLM"]`；"零售分析" = `["RFM", "K-Means", "Holt-Winters"]`
- **根因**：`tech_stack` 字段语义模糊，模型默认走宽口径
- **修复**：
  - Prompt 强制定义边界 — tech_stack **只放工程实现类**：编程语言、框架、库、数据库、中间件、云原生、工具链
  - 反面清单 — **不放**：算法（Stacking/Boosting/...）、ML 模型（XGBoost/Random Forest/...）、概念（注意力机制/集成学习）、评价指标（Recall/Precision）
  - 这些应放到该项目的 `extra_sections`（title 取"算法与方法"、"模型"、"评估指标"）

#### Bug 7: honors 里混入 GPA
- **现象**：第一个教育条目原文没奖项，模型把 `GPA: 3.82/4.3` 塞进 honors 凑数
- **修复**：
  - Prompt 明确"honors 严禁放 GPA / 排名 / 学位 / 专业等元数据；如果该段教育没奖项，honors 必须为 []"
  - `_filter_honors` validator 兜底，黑名单前缀（GPA、绩点、排名、Rank、成绩等）自动过滤

#### Bug 8: 电话号码清洗
- **用户需求**：电话统一清洗为 11 位
- **修复**：
  - `_clean_phone` validator：去除非数字字符 + 自动剥 +86 国家码
  - `is_valid_cn_mobile()` 校验：必须 11 位 + 以 1 开头
  - 不合规时不强制清空，保留模型识别值，写入 `parse_warnings` 让用户确认

#### Bug 9: 姓名识别成单字 + 电话识别错位
- **现象**：原文清晰的"杨林"被识别为"林"，"189-7072-8522"被识别为"137072-8522"或"1380728522"
- **诊断过程**：
  - 第一次猜测"装饰字体" → 错（用户晒了截图，原文非常清晰）
  - 第二次猜测"DPI 不够" → 升 150→220、改 PNG 无损 → 仍错
  - **真实根因：glm-4.6v-flashx 在小字精确 OCR 上能力不足**（这是入门档模型的物理极限）
- **数据兜底**：
  - `BasicInfo.parse_warnings` 字段 — model_validator 检测到电话非 11 位 / 姓名 ≤1 字时写入提示
  - 前端基本信息卡片顶部用琥珀色横幅显示
  - 前端字段悬停"修改"功能允许用户手动改正
  - 简历 PATCH 触发缓存失效
- **建议**：生产前换到 glm-4.6v 或 qwen-vl-plus（标准档）

#### Bug 10: 教育经历前端渲染
- 课程纵向单列、honors 和 courses 视觉上混在一起
- **修复**：拆 `EducationItem` 组件，honors 用琥珀色 pill 横排、courses 用灰色 pill 横排，扩展段独立分区

### 5.5 解析进度条（最新）

**用户需求**：
- 解析功能加可视化进度条
- 修正错误的"5-15 秒"预计时间（实际约 30-60 秒）

**改动**：
- 新建 `<ParseProgress>` 组件
  - 渐近曲线 `pct = 95 * (1 - exp(-t / 30))`
  - 30s ≈ 63%、60s ≈ 86%、90s ≈ 95%
  - 永远不到 100% 直到 phase=done（避免"卡 99%"伪装）
  - 同时显示百分比 + 已用秒数
  - failed 时变红
- 上传页 + Profile 重新解析共用同一个组件
- 提示文案改为"通常 30-60 秒，复杂简历可能更长，请勿关闭页面"

### 5.6 PDF 渲染质量提升

**踩坑过程**：
- 原配置：DPI=150 + JPEG quality=85 → A4 页面 1240×1755，标题字 ~35px
- 升到 DPI=220 + PNG 无损 → A4 页面 ~1820×2570，标题字 ~52px
- 同时升 image cap 从 2048 到 2560
- `_as_image_url()` 改为按 magic bytes 自动判断 mime 类型（PNG / JPEG / GIF / WebP）

---

## 6. 当前已知问题（KNOWN_ISSUES）

### 6.1 ⚠️ 模型识别准确度（生产前必须解决）
- glm-4.6v-flashx 在简历顶部小字（姓名、电话）OCR 上**持续失败**
- 已通过 parse_warnings 软兜底 + 前端用户编辑 + 数据清洗，但用户体验仍打折扣
- **建议**：管理员后台切换到 `glm-4.6v` 或 `qwen-vl-plus`，单份成本从 0.012 升到 0.015-0.02 元，但准确率显著提升
- 用户最近一次操作（讨论结尾）已自行切换模型，待验证效果

### 6.2 ⚠️ 上云后非简历专属字段尚未配置
- OSS 适配器只有 stub
- Redis 缓存还没接（用 DB 表代替）
- 异步任务队列没接（同步阻塞 30-60s）
- 这些都在 design.md 第 6 节列出迁移路径，按需逐步做

### 6.3 极端 case 未覆盖
- 多页 PDF 已支持但未充分测试
- DOCX 复杂排版（嵌入图片、表格）只取文本，可能丢失视觉信息
- 加密 / 损坏 PDF 已抛 ValidationError 但未做用户友好引导

### 6.4 没有的能力（v2 路线）
- 多简历管理（每用户当前只支持 1 份）
- 异步任务队列 + 进度真实推送
- 模型多档路由 + 失败降级（当前是单模型直连）
- 敏感字段加密（身份证号 / 银行卡号当前明文存）
- 速率限制（slowapi 中间件待加）
- 用户当日成本配额
- Hypothesis 基于属性的测试（design.md 中的 7 条 Property）

详见 `ARCHITECTURE.md` 第 10 节"已知限制 & v2 路线"。

---

## 7. 关键约定与不要碰的东西

### 7.1 数据契约（与浏览器插件硬约定）

**`ResumeData` schema** (`app/schemas/resume.py`)：
- `schema_version` 是与插件的协议版本号，**改 schema 要同步升版本号**
- 当前标准字段与字段晋升规则以 `SCHEMA.md` 为准
- 高频、稳定、利于自动填表和人工修正的信息可以晋升为固定 schema；长尾信息先进入 `facts` / `extra_sections`
- 新增或修改固定字段时，同步更新 `SCHEMA.md`、prompt、前端、测试和相关产品/架构文档

**`FillPlanResponse` schema** (`app/schemas/fill_plan.py`)：
- `filled[fieldId]` 必须包含 4 个键：value / confidence / reasoning / source
- 不要破坏这个结构

### 7.2 Prompt 是产品的核心资产
`app/prompts/parse_resume.py` 和 `app/prompts/fill_form.py` 经过多轮真实简历调优，每条规则都对应一个真实 bug。**改 prompt 前先看 §5.4，避免回退已修过的 case**。

### 7.3 Adapter 抽象不要绕过
- 不要在 service 里直接 `import httpx` 调模型
- 不要在 service 里直接读 `Path` 写文件
- 走 `app.adapters.models.get_model()` 和 `app.adapters.storage.get_storage()`
- 这是日后切 OSS / 接 Redis / 接异步队列的关键边界

### 7.4 测试夹具的特殊注意
- `tests/conftest.py` 用 `app.adapters.models._real_get_model` 做模型工厂热替换
- API 路由里通过 `app.adapters.models as _models` 动态访问，不要 `from app.adapters.models import get_model`（会绑定时拿到原始引用，导致测试夹具的 monkeypatch 失效）

---

## 8. 接手当天能直接做的事

### 8.1 启动验证
```bash
# 后端
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
brew install poppler  # macOS / apt-get install poppler-utils Linux
cp .env.example .env
uvicorn app.main:app --reload

# 前端
cd web
npm install
npm run dev
# 浏览器开 http://localhost:5173

# 测试
pytest                   # 后端 42+ 项
cd web && npx tsc -b     # 前端类型检查
```

### 8.2 数据库现状
`data/dev.db` 已有数据：
- 1 个 admin 用户
- 1 个普通用户
- 至少 1 份已解析简历（"杨林"那份，姓名/电话识别有问题）

### 8.3 当前服务状态
**截至交接时点**：
- 用户最近改了模型配置（在 admin/models 页面），但具体改成什么待验证
- prompt 中关于姓名/电话的"自检"指令已删除（恢复简洁版）
- 等待重新解析验证效果

### 8.4 第一件可做的事
让用户重新解析"杨林"那份简历，对比新旧结果：
1. 进 http://localhost:5173/admin/login
2. 看当前模型配置
3. 进用户账户的 /profile，找到那份简历，点"重新解析"
4. 看 parse_warnings 是否消失，姓名是否变成"杨林"

---

## 9. 关键决策回顾（按时间顺序）

| 决策 | 时间 | 影响范围 |
|---|---|---|
| 双阶段架构（A 解析 + B 填写） | Day 0 | 整体架构 |
| 单文档 schema + extra_sections 软扩展 | 中期 | 数据契约 |
| Adapter 抽象（model / storage / cache 三层） | Day 1 | 可移植性 |
| 同步阻塞解析（不引入队列） | Day 1 | 简化基础设施 |
| API Key 认证 → 用户名密码 + Token | 中后期 | 全面替换 |
| 双前端入口（用户 / 管理员视觉完全分离） | 中后期 | UI 隔离 |
| Prompt 双保险（prompt 规则 + schema validator 兜底） | 持续 | 健壮性 |
| 渐近进度条而非欺骗性百分比 | 最近 | 用户体验 |

---

## 10. 沟通记录中没文档化的"软知识"

- 用户的 Macbook Pro M4 Pro 是当前开发机，Python 3.13.5
- 用户简历内容方向是 AI / 数据科学
- 简历样本里反复出现的人名："张子涵"、"冯乐普"、"杨林"是不同测试用例
- glm-4.6v-flashx 是用户首选的限时低价模型（讨论早期）
- 用户对界面的简洁度敏感（参考 simplify.jobs），不喜欢冗余装饰
- 用户做事风格：更喜欢"直接动手实施" + "改完再说"，而非过度规划
- 安全/隔离需求：用户和管理员"不应在同一个登录页"

---

## 11. 项目文件清单（接手时重点关注）

| 文件 | 作用 | 改动频率 |
|---|---|---|
| `app/prompts/parse_resume.py` | Stage A prompt | **高频敏感** |
| `app/prompts/fill_form.py` | Stage B prompt | **高频敏感** |
| `app/schemas/resume.py` | 主数据契约 + 一堆 validator | 高频 |
| `app/schemas/fill_plan.py` | 插件交互契约 | 低频 |
| `app/services/parsing_service.py` | Stage A 编排 + 重试 | 中频 |
| `app/services/fill_service.py` | Stage B 编排 + 缓存 | 中频 |
| `app/adapters/models/openai_compat.py` | 模型客户端 | 低频 |
| `app/parsers/preprocess.py` | PDF/DOCX/图片预处理 | 低频但重要 |
| `web/src/pages/Profile.tsx` | 简历预览页 | 中频 |
| `web/src/components/DynamicSection.tsx` | 动态分区渲染 | 低频 |
| `web/src/components/ParseProgress.tsx` | 进度条 | 低频 |

---

## 12. 接手后的建议优先级

### 立即（接手当天）
1. 跑通前后端，注册账号验证完整流程
2. 跟用户确认当前模型配置和"杨林"简历的最新状态
3. 浏览 §5.4 的 10 个已修 bug，避免回退

### 短期（1-2 天）
4. 完成"姓名/电话识别"的 Plan B（用户需求 §6.1）：
   - 选项一：换标准档模型测试（最简单）
   - 选项二：实施"顶部 header 二次裁剪识别"（用户讨论过未实施）
5. 把日志保存到文件（当前只 stdout）

### 中期（一周）
6. 浏览器插件对接联调（与同事协作）
7. 实施 v2 路线中最关键的 2-3 项：模型路由降级、Redis 缓存、异步队列

### 长期
8. 多简历支持
9. 加密 + 速率限制
10. PBT 测试

---

**文档结束**

如对本文档有疑问，可结合：
- 完整对话历史（在用户那边）
- ARCHITECTURE.md
- design.md
- 代码本身（注释相对充足）

祝接手顺利。
