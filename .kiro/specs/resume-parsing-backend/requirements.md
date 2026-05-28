# Requirements Document

## Introduction

本文档定义"简历 AI 填写产品"的**后端框架**需求。后端为 Edge 浏览器插件提供两类核心能力：
**阶段 A** 接收用户上传的简历文件，调用多模态视觉语言模型（VLM）将其解析为结构化 JSON 并持久化；
**阶段 B** 接收插件抓取的页面表单字段集合，结合已解析的简历数据，调用 LLM 生成智能填写方案返回给插件。

后端采用 Python + FastAPI 实现，使用 PostgreSQL 持久化结构化数据与缓存，
通过 Docker + docker-compose 进行本地与上云部署。需求范围**仅限后端服务**，
不包含浏览器插件的实现，也不包含面向最终用户的前端管理界面。

为支持成本与质量的可演进性，后端从一开始就对三个关键变化点做抽象：
（1）模型供应商可切换（开发期 GLM-Flash 限免 / 主力 qwen-vl-plus / 兜底 qwen-vl-max）；
（2）文件存储可切换（本地 → 对象存储）；
（3）配置全部外置（pydantic-settings + .env）。
阶段 B 经成本压测验证采用"单次大调用"策略，并通过表单方案缓存将重复站点投递的成本降低约 30%。

## Glossary

- **Resume_Backend**：本规约定义的整套后端服务，包含下列所有子系统。
- **API_Gateway**：基于 FastAPI 的 HTTP 入口层，负责路由、鉴权中间件、请求校验、错误统一处理。
- **Auth_Service**：用户注册、登录、令牌签发与校验的子系统。
- **Resume_Upload_Service**：接收用户上传的简历文件（PDF/DOCX），完成格式校验、预处理（PDF 转图片、DOCX 文本抽取）并交由 Storage_Adapter 持久化。
- **Storage_Adapter**：文件存储抽象层，提供统一的 `put / get / delete / get_url` 接口；当前内置本地文件系统实现，可替换为 OSS/S3 实现。
- **Resume_Parser**：阶段 A 的解析服务。调用 Model_Router 选择的多模态模型，将简历的图片（或文本）解析为遵循固定 schema 的结构化 JSON。
- **Parsed_Resume**：Resume_Parser 的输出，结构化的 JSON 简历数据，存储于 PostgreSQL。
- **Form_Fill_Service**：阶段 B 的智能填写服务。接收插件传入的表单字段列表与 resumeId，调用 Model_Router 输出每字段的填写方案。
- **Fill_Plan**：Form_Fill_Service 的输出，包含每个字段的 `value / confidence / reasoning / source`，以及 `needs_user_input` 与 `warnings` 列表。
- **Form_Plan_Cache**：Fill_Plan 的缓存子系统，缓存键由"站点指纹 + 表单字段指纹 + 简历版本"组成。
- **Model_Router**：模型调用抽象层。对外暴露统一接口（chat / vision_chat），对内适配 OpenAI 兼容、Qwen、GLM 等不同供应商，并支持主力/兜底模型路由与重试切换。
- **Model_Provider**：被 Model_Router 适配的具体模型供应商实现，每个 Provider 实现统一的 Provider 接口。
- **Config_Manager**：基于 pydantic-settings 的配置管理子系统，从环境变量与 `.env` 文件加载所有配置。
- **Plugin_Client**：浏览器插件，作为本后端的唯一外部调用方。本规约不定义其内部实现，仅定义与之交互的 API 契约。
- **Site_Fingerprint**：用于 Form_Plan_Cache 缓存键的站点标识，由域名 + 表单结构哈希构成。
- **Container_Image**：包含 Resume_Backend 全部代码与依赖的 Docker 镜像。
- **Compose_Stack**：由 docker-compose 定义的本地开发与单机部署编排，包含 Resume_Backend 容器与 PostgreSQL 容器。

## Requirements

### Requirement 1: 用户注册与登录

**User Story:** 作为简历填写产品的最终用户，我希望注册账号并登录后端，以便我的简历数据被安全地与我的身份绑定。

#### Acceptance Criteria

