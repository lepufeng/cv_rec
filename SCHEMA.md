# Schema 说明文档

> 本文是当前简历解析与插件填表的数据契约说明。
> 代码层面的真实定义在 `app/schemas/resume.py` 与 `app/schemas/fill_plan.py`。

## 维护规则

凡是修改 schema，必须在同一次改动中同步检查并更新以下位置：

1. 如果修改 `ResumeData`，同步更新 `app/schemas/resume.py` 中的 `SCHEMA_VERSION`。
2. 同步更新 `app/models/resume.py` 中 `schema_version` 的默认值。
3. 同步更新解析 prompt：`app/prompts/parse_resume.py`。
4. 如果新字段会参与招聘表单填写，同步更新填表 prompt：`app/prompts/fill_form.py`。
5. 同步更新前端类型与展示：`web/src/lib/api.ts` 以及相关页面。
6. 同步更新测试与 fixture：`tests/fixtures/`、`tests/unit/test_schemas.py`。
7. 同步更新本文，以及受影响的 `README.md`、`ARCHITECTURE.md`、`PRODUCT_FLOW_PRD.md`、`E2E_SELF_CHECKLIST.md`。

产品原则固定为：**少量高频稳定字段 + AI 动态语义抽取**。固定 schema 只承接招聘/学生简历中高频、稳定、跨表单复用价值高的信息；长尾内容进入 `facts` / `extra_sections`，并在填表时与固定字段一起参与语义匹配。只有当某类信息足够常见、语义稳定、且比动态 fact 更利于自动填表和人工修正时，才晋升为固定字段。

## ResumeData v1.6

`ResumeData` 是阶段 A 的输出：用户上传简历后，平台解析得到一份结构化 JSON，存入 `resumes.parsed_data`，后续阶段 B 填表时直接复用。

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---:|---|
| `schema_version` | `str` | `"1.6"` | 简历 schema 版本 |
| `basic_info` | `BasicInfo` | `{}` | 基本身份与联系方式 |
| `job_intent` | `JobIntent | null` | `null` | 求职意向、薪资、到岗时间、期望城市 |
| `education` | `Education[]` | `[]` | 教育经历，按时间倒序 |
| `internship_experience` | `InternshipExperience[]` | `[]` | 实习经历，按时间倒序 |
| `work_experience` | `WorkExperience[]` | `[]` | 正式工作、兼职、合同制等非实习工作经历，按时间倒序 |
| `campus_experience` | `CampusExperience[]` | `[]` | 学生组织、社团、志愿服务、班级职务、校园活动等 |
| `project_experience` | `ProjectExperience[]` | `[]` | 项目经历，按时间倒序 |
| `skills` | `Skills` | `{}` | 编程语言、框架/包、数据库、工具、软技能等 |
| `certifications` | `Certification[]` | `[]` | 证书 |
| `languages` | `Language[]` | `[]` | 语言能力 |
| `self_evaluation` | `str | null` | `null` | 自我评价 / 个人陈述 |
| `facts` | `ResumeFact[]` | `[]` | 固定 schema 外、但未来可能复用的动态事实 |
| `extra_sections` | `ExtraSection[]` | `[]` | 无法归入固定字段、但有明确标题的开放段落 |

### BasicInfo

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `str | null` | 姓名 |
| `gender` | `"男"|"女"|"其他"|null` | 不合法枚举会被归为 `"其他"` |
| `birth_date` | `str | null` | 推荐 `YYYY-MM-DD` |
| `age` | `int | null` | 仅在原文明确出现或可安全推断时填写 |
| `phone` | `str | null` | 规范化为数字；中国大陆手机号异常时会生成 `parse_warnings` |
| `email` | `str | null` | 邮箱原值，禁止脱敏 |
| `location` | `str | null` | 现居地 |
| `hometown` | `str | null` | 籍贯 |
| `marital_status` | `"未婚"|"已婚"|"离异"|"其他"|null` | 不合法枚举会被归为 `"其他"` |
| `political_status` | `str | null` | 政治面貌，如共青团员、中共党员 |
| `ethnicity` | `str | null` | 民族 |
| `id_card` | `str | null` | 敏感字段，不应默认自动填写 |
| `parse_warnings` | `str[]` | 校验器生成的字段风险提醒，供前端展示 |

### JobIntent

