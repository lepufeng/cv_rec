# Requirements Document

## Introduction

简历解析平台是"AI智能简历填写"产品的后端核心。产品的差异化定位在于：不依赖预定义标签库，而是由AI在投递时实时理解目标网页表单的字段语义，从结构化简历中智能匹配填入。本平台承担两个核心阶段的能力：

- **阶段A（简历解析）**：用户上传简历后，调用多模态大模型将其解析为结构化JSON，作为该用户的"简历数据源"持久化保存。
- **阶段B（智能填写）**：浏览器插件抓取目标招聘网页的表单字段后，调用本平台的API，由LLM结合该用户的结构化简历，输出每个字段的填写方案。

平台同时对外暴露用户管理、简历管理、模型路由、成本控制等能力。本Spec不包含浏览器插件本身、页面DOM操作、ATS系统适配等插件侧职责。

**核心设计原则**

- AI推理优先于规则枚举，避免"过量标签化"
- 中文简历首选，国产模型优先（GLM/通义/Kimi）
- 本地开发优先，架构上预留无痛上云路径
- 模型可插拔，避免厂商锁定
- 用户隐私敏感，简历数据需要明确的访问控制

## Requirements

### Requirement 1: 简历文件上传与预处理

**User Story:** 作为求职者用户，我希望能上传不同格式的简历文件，系统能稳定接收并预处理，以便后续解析。

#### Acceptance Criteria

1. WHEN 用户通过API上传简历文件 THEN 系统 SHALL 支持 PDF、DOCX、PNG、JPG 四种格式
2. WHEN 上传的文件大小超过 10MB THEN 系统 SHALL 拒绝上传并返回明确的错误信息
3. WHEN 上传的文件格式不在支持列表中 THEN 系统 SHALL 拒绝上传并返回支持的格式列表
4. WHEN 用户上传 PDF 简历 THEN 系统 SHALL 将其渲染为图片用于多模态模型输入
5. WHEN 用户上传 DOCX 简历 THEN 系统 SHALL 提取文本并转换为图片或纯文本两种形式
6. WHEN 用户上传图片简历 THEN 系统 SHALL 直接作为图片输入
7. WHEN 文件接收成功 THEN 系统 SHALL 返回唯一的解析任务ID供后续查询
8. WHEN 上传过程中网络中断或文件损坏 THEN 系统 SHALL 返回清晰的错误信息且不创建任务记录

### Requirement 2: 简历解析（阶段A）

**User Story:** 作为求职者用户，我希望上传的简历能被准确解析为结构化数据，覆盖个人信息、教育、工作、项目、技能等核心模块，以便后续在不同表单中复用。

#### Acceptance Criteria

1. WHEN 解析任务被触发 THEN 系统 SHALL 调用配置的多模态模型对简历进行结构化提取
2. WHEN 模型返回解析结果 THEN 系统 SHALL 验证其符合预定义的JSON Schema
3. WHEN 解析结果不符合Schema THEN 系统 SHALL 自动重试一次，仍失败则标记任务失败
4. WHEN 简历中存在某字段（如政治面貌、身高）的信息 THEN 系统 SHALL 准确提取该字段
5. WHEN 简历中不存在某字段 THEN 系统 SHALL 在JSON中显式标记为 null，禁止编造
6. WHEN 简历中的时间信息以多种格式出现 THEN 系统 SHALL 统一转换为 YYYY-MM 格式
7. WHEN 解析完成 THEN 系统 SHALL 持久化结构化结果，关联到用户和原始文件
8. WHEN 解析任务运行 THEN 系统 SHALL 记录耗时、token消耗、所用模型等元数据用于成本分析
9. WHEN 同一用户重复上传同一文件（按内容哈希判断） THEN 系统 SHALL 直接复用已有解析结果，不重新调用模型

### Requirement 3: 简历结构化数据 Schema

**User Story:** 作为浏览器插件开发者（团队同事），我希望平台输出的简历JSON有稳定的Schema约定，以便插件端可靠地消费数据。

#### Acceptance Criteria