1. WHEN Plugin_Client 以邮箱与密码调用注册接口，THE Auth_Service SHALL 校验邮箱格式合法且密码长度不小于 8 个字符，并在校验通过时创建用户记录。
2. IF 注册时邮箱已存在于数据库，THEN THE Auth_Service SHALL 返回 HTTP 409 状态码与错误码 `EMAIL_ALREADY_EXISTS`。
3. THE Auth_Service SHALL 使用 bcrypt 算法对用户密码进行哈希存储，且不在数据库中保留明文密码。
4. WHEN Plugin_Client 以正确的邮箱与密码调用登录接口，THE Auth_Service SHALL 返回一个有效期为 7 天的 JWT 访问令牌。
5. IF 登录时密码错误或用户不存在，THEN THE Auth_Service SHALL 返回 HTTP 401 状态码与错误码 `INVALID_CREDENTIALS`，且响应体不区分"用户不存在"与"密码错误"两种情形。
6. WHEN 同一邮箱在 60 秒内连续 5 次登录失败，THE Auth_Service SHALL 在接下来的 5 分钟内拒绝该邮箱的登录请求并返回错误码 `RATE_LIMITED`。

### Requirement 2: 请求鉴权

**User Story:** 作为后端开发者，我希望所有访问简历数据的接口都强制鉴权，以便用户数据不会被未授权方访问。

#### Acceptance Criteria

1. THE API_Gateway SHALL 对除注册、登录、健康检查之外的所有接口要求 `Authorization: Bearer <jwt>` 请求头。
2. IF 请求未携带 `Authorization` 头或令牌格式错误，THEN THE API_Gateway SHALL 返回 HTTP 401 状态码与错误码 `MISSING_TOKEN`。
3. IF JWT 令牌签名无效或已过期，THEN THE API_Gateway SHALL 返回 HTTP 401 状态码与错误码 `INVALID_TOKEN`。
4. WHEN 鉴权通过，THE API_Gateway SHALL 将解析得到的 `user_id` 注入请求上下文供下游服务使用。
5. IF 用户尝试访问不属于自身的简历资源（resumeId 对应的 user_id 与令牌中的 user_id 不一致），THEN THE API_Gateway SHALL 返回 HTTP 403 状态码与错误码 `FORBIDDEN`。

### Requirement 3: 简历文件上传

**User Story:** 作为最终用户，我希望通过插件上传 PDF 或 Word 简历文件，以便后端对其进行解析。

#### Acceptance Criteria

1. WHEN Plugin_Client 调用 `POST /api/resume/upload` 并附带 multipart/form-data 文件字段，THE Resume_Upload_Service SHALL 接收文件并返回 HTTP 202 状态码与 `{ "resume_id": <uuid>, "task_id": <uuid>, "status": "pending" }`。
2. THE Resume_Upload_Service SHALL 仅接受 MIME 类型为 `application/pdf`、`application/vnd.openxmlformats-officedocument.wordprocessingml.document` 或 `application/msword` 的文件。
3. IF 上传文件大小超过 10 MB，THEN THE Resume_Upload_Service SHALL 返回 HTTP 413 状态码与错误码 `FILE_TOO_LARGE`。
4. IF 上传文件的 MIME 类型不在允许列表内，THEN THE Resume_Upload_Service SHALL 返回 HTTP 415 状态码与错误码 `UNSUPPORTED_FILE_TYPE`。
5. WHEN 文件接收完成，THE Resume_Upload_Service SHALL 通过 Storage_Adapter 以 `users/{user_id}/resumes/{resume_id}/original.{ext}` 为键持久化原始文件。
6. WHEN 文件为 PDF，THE Resume_Upload_Service SHALL 使用 pdf2image 与 Pillow 将每一页转换为 PNG 图片，并通过 Storage_Adapter 以 `users/{user_id}/resumes/{resume_id}/page_{n}.png` 为键持久化。
7. WHEN 文件为 DOCX 或 DOC，THE Resume_Upload_Service SHALL 使用 python-docx 抽取纯文本并通过 Storage_Adapter 持久化为 `users/{user_id}/resumes/{resume_id}/text.txt`。
8. WHEN 预处理完成，THE Resume_Upload_Service SHALL 在数据库中将该 resume 的 `status` 字段置为 `parsing`，并触发异步解析任务。

### Requirement 4: 存储抽象层

**User Story:** 作为后端开发者，我希望本地开发使用文件系统、生产环境使用对象存储，且切换不需要修改业务代码。