| 字段 | 类型 | 说明 |
|---|---|---|
| `target_position` | `str | null` | 目标岗位 |
| `expected_salary` | `str | null` | 期望薪资，保留原文 |
| `available_date` | `str | null` | 到岗时间 / notice period |
| `work_location_preference` | `str[]` | 期望工作城市/地区 |

### Education

| 字段 | 类型 | 说明 |
|---|---|---|
| `school` | `str` | 学校，必填 |
| `degree` | `"大专"|"本科"|"硕士"|"博士"|"其他"|null` | 交换/访问等非标准学历映射为 `"其他"` 或进入 `extra_sections` |
| `major` | `str | null` | 专业 |
| `start_date` | `str | null` | 推荐 `YYYY-MM` |
| `end_date` | `str | null` | 推荐 `YYYY-MM`；原文写“至今”时可保留 |
| `gpa` | `str | null` | GPA 原文，不强行标准化 |
| `ranking` | `AcademicRanking | null` | 学业排名、专业排名、班级排名、年级排名 |
| `honors` | `str[]` | 荣誉/奖项/称号；禁止放 GPA、排名、课程名 |
| `courses` | `str[]` | 主要课程，每门课一个元素 |
| `extra_sections` | `ExtraSection[]` | 教育经历局部的开放段落，如导师、研究方向、毕业论文 |

`AcademicRanking`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `raw` | `str | null` | 原文排名，如 `"6/114"`、`"专业排名 3/80"` |
| `rank` | `int | null` | 名次 |
| `total` | `int | null` | 总人数 |
| `percentile` | `str | null` | 如 `"前10%"`、`"top5%"` |
| `context` | `str | null` | 只允许排名语境，如 `"专业排名"`、`"班级排名"`、`"年级排名"`、`"学院排名"`、`"综合排名"` |

### InternshipExperience

学生简历中明确标注为实习、实习生、Intern、Internship、暑期实习等经历，应进入 `internship_experience`，不再混入 `work_experience`。

`InternshipExperience` 与 `WorkExperience` 字段结构一致：

| 字段 | 类型 | 说明 |
|---|---|---|
| `company` | `str` | 实习所在公司、学校、实验室或机构 |
| `department` | `str | null` | 部门/团队，如原文明确出现则填写 |
| `title` | `str | null` | 实习岗位/身份，如数据分析实习生、实习助理 |
| `start_date` | `str | null` | 推荐 `YYYY-MM` |
| `end_date` | `str | null` | 推荐 `YYYY-MM`；`null` 表示未知或仍在实习 |
| `achievements` | `str[]` | 职责、成果、bullet 要点 |
| `tech_stack` | `str[]` | 仅放语言、包、框架、数据库、中间件、云原生、工程/数据工具 |
| `extra_sections` | `ExtraSection[]` | 实习经历局部开放段落 |

### WorkExperience

`work_experience` 只承接非实习的工作经历，如正式工作、兼职、合同制工作等。明确标注为实习的经历应放入 `internship_experience`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `company` | `str` | 公司、学校、实验室或工作所在机构 |
| `department` | `str | null` | 部门/团队，如原文明确出现则填写 |
| `title` | `str | null` | 职位/角色 |
| `start_date` | `str | null` | 推荐 `YYYY-MM` |
| `end_date` | `str | null` | 推荐 `YYYY-MM`；`null` 表示未知或仍在职 |
| `achievements` | `str[]` | 职责、成果、bullet 要点 |
| `tech_stack` | `str[]` | 仅放语言、包、框架、数据库、中间件、云原生、工程/数据工具 |
| `extra_sections` | `ExtraSection[]` | 工作经历局部开放段落 |

`tech_stack` 的定义要保守：不要把算法、方法名、评价指标、数据集、业务地区、市场名称、验证集、一次性 API/服务名抽成技术栈。若这些内容已经在项目、实习或工作描述句中出现，保留在原句即可。

### CampusExperience