1. WHEN 平台输出简历JSON THEN 数据 SHALL 包含以下顶级模块：basic_info、job_intent、education、work_experience、project_experience、skills、certifications、languages、self_evaluation
2. WHEN 输出 basic_info THEN 字段 SHALL 包括 name、gender、birth_date、age、phone、email、location、hometown、marital_status、political_status、ethnicity 等常见个人信息字段
3. WHEN 输出 education / work_experience / project_experience THEN 数据 SHALL 为列表结构，按时间倒序排列
4. WHEN Schema 发生兼容性变更 THEN 系统 SHALL 通过版本号字段（schema_version）显式标记
5. WHEN 插件端通过 API 拉取数据 THEN 响应 SHALL 包含 schema_version，便于客户端做版本判断
6. WHEN 某字段的语义在不同简历中表现不一（如GPA可能是"3.8/4.0"或"85分"） THEN Schema SHALL 用字符串类型保留原值，由阶段B在使用时再做语义转换

### Requirement 4: 智能表单填写（阶段B）

**User Story:** 作为浏览器插件，我希望提交目标网页的表单字段列表后，能从平台获取智能填写方案，让AI实时理解字段语义并匹配简历内容，而不是依赖预定义标签库。

#### Acceptance Criteria

1. WHEN 插件提交表单字段列表（含 id、label、type、options、required等） THEN 系统 SHALL 结合用户的结构化简历，调用LLM生成填写方案
2. WHEN LLM 返回填写方案 THEN 每个字段 SHALL 包含 value、confidence、reasoning、source 四个属性
3. WHEN 某字段在简历中无对应信息且无法合理推断 THEN 系统 SHALL 将其标记为 needs_user_input
4. WHEN 表单字段为 select / radio 类型 THEN 系统 SHALL 从其 options 列表中选择最匹配的值
5. WHEN 表单字段为 repeater 类型（如多段工作经历） THEN 系统 SHALL 按时间倒序填充每个子项
6. WHEN 表单字段可由其他字段推断（如"出生年份"可由"年龄"推算） THEN 系统 SHALL 进行合理推断并在 reasoning 中说明
7. WHEN LLM 输出违反 Schema 或包含明显幻觉 THEN 系统 SHALL 拒绝该方案并返回错误，宁可让用户手填也不返回错误数据
8. WHEN 同一用户对同一目标网站（按域名+表单结构哈希）发起填写请求 THEN 系统 SHALL 优先返回缓存方案，仅当用户简历更新或缓存过期才重新调用LLM

### Requirement 5: 多模型路由与成本控制

**User Story:** 作为平台运营者，我希望能根据成本和质量需求灵活切换底层模型，并在成本超限时自动降级，避免预算失控。

#### Acceptance Criteria

1. WHEN 系统初始化 THEN 系统 SHALL 通过配置文件加载可用模型列表（GLM/通义/Kimi等）及其API凭证
2. WHEN 阶段A或阶段B需要调用模型 THEN 系统 SHALL 根据预设的路由策略选择具体模型
3. WHEN 默认模型调用失败（超时、限流、API错误） THEN 系统 SHALL 自动重试1次，仍失败则降级到备用模型
4. WHEN 模型返回响应 THEN 系统 SHALL 记录该次调用的输入输出token数和实际成本
5. WHEN 用户/系统的当日累计成本超过预设阈值 THEN 系统 SHALL 切换到经济模型或拒绝服务，返回明确提示
6. WHEN 添加新模型 THEN 开发者 SHALL 只需实现统一接口而无需改动业务逻辑
7. WHEN 用户主动选择模型档位（经济/标准/旗舰） THEN 系统 SHALL 在该档位内选择具体模型

### Requirement 6: 用户与简历管理

**User Story:** 作为求职者用户，我希望能管理自己的多份简历，并安全地访问自己的解析数据。

#### Acceptance Criteria

1. WHEN 用户首次使用 THEN 系统 SHALL 支持注册并生成唯一标识
2. WHEN 用户登录 THEN 系统 SHALL 通过 Token 方式进行身份认证
3. WHEN 用户访问简历 API THEN 系统 SHALL 校验该简历是否归属当前用户
4. WHEN 用户为非简历所有者 THEN 系统 SHALL 拒绝访问并返回 403
5. WHEN 用户上传新简历 THEN 系统 SHALL 允许同一用户保留多份简历记录
6. WHEN 用户设置默认简历 THEN 浏览器插件调用阶段B时 SHALL 默认使用该简历
7. WHEN 用户删除简历 THEN 系统 SHALL 同时删除原始文件、解析结果及相关缓存
8. WHEN 用户手动修正解析结果 THEN 系统 SHALL 持久化修正后的版本，并在后续阶段B中使用修正版