#### Acceptance Criteria

1. THE Storage_Adapter SHALL 暴露统一接口：`put(key, bytes_or_stream) -> None`、`get(key) -> bytes`、`delete(key) -> None`、`get_url(key, expires_in) -> str`。
2. THE Storage_Adapter SHALL 通过 Config_Manager 的 `STORAGE_BACKEND` 配置项在 `local` 与 `s3` 两种实现之间切换。
3. WHERE `STORAGE_BACKEND=local`，THE Storage_Adapter SHALL 将文件存储到由 `LOCAL_STORAGE_ROOT` 配置项指定的目录下。
4. WHERE `STORAGE_BACKEND=s3`，THE Storage_Adapter SHALL 使用 `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY` 配置项连接对象存储服务。
5. IF 写入操作因网络或权限错误失败，THEN THE Storage_Adapter SHALL 抛出 `StorageWriteError` 异常并附带原始错误信息。
6. THE Storage_Adapter SHALL 在 `get_url` 调用时返回一个有效期不超过 3600 秒的访问 URL；本地实现可返回相对路径供 API 层代理。

### Requirement 5: 阶段 A 简历解析

**User Story:** 作为最终用户，我希望系统在我上传简历后将其解析为结构化数据，以便后续表单填写时直接使用。

#### Acceptance Criteria

1. WHEN 一个状态为 `parsing` 的解析任务被触发，THE Resume_Parser SHALL 通过 Storage_Adapter 读取该 resume 的图片或文本，构造多模态请求并调用 Model_Router。
2. THE Resume_Parser SHALL 使用固定的解析提示词，要求模型输出符合预定义 JSON Schema 的结构化简历，包含 `basic_info`、`job_intent`、`education`、`work_experience`、`project_experience`、`skills`、`certifications`、`languages`、`self_evaluation` 九个顶层字段。
3. WHEN 模型返回结果，THE Resume_Parser SHALL 使用 JSON Schema 校验输出结构，校验通过后将 Parsed_Resume 写入数据库并将 resume `status` 置为 `parsed`。
4. IF 模型返回的 JSON 无法被解析或校验失败，THEN THE Resume_Parser SHALL 使用同一模型重试一次；若再次失败，THE Resume_Parser SHALL 通过 Model_Router 切换至兜底模型重试一次。
5. IF 全部重试均失败，THEN THE Resume_Parser SHALL 将 resume `status` 置为 `parse_failed` 并记录失败原因到 `parse_error` 字段。
6. THE Resume_Parser SHALL 在每次模型调用后记录输入 token 数、输出 token 数、所用模型名称与耗时到 `model_call_log` 表。
7. WHEN Resume_Parser 单次调用耗时超过 60 秒，THE Resume_Parser SHALL 取消该调用、释放资源并按重试规则继续处理。

### Requirement 6: 解析结果查询与修正

**User Story:** 作为最终用户，我希望查看解析后的简历数据并修正其中的错误，以便后续填写使用准确的信息。

#### Acceptance Criteria

1. WHEN Plugin_Client 调用 `GET /api/resume/{resume_id}/parsed`，THE API_Gateway SHALL 返回该 resume 的当前状态以及（在 `status=parsed` 或 `status=corrected` 时）Parsed_Resume 的完整 JSON。
2. WHILE resume `status` 为 `parsing`，THE API_Gateway SHALL 在 `GET /api/resume/{resume_id}/parsed` 响应中返回 `{ "status": "parsing", "data": null }`，HTTP 状态码为 200。
3. WHILE resume `status` 为 `parse_failed`，THE API_Gateway SHALL 在响应中返回 `{ "status": "parse_failed", "error": <reason> }`，HTTP 状态码为 200。
4. WHEN Plugin_Client 调用 `PUT /api/resume/{resume_id}/parsed` 并附带完整 Parsed_Resume JSON，THE API_Gateway SHALL 校验该 JSON 符合 Parsed_Resume Schema，校验通过后将其写入数据库、把 resume `status` 置为 `corrected` 并使该 resume 关联的 Form_Plan_Cache 条目失效。
5. IF `PUT /api/resume/{resume_id}/parsed` 提交的 JSON 不符合 Schema，THEN THE API_Gateway SHALL 返回 HTTP 422 状态码与每个不合法字段的具体错误信息。