学生简历中高频出现的校园经历应进入 `campus_experience`，不应只放在 `facts`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `organization` | `str` | 学生会、团委、社团、协会、班级、志愿组织、校园活动主体 |
| `department` | `str | null` | 组织内部部门，如办公室、宣传部 |
| `role` | `str | null` | 职务/身份，如副主席、部长、班长、志愿者 |
| `category` | `str | null` | 简短类型，如 `"学生组织"`、`"社团活动"`、`"志愿服务"`、`"班级职务"`、`"校园活动"` |
| `start_date` | `str | null` | 推荐 `YYYY-MM`；可以缺失 |
| `end_date` | `str | null` | 推荐 `YYYY-MM`；可以缺失 |
| `achievements` | `str[]` | 职责、活动成果、组织规模、获奖/表彰 |
| `tags` | `str[]` | 用于表单匹配的短标签，如 `"学生干部"`、`"志愿服务"` |
| `extra_sections` | `ExtraSection[]` | 校园经历局部开放段落 |

### ProjectExperience

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `str` | 项目名称 |
| `role` | `str | null` | 项目角色 |
| `start_date` | `str | null` | 推荐 `YYYY-MM` |
| `end_date` | `str | null` | 推荐 `YYYY-MM` |
| `tech_stack` | `str[]` | 与工作经历中的 `tech_stack` 定义一致 |
| `description` | `str | null` | 仅当原文存在独立“项目简介/概述”时填写 |
| `achievements` | `str[]` | 项目要点、成果、量化结果 |
| `extra_sections` | `ExtraSection[]` | 项目局部开放段落；算法/数据集/指标等关键词块会被过滤 |

### Skills

| 字段 | 类型 | 示例 |
|---|---|---|
| `programming_languages` | `str[]` | Python、SQL、R、Java |
| `frameworks` | `str[]` | Pandas、scikit-learn、TensorFlow、FastAPI、React |
| `databases` | `str[]` | MySQL、PostgreSQL、Redis |
| `middleware` | `str[]` | Kafka、RabbitMQ |
| `cloud_native` | `str[]` | Docker、Kubernetes |
| `tools` | `str[]` | Microsoft Office、Excel、Tableau、Power BI、Figma、Git、Linux |
| `soft_skills` | `str[]` | 仅保留原文明确写出的软技能 |

### Certification 与 Language

`Certification`：

| 字段 | 类型 |
|---|---|
| `name` | `str` |
| `issuer` | `str | null` |
| `date` | `str | null` |

`Language`：

| 字段 | 类型 |
|---|---|
| `language` | `str` |
| `level` | `str | null` |
| `score` | `str | null` |

### ExtraSection

当简历中出现明确标题、独立段落或列表，但无法准确归入固定字段时，使用 `extra_sections`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | `str` | 简短中文标题，通常 2-8 字 |
| `style` | `"pills"|"list"|"text"` | 未知值会回退为 `"list"` |
| `items` | `str[]` | 每个元素是一条独立内容；`text` 样式可用一个长文本元素 |

`ExtraSection` 可以出现在顶层，也可以挂在 `education`、`internship_experience`、`work_experience`、`campus_experience`、`project_experience` 的子项下。

### ResumeFact

`facts` 用于保存固定 schema 未覆盖、但未来招聘表单可能会问到的原子事实，例如：每周可实习天数、最早到岗日期、作品集链接、签证/工作许可线索、是否愿意异地/出差、论文、专利、竞赛事实等。

不要重复保存已经被固定字段完整覆盖的信息，例如姓名、电话、邮箱、学校、专业、GPA、ranking、实习经历、校园经历、项目 bullet。

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `str | null` | 尽量用英文 snake_case；校验器会做规范化 |
| `label` | `str` | 中文短标签 |
| `value` | `str` | 可用于填写表单的答案字符串 |
| `normalized_value` | `str | int | float | bool | str[] | null` | 只有能安全标准化时才填写 |
| `value_type` | `"text"|"number"|"date"|"boolean"|"url"|"list"|"duration"|"money"|"location"|"unknown"` | 默认 `"text"` |
| `scope` | `"profile"|"basic_info"|"job_intent"|"education"|"internship_experience"|"work_experience"|"campus_experience"|"project_experience"|"skills"|"certifications"|"languages"|"other"` | 语义来源范围 |
| `source_path` | `str | null` | JSON 路径或语义位置 |
| `source_text` | `str | null` | 原文证据 |
| `confidence` | `float` | 0-1，默认 0.8 |
| `sensitivity` | `"none"|"low"|"sensitive"` | 敏感事实不应默认自动填写，除非表单明确询问且用户确认 |
| `reuse_likelihood` | `"high"|"medium"|"low"` | 未来表单复用概率 |

## 示例