### Requirement 7: 对外 API 接口

**User Story:** 作为浏览器插件开发者，我希望平台提供清晰、稳定的 RESTful API，以便集成开发。

#### Acceptance Criteria

1. WHEN 插件需要上传简历 THEN 系统 SHALL 提供 POST /api/resumes 接口
2. WHEN 插件需要查询解析进度 THEN 系统 SHALL 提供 GET /api/resumes/{id}/status 接口
3. WHEN 插件需要获取解析结果 THEN 系统 SHALL 提供 GET /api/resumes/{id} 接口返回结构化JSON
4. WHEN 插件需要修正解析结果 THEN 系统 SHALL 提供 PATCH /api/resumes/{id} 接口
5. WHEN 插件需要请求填写方案 THEN 系统 SHALL 提供 POST /api/fill-plans 接口，接收表单字段列表，返回填写方案
6. WHEN API 调用出错 THEN 系统 SHALL 返回统一格式的错误响应（code、message、details）
7. WHEN 接口契约变更 THEN 系统 SHALL 通过 URL 路径中的版本号（如 /api/v1/）保持向后兼容
8. WHEN 调用任意 API THEN 系统 SHALL 在响应中提供必要的速率限制头（X-RateLimit-*）

### Requirement 8: 数据安全与隐私

**User Story:** 作为求职者用户，我希望我的简历数据被妥善保护，不被未授权访问或泄露。

#### Acceptance Criteria

1. WHEN 简历文件存储 THEN 系统 SHALL 使用对象存储或本地存储，并对路径进行隔离
2. WHEN 简历内容传输至模型API THEN 系统 SHALL 使用 HTTPS 加密通信
3. WHEN 用户主动删除简历 THEN 系统 SHALL 同步删除存储介质上的原始文件和解析结果
4. WHEN 系统记录日志 THEN 日志 SHALL 不包含简历完整文本和个人敏感信息（姓名、电话、身份证号等需脱敏）
5. WHEN 数据库存储简历 THEN 敏感字段（如身份证号、手机号） SHALL 加密存储
6. WHEN 用户请求导出全部数据 THEN 系统 SHALL 在合理时间内提供该用户的所有数据副本
7. WHEN 出现 API 异常错误信息 THEN 错误响应 SHALL 不泄露数据库结构、模型API密钥或其他内部信息

### Requirement 9: 可观测性与运维

**User Story:** 作为平台运维者，我希望能监控平台的健康状态、调用量、模型成本和错误率，及时发现并处理问题。

#### Acceptance Criteria

1. WHEN 任意 API 被调用 THEN 系统 SHALL 记录请求耗时、状态码、用户ID（脱敏）
2. WHEN 模型API被调用 THEN 系统 SHALL 记录调用模型、token数、成本、耗时、是否成功
3. WHEN 解析或填写任务失败 THEN 系统 SHALL 记录失败原因和上下文，便于排查
4. WHEN 运维者查询统计 THEN 系统 SHALL 提供按日/按用户/按模型维度的成本与调用量报表
5. WHEN 系统出现异常 THEN 关键错误 SHALL 触发告警通知
6. WHEN 运维者部署新版本 THEN 系统 SHALL 提供 /health 接口供探活检测

### Requirement 10: 本地开发与云端迁移

**User Story:** 作为开发者，我希望能在本地 MacBook Pro M4 完整跑通整个平台，验证后再上云，避免一上来就处理云资源依赖。

#### Acceptance Criteria

1. WHEN 开发者在本地启动平台 THEN 系统 SHALL 通过 docker-compose 一键启动所有依赖（数据库、缓存等）
2. WHEN 系统读取配置 THEN 配置 SHALL 全部通过环境变量或 .env 文件外部化，不允许硬编码
3. WHEN 系统访问文件存储 THEN 存储后端 SHALL 通过抽象接口实现，本地用文件系统、云端用 OSS/S3
4. WHEN 系统调用模型 THEN 模型客户端 SHALL 通过抽象接口实现，可在云端API与本地模型之间切换
5. WHEN 项目交付 THEN 系统 SHALL 提供 Dockerfile，可构建为可部署的容器镜像
6. WHEN 开发环境与生产环境差异化配置 THEN 系统 SHALL 通过 profile（dev/prod）机制隔离