### Requirement 7: 阶段 B 智能表单填写

**User Story:** 作为最终用户，当我在招聘网站打开投递表单时，我希望后端基于我的简历自动给出每个字段的填写值，以便插件帮我一键填入。

#### Acceptance Criteria

1. WHEN Plugin_Client 调用 `POST /api/form/fill` 并附带 `{ "resume_id": <uuid>, "site_url": <str>, "fields": [<FormField>] }`，THE Form_Fill_Service SHALL 校验该 resume 属于当前用户且 `status` 为 `parsed` 或 `corrected`。
2. IF 调用时 resume `status` 为 `pending`、`parsing` 或 `parse_failed`，THEN THE Form_Fill_Service SHALL 返回 HTTP 409 状态码与错误码 `RESUME_NOT_READY`。
3. WHEN 字段列表通过校验，THE Form_Fill_Service SHALL 先查询 Form_Plan_Cache，若命中则直接返回缓存的 Fill_Plan 并在响应中标记 `cache_hit=true`。
4. IF Form_Plan_Cache 未命中，THEN THE Form_Fill_Service SHALL 将 Parsed_Resume、字段列表、固定填写提示词组合为单次大调用提交给 Model_Router。
5. THE Form_Fill_Service SHALL NOT 将单个表单拆分为按字段或按分组的多次模型调用。
6. WHEN 模型返回 Fill_Plan，THE Form_Fill_Service SHALL 校验响应中包含 `filled`、`needs_user_input`、`warnings` 三个字段，且 `filled` 中每个条目包含 `value`、`confidence`、`reasoning`、`source`。
7. WHEN Fill_Plan 校验通过，THE Form_Fill_Service SHALL 将其写入 Form_Plan_Cache 后再返回给 Plugin_Client。
8. IF 模型调用失败或 Fill_Plan 校验失败，THEN THE Form_Fill_Service SHALL 通过 Model_Router 切换至兜底模型重试一次；二次失败时返回 HTTP 502 状态码与错误码 `FILL_PLAN_GENERATION_FAILED`。
9. THE Form_Fill_Service SHALL 在响应中包含 `model_used` 与 `latency_ms` 字段，便于客户端展示与排查。

### Requirement 8: 表单方案缓存

**User Story:** 作为产品负责人，我希望对相同站点、相同表单结构、相同简历版本的填写方案做缓存，以便降低约 30% 的模型调用成本。

#### Acceptance Criteria

1. THE Form_Plan_Cache SHALL 以 `(user_id, resume_version, site_fingerprint, fields_fingerprint)` 四元组作为缓存键。
2. THE Form_Plan_Cache SHALL 通过对 `fields` 数组（按 `id` 升序排序后序列化）计算 SHA-256 摘要生成 `fields_fingerprint`。
3. THE Form_Plan_Cache SHALL 通过对 `site_url` 的注册域名（registrable domain）计算 SHA-256 摘要生成 `site_fingerprint`。
4. THE Form_Plan_Cache SHALL 为每个缓存条目设置 7 天的 TTL；TTL 到期的条目在下一次访问时被视为未命中并被删除。
5. WHEN 同一 resume 的 Parsed_Resume 被修正（Requirement 6 AC 4），THE Form_Plan_Cache SHALL 使该 resume 的所有缓存条目失效。
6. THE Form_Plan_Cache SHALL 在 PostgreSQL 中以独立表 `form_plan_cache` 实现，包含 `cache_key_hash`、`fill_plan_json`、`created_at`、`expires_at` 四列。
7. WHEN 缓存写入失败（数据库错误），THE Form_Fill_Service SHALL 仍正常返回当次生成的 Fill_Plan 并记录写缓存失败的告警日志。

### Requirement 9: 模型调用抽象层

**User Story:** 作为后端开发者，我希望以统一接口调用不同供应商的模型，并能通过配置切换主力/兜底模型，以便随成本与质量的变化灵活调整。

#### Acceptance Criteria