```json
{
  "schema_version": "1.6",
  "basic_info": {
    "name": "张三",
    "gender": "男",
    "birth_date": null,
    "age": null,
    "phone": "13800138000",
    "email": "zhangsan@example.com",
    "location": "深圳",
    "hometown": null,
    "marital_status": null,
    "political_status": null,
    "ethnicity": null,
    "id_card": null
  },
  "job_intent": {
    "target_position": "数据分析实习生",
    "expected_salary": null,
    "available_date": "2026-06",
    "work_location_preference": ["深圳", "广州"]
  },
  "education": [
    {
      "school": "香港城市大学（东莞）",
      "degree": "硕士",
      "major": "数据科学",
      "start_date": "2025-09",
      "end_date": "2027-06",
      "gpa": "3.8/4.0",
      "ranking": {
        "raw": "6/114",
        "rank": 6,
        "total": 114,
        "percentile": null,
        "context": null
      },
      "honors": ["校级奖学金"],
      "courses": ["机器学习", "数据挖掘"],
      "extra_sections": []
    }
  ],
  "internship_experience": [
    {
      "company": "腾讯",
      "department": "数据平台部",
      "title": "数据分析实习生",
      "start_date": "2026-01",
      "end_date": "2026-04",
      "achievements": ["使用 SQL 与 Python 支持业务看板口径校验"],
      "tech_stack": ["SQL", "Python"],
      "extra_sections": []
    }
  ],
  "work_experience": [],
  "campus_experience": [
    {
      "organization": "数据科学学院学生会",
      "department": "办公室",
      "role": "部长",
      "category": "学生组织",
      "start_date": null,
      "end_date": null,
      "achievements": ["统筹学院活动材料与志愿者协调"],
      "tags": ["学生干部"],
      "extra_sections": []
    }
  ],
  "project_experience": [],
  "skills": {
    "programming_languages": ["Python", "SQL"],
    "frameworks": ["Pandas", "scikit-learn"],
    "databases": [],
    "middleware": [],
    "cloud_native": [],
    "tools": ["Microsoft Office", "Tableau"],
    "soft_skills": []
  },
  "certifications": [],
  "languages": [
    {"language": "英语", "level": "CET-6", "score": "580"}
  ],
  "self_evaluation": null,
  "facts": [
    {
      "key": "weekly_internship_days",
      "label": "每周可实习天数",
      "value": "每周可实习5天",
      "normalized_value": 5,
      "value_type": "number",
      "scope": "job_intent",
      "source_path": null,
      "source_text": "每周可实习5天",
      "confidence": 0.95,
      "sensitivity": "none",
      "reuse_likelihood": "high"
    }
  ],
  "extra_sections": [
    {"title": "兴趣爱好", "style": "pills", "items": ["羽毛球"]}
  ]
}
```

## FillPlan 数据契约

阶段 B 接收插件扫描到的表单字段，并返回以插件原始 `fieldId` 为 key 的填写方案。

### FillPlanRequest

代码定义：`app/schemas/fill_plan.py`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `resumeId` | `str | null` | 可选；为空时使用该用户最新 completed 简历 |
| `url` | `str` | 目标招聘页面 URL |
| `fields` | `FormField[]` | 浏览器插件扫描结果 |
| `user_overrides` | `dict[str,str]` | 用户手动提供的答案，优先级高于简历 |
| `id` | `str | null` | 可选扫描 id |
| `title` | `str | null` | 页面标题 |
| `fieldCount` | `int | null` | 插件上报的字段数 |
| `frames` | `dict[] | null` | iframe 元数据 |

兼容旧别名：`resume_id`、`site_url`、`form_fields`、`scan_id`、`page_title`、`field_count`。

### FormField