1. THE Model_Router SHALL 暴露统一接口 `chat(messages, model_alias, **kwargs)` 与 `vision_chat(messages, images, model_alias, **kwargs)`，返回结构包含 `content`、`input_tokens`、`output_tokens`、`model_name`、`latency_ms`。
2. THE Model_Router SHALL 支持至少三类 Model_Provider 实现：OpenAI 兼容协议、阿里云 DashScope（Qwen 系列）、智谱 BigModel（GLM 系列）。
3. THE Model_Router SHALL 通过 Config_Manager 加载 `model_alias` 到 `(provider, model_name, api_key, base_url)` 的映射，且映射可在不修改代码的前提下扩展新别名。
4. THE Model_Router SHALL 支持为每个业务阶段（`stage_a_primary`、`stage_a_fallback`、`stage_b_primary`、`stage_b_fallback`）独立配置 `model_alias`。
5. WHEN 业务方调用时传入主力 alias 而调用失败（网络错误、5xx、超时），THE Model_Router SHALL 返回错误并由调用方决定是否切换到兜底 alias 重试，Model_Router 自身不做静默切换。
6. IF 配置中引用了未注册的 `model_alias`，THEN THE Model_Router SHALL 在服务启动时抛出 `ModelConfigError` 并阻止服务启动。
7. THE Model_Router SHALL 在每次调用结束后将一条记录写入 `model_call_log` 表，包含 `request_id`、`stage`、`model_name`、`input_tokens`、`output_tokens`、`latency_ms`、`status`、`error_message`。

### Requirement 10: 配置管理

**User Story:** 作为后端开发者，我希望所有可变配置都通过环境变量与 `.env` 文件管理，以便不同环境之间无需修改代码即可部署。

#### Acceptance Criteria

1. THE Config_Manager SHALL 基于 pydantic-settings 实现，从进程环境变量与项目根目录的 `.env` 文件加载配置，环境变量优先级高于 `.env`。
2. THE Config_Manager SHALL 在服务启动时校验所有必填配置项；缺失任一必填项时，服务 SHALL 在启动阶段失败并打印缺失字段名。
3. THE Config_Manager SHALL 至少包含以下配置项：`APP_ENV`、`DATABASE_URL`、`JWT_SECRET`、`JWT_EXPIRES_DAYS`、`STORAGE_BACKEND`、`LOCAL_STORAGE_ROOT`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`MODEL_PROVIDERS_CONFIG`、`STAGE_A_PRIMARY_MODEL`、`STAGE_A_FALLBACK_MODEL`、`STAGE_B_PRIMARY_MODEL`、`STAGE_B_FALLBACK_MODEL`、`MAX_UPLOAD_MB`、`PARSE_TIMEOUT_SECONDS`、`CACHE_TTL_DAYS`。
4. WHERE `APP_ENV=development`，THE Config_Manager SHALL 允许 `STORAGE_BACKEND=local` 与 `S3_*` 配置项缺省。
5. WHERE `APP_ENV=production`，THE Config_Manager SHALL 强制要求 `STORAGE_BACKEND=s3`，且 `S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY` 必须非空。
6. THE Config_Manager SHALL NOT 在任何日志输出中打印 `JWT_SECRET`、`S3_SECRET_KEY` 或 Model_Provider 的 `api_key` 字段值。

### Requirement 11: 插件端 API 契约

**User Story:** 作为浏览器插件开发者，我希望后端提供稳定的 REST 接口契约，以便插件按既定协议交互。

#### Acceptance Criteria

1. THE API_Gateway SHALL 暴露以下 REST 接口（路径与方法固定）：`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/resume/upload`、`GET /api/resume/{resume_id}/parsed`、`PUT /api/resume/{resume_id}/parsed`、`POST /api/form/fill`、`GET /api/health`。
2. THE API_Gateway SHALL 使用 JSON 作为所有非文件请求与响应的载荷格式，`Content-Type` 为 `application/json`。
3. THE API_Gateway SHALL 在所有错误响应中返回统一结构 `{ "error_code": <str>, "message": <str>, "details": <object|null> }`。
4. THE API_Gateway SHALL 为每个请求生成 `X-Request-Id` 响应头；当请求头中已携带 `X-Request-Id` 时，沿用客户端提供的值。
5. THE API_Gateway SHALL 通过 FastAPI 自动生成的 OpenAPI 文档暴露在 `/api/openapi.json` 路径，并提供 Swagger UI 在 `/api/docs` 路径供调试使用。
6. WHERE `APP_ENV=production`，THE API_Gateway SHALL 禁用 `/api/docs` 路径并返回 HTTP 404。
7. THE API_Gateway SHALL 为所有 `/api/*` 接口启用 CORS，允许来源由 `ALLOWED_ORIGINS` 配置项控制（默认包含 Edge 插件的扩展协议来源）。