| 字段 | 类型 | 说明 |
|---|---|---|
| `fieldId` | `str` | 必填，本次扫描/执行的字段 key；响应也使用同一个 key |
| `label` | `str` | 页面可见 label 或插件推断出的最佳 label |
| `type` | `text|tel|email|number|date|url|select|radio|checkbox|textarea|repeater|file` | 通用字段类型 |
| `options` | `(str|{label,value})[] | null` | 选项字段的候选值 |
| `required` | `bool` | 是否必填 |
| `subFields` | `FormField[] | null` | repeater 子字段 |
| `maxLength` | `int | null` | 最大长度约束 |
| `placeholder` | `str | null` | placeholder |
| `widget` | `str | null` | 更细的控件类型，如 `text-input`、`custom-dropdown`、`date-picker`、`cascader`、`pseudo-radio` |
| `enumerable` | `bool | null` | options 是否已完整枚举 |
| `section` / `sectionPath` | `str | null` / `str[] | null` | 页面模块语义，如教育经历、项目经历 |
| `subLabel` | `str | null` | 复合字段中的子 label |
| `groupId` / `groupSize` / `groupIndex` | `str | null` / `int | null` / `int | null` | 复合字段/分组控件信息 |
| `fieldFingerprint` | `str | null` | 稳定字段指纹，用于缓存和模板学习；缺失时平台自动生成 |
| `frameUrl` / `frameIndex` | `str | null` / `int | null` | iframe 上下文 |
| `htmlType`、`ariaLabel`、`autocomplete`、`name` | `str | null` | DOM 语义辅助信息 |
| `currentValue`、`visible`、`disabled`、`readonly` | mixed | 当前状态辅助信息 |
| `pattern`、`min`、`max`、`order` | `str/int | null` | 校验/顺序提示 |
| `isMultiselect`、`isSearchableSelect`、`optionObjects` | mixed | select 控件增强信息 |

缓存说明：`fieldId` 是本次扫描/执行的 DOM 定位 key，响应必须原样使用；但平台计算表单结构缓存时会忽略临时 `fieldId`、`frameUrl`、`frameIndex`、`currentValue`，避免 `auto_xxx` 每次变化导致缓存失效。长期稳定识别应依赖 `fieldFingerprint` 与字段结构。

### FillPlanResponse

| 字段 | 类型 | 说明 |
|---|---|---|
| `plan_id` | `str` | 填写方案 id |
| `filled` | `dict[fieldId,FilledField]` | 已生成答案，key 为插件原始 `fieldId` |
| `needs_user_input` | `str[]` | 需要用户确认或补充的字段 id |
| `warnings` | `str[]` | 给用户/插件的提醒 |
| `cache_hit` | `bool` | 是否命中缓存 |
| `model_used` | `str | null` | 使用的模型 |
| `cost_cny` | `Decimal | null` | 估算成本 |

`FilledField`：

| 字段 | 类型 |
|---|---|
| `value` | `str | dict[] | null` |
| `confidence` | `float` |
| `reasoning` | `str` |
| `source` | `str` |

### PluginMatchResponse

插件 MVP 可调用 `POST /api/v1/fill-plans/plugin-match`。请求体与 `FillPlanRequest` 相同，响应在标准
`FillPlanResponse` 基础上额外提供当前 Chrome 扩展更容易执行的字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `mappings` | `dict[fieldId,value]` | 从 `filled[fieldId].value` 展平得到；插件可直接按 `fieldId` 填写 |
| `skipped` | `str[]` | `needs_user_input` 以及 value 为空的字段 |
| `sectionActions` | `dict[str,str]` | 兼容旧 mock 协议；当前后端暂返回空对象 |

普通平台调用仍优先使用 `POST /api/v1/fill-plans` 和完整 `filled` 对象；`plugin-match` 是为了衔接现有扩展执行器。

### PluginScanResponse

插件扫描调试可调用 `POST /api/v1/fill-plans/plugin-scan`。请求体同 `FillPlanRequest`，该接口只校验并回执扫描结果，不调用模型、不生成填写方案。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `str` | 扫描 id；若请求未传则由平台生成 |
| `path` | `str | null` | 兼容旧 mock 响应；平台当前不落盘，返回 null |
| `fieldCount` | `int` | 平台实际接收字段数 |
| `warnings` | `str[]` | 字段数不一致、空 label 等校验提醒 |

## 版本历史

| 版本 | 变更 |
|---|---|
| `1.0` | 初始固定简历 schema |
| `1.1` | 增加 `extra_sections`，用于开放标题段落 |
| `1.2` | 增加 `education[].ranking` |
| `1.3` | 增加动态可复用事实层 `facts` |
| `1.4` | 增加 `skills.tools` 与 `work_experience[].department` |
| `1.5` | 增加 `campus_experience[]`，承接学生校园经历 |
| `1.6` | 增加 `internship_experience[]`，将应届生高频实习经历从 `work_experience` 中拆出 |