### Requirement 12: 健康检查与可观测性

**User Story:** 作为运维人员，我希望后端提供健康检查端点与结构化日志，以便监控服务状态与排查问题。

#### Acceptance Criteria

1. WHEN 调用 `GET /api/health`，THE API_Gateway SHALL 返回 HTTP 200 状态码与 `{ "status": "ok", "version": <str>, "checks": { "database": "ok"|"fail", "storage": "ok"|"fail" } }`。
2. IF `database` 或 `storage` 任一检查失败，THEN THE API_Gateway SHALL 在响应中将对应字段置为 `fail`，整体 HTTP 状态码改为 503。
3. THE Resume_Backend SHALL 以 JSON 行格式输出日志，每条日志至少包含 `timestamp`、`level`、`request_id`、`user_id`、`message` 字段。
4. THE Resume_Backend SHALL 在每次模型调用前后输出 `model_call.start` 与 `model_call.end` 两条日志，`end` 日志包含 `tokens_in`、`tokens_out`、`latency_ms`、`model_name`、`status`。

### Requirement 13: 容器化部署

**User Story:** 作为后端开发者，我希望通过 docker-compose 一键启动整套后端，以便在 MacBook Pro 本地开发与上云时复用同一编排。

#### Acceptance Criteria

1. THE Resume_Backend SHALL 提供项目根目录的 `Dockerfile`，可构建出一个可运行 FastAPI 应用的 Container_Image。
2. THE Container_Image SHALL 包含 pdf2image、Pillow、python-docx 所需的系统依赖（含 poppler-utils），且镜像可在 linux/amd64 与 linux/arm64 两种架构上构建运行。
3. THE Resume_Backend SHALL 提供项目根目录的 `docker-compose.yml`，定义至少 `backend` 与 `postgres` 两个服务，并通过命名卷持久化 PostgreSQL 数据与（在 `STORAGE_BACKEND=local` 时）本地存储目录。
4. THE Compose_Stack SHALL 通过 `env_file: .env` 将所有配置项注入 `backend` 服务。
5. WHEN 执行 `docker compose up -d`，THE Compose_Stack SHALL 在 `backend` 服务启动时等待 `postgres` 服务通过其健康检查后再启动。
6. THE Container_Image SHALL 在容器内暴露 8000 端口供 HTTP 访问，且 `Compose_Stack` 默认将其映射到宿主机 8000 端口。
7. THE Container_Image SHALL 在启动时执行数据库迁移（Alembic 或等价工具）至最新版本后再启动 HTTP 服务。

### Requirement 14: 数据持久化与隔离

**User Story:** 作为最终用户，我希望我的简历数据被安全地与他人隔离存储，以便我的隐私不会被泄露。

#### Acceptance Criteria

1. THE Resume_Backend SHALL 使用 PostgreSQL 作为唯一的关系型数据库，通过 `DATABASE_URL` 配置项连接。
2. THE Resume_Backend SHALL 至少包含以下表：`users`、`resumes`、`parsed_resumes`、`form_plan_cache`、`model_call_log`。
3. THE `resumes` 表 SHALL 包含 `id`、`user_id`、`original_filename`、`mime_type`、`status`、`parse_error`、`version`、`created_at`、`updated_at` 字段，且 `user_id` 为指向 `users.id` 的外键。
4. WHEN Parsed_Resume 被用户修正（Requirement 6 AC 4），THE Resume_Backend SHALL 将对应 `resumes.version` 加 1。
5. THE Resume_Backend SHALL 对所有涉及 `user_id` 过滤的查询使用数据库索引（在 `resumes.user_id`、`form_plan_cache.user_id` 上建立索引）。
6. WHEN 用户被删除（管理操作），THE Resume_Backend SHALL 级联删除该用户在 `resumes`、`parsed_resumes`、`form_plan_cache` 中的所有记录，并通过 Storage_Adapter 删除该用户在存储后端中的所有对象。
