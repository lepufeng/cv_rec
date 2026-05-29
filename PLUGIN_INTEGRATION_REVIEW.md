# 插件扫描 JSON 对接评审

评审对象：

- `/Users/lepulepu/Desktop/1779803533413_tqhnr4__join.qq.com.json`
- `/Users/lepulepu/Desktop/PROJECT_STATE.md`

结论日期：2026-05-27

---

## 1. 总结结论

队友返回的扫描 JSON **现在可以直接与平台对接**。

平台已将填表请求契约翻转为插件命名风格：`url/fields/fieldId/maxLength` 是主字段名，旧的 `site_url/form_fields/id/max_length` 仅作为兼容别名保留。

### 当前可用结论

队友提供的原始 JSON 已本地验证可直接通过 `FillPlanRequest` Pydantic 校验，字段数为 64。平台会保留 `widget/enumerable/groupId/groupIndex/groupSize/subLabel/frameUrl` 等插件元数据，并自动生成 `fieldFingerprint`。

### 产品级结论

若目标是“稳定自动填写 + 后续自学习”，当前平台还需要继续升级 `FillAction v2` 和反馈/学习链路：

- 支持动态下拉、cascader、date-picker、file-upload 等执行语义
- 解决 `fieldId` 随机导致缓存/模板学习不稳定的问题

---

## 2. QQ 扫描文件概况

| 指标 | 数值 |
|---|---:|
| 页面 | `https://join.qq.com/resumeedit.html?...` |
| 标题 | `简历编辑 | 腾讯校招` |
| 字段数 | 64 |
| frame 数 | 1 |
| 必填字段 | 41 |

字段类型分布：

| type | 数量 |
|---|---:|
| `text` | 28 |
| `select` | 20 |
| `date` | 8 |
| `textarea` | 8 |

widget 分布：

| widget | 数量 |
|---|---:|
| `text-input` | 28 |
| `custom-dropdown` | 15 |
| `date-picker` | 8 |
| `textarea` | 8 |
| `pseudo-radio` | 3 |
| `cascader` | 2 |

---

## 3. 与当前平台接口的兼容性

当前平台契约见 `SCHEMA.md` 与 `app/schemas/fill_plan.py`：

```python
class FillPlanRequest(BaseModel):
    resumeId: str | None = None
    url: str
    fields: list[FormField]
    user_overrides: dict[str, str] = Field(default_factory=dict)
    id: str | None = None
    title: str | None = None
    fieldCount: int | None = None
    frames: list[dict[str, Any]] | None = None

class FormField(BaseModel):
    fieldId: str
    label: str
    type: FieldType = "text"
    options: list[str | FormOption] | None = None
    required: bool = False
    subFields: list["FormField"] | None = None
    maxLength: int | None = None
    placeholder: str | None = None
    widget: str | None = None
    enumerable: bool | None = None
    section: str | None = None
    sectionPath: list[str] | None = None
    subLabel: str | None = None
    groupId: str | None = None
    groupSize: int | None = None
    groupIndex: int | None = None
    fieldFingerprint: str | None = None
    frameUrl: str | None = None
```

插件当前输出：

```json
{
  "url": "...",
  "fieldCount": 64,
  "fields": [
    {
      "fieldId": "auto_wxfdei",
      "label": "姓名",
      "type": "text",
      "widget": "text-input",
      "placeholder": "请输入姓名",
      "required": true,
      "options": [],
      "enumerable": false,
      "section": "",
      "maxLength": 25,
      "frameUrl": "..."
    }
  ]
}
```

### 原样 POST 是否可行？

现在可行。

平台已完成以下对齐：

1. 顶层主字段：`url/fields`
2. 字段主键：`fieldId`
3. 长度约束：`maxLength`
4. 插件元数据：`widget/enumerable/groupId/subLabel/frameUrl` 等会被保留
5. 平台会自动补充稳定字段指纹：`fieldFingerprint`

### 兼容旧调用

旧平台字段 `site_url/form_fields/id/max_length/resume_id` 仍可被解析，但新的文档和插件对接统一使用插件命名。

---

## 4. 插件输出的优点

队友这版扫描结果有几个非常有价值的设计，建议平台 v2 保留：

| 字段 | 价值 |
|---|---|
| `widget` | 比 `type` 更细，可区分 `custom-dropdown`、`pseudo-radio`、`date-picker`、`cascader` |
| `enumerable` | 标识 options 是否已完整枚举；对动态下拉非常关键 |
| `groupId/groupIndex/groupSize` | 处理手机号、起止时间、教育/项目/奖项等复合字段 |
| `subLabel` | 同一 label 下的子字段消歧，如“手机号码”的区号与号码 |
| `maxLength/min/max/pattern` | 可用于模型生成值时做长度/格式约束 |
| `frameUrl` | 支持 iframe 场景排查和插件回填定位 |
| `widget` 结构识别 | 不依赖 placeholder 文案，方向正确 |

这些字段已经覆盖了我们之前在 `PRODUCT_FLOW_PRD.md` 里设想的很大一部分 `FormFields v2`。

---

## 5. 当前仍不满足完整需求的点

### 5.1 section 大量为空

本次 64 个字段的 `section` 全部为空。

影响：

- “学历/学校名称/起止时间/描述”等字段在不同模块重复出现时，模型容易混淆。
- 教育经历、实习经历、项目经历、奖项经历等 repeater/group 的语义边界不够清楚。

建议插件继续增强 section 提取：

- 识别页面中的卡片标题、步骤标题、模块标题
- 提取字段附近最近的 heading/tab/card title
- 对 group/repeater 增加 `sectionPath`，如 `["教育经历", "第1段"]`

### 5.2 fieldId 不稳定

说明文件写到：没有 DOM id/name 时使用 `auto_<6字符随机>`。

影响：

- 当前平台的 `form_structure_hash` 会包含 `id`，随机 ID 会导致同一页面每次扫描都无法命中缓存。
- 未来自学习模板也不能依赖随机 fieldId。

建议：

- `fieldId` 保留给插件当前 session 执行 DOM 映射。
- 另增稳定字段 `fieldFingerprint`，由 `label + type + widget + section + group + placeholder + options + order` 生成。
- 平台缓存与模板学习使用 `fieldFingerprint`，不使用随机 `fieldId`。

### 5.3 动态下拉 options 不完整

本次 `custom-dropdown/cascader/date-picker` 大多 `enumerable=false` 且 `options=[]`。

影响：

- 当前后端 prompt 规则要求 select/radio/checkbox 只能从 options 中选。
- 如果 options 为空，模型理论上应该返回 `needs_user_input`，但实际很多字段如“国家/地区、学历、期望城市、每周可出勤天数”是可以根据简历给出目标值的。

建议平台 v2 区分：

- `options_known=true`：平台必须从 options 里选。
- `options_known=false`：平台返回目标语义值，插件打开下拉后动态搜索/选择。

### 5.4 复合字段需要更强的结构语义

当前 group 信息有价值，但还不够表达“这是教育经历第 1 段”“这是项目经历第 1 段”。

建议增加：

```json
{
  "groupId": "g_5",
  "groupRole": "project_experience",
  "groupIndex": 0,
  "fieldRoleHint": "project_name"
}
```

或者让平台用模型/规则根据 `label/subLabel/placeholder/order` 推断 group role。

### 5.5 file upload 已有 MVP 实现

平台已提供 `GET /api/v1/resumes/{id}/file`，插件在后端返回 `upload_file` action 时读取当前用户已保存的原始简历文件，并写入招聘页的 file input。

边界：

- 只上传当前登录用户自己的原始简历文件。
- 插件不会读取本地路径，也不会点击最终提交。
- 隐藏 file input 可被赋值；复杂第三方上传组件仍需在真实站点逐项验收。

后续增强：

1. 增加上传成功后的站点 UI 状态识别。
2. 对必须点击上传区域才能触发校验的组件做站点适配。

### 5.6 填写反馈尚未对接

说明文件目前主要完成扫描与 mock 上传；反馈协议还没有接到平台。

影响：

- 不能沉淀自学习数据。
- 不能知道哪些字段填成功、失败、被用户修改。

建议后端新增：

```http
POST /api/v1/fill-plans/{plan_id}/feedback
```

用于接收字段级执行结果。

---

## 6. 平台侧需要做的最小改造

### P0：让当前 JSON 真正对接平台

| 改造 | 说明 |
|---|---|
| 支持插件扫描结果直接作为请求 | 已完成，直接接收 `url/fields/fieldId/maxLength` |
| 保留插件元数据 | 已完成，保留 `widget/enumerable/groupId/subLabel/frameUrl` |
| Prompt 加入 widget/enumerable 规则 | 已完成：`enumerable=false` / options 为空时允许返回目标语义值 |
| 插件兼容响应 | 已完成：`POST /api/v1/fill-plans/plugin-match` 额外返回 `mappings/actions/skipped/sectionActions/sectionActionDetails` |
| 插件扫描校验入口 | 已完成：`POST /api/v1/fill-plans/plugin-scan` 校验扫描 JSON，不调用模型 |
| 返回动作类型 | 已完成基础动作：`set_text/select_option/set_date/check/needs_user_input`；repeater 由结构化 `sectionActionDetails` + 旧 `sectionActions` 兼容表达，`upload_file` 继续安全跳过 |
| 缓存 hash 改用稳定 fingerprint | 已完成：结构 hash 忽略随机 `fieldId`，缓存命中后按 `fieldFingerprint` 重映射到本次扫描的 `fieldId` |

### P1：满足自动填写和学习闭环

| 改造 | 说明 |
|---|---|
| 新增 `FillFeedback` 接口 | 接收插件执行结果 |
| 新增 observation 表 | 保存页面字段结构 |
| 新增 template/mapping 表 | 沉淀平台级模板 |
| 接入推理模型做模板晋升判断 | 让高频稳定字段变成固定映射 |
| 管理员模板审核页面 | 查看/批准/禁用模板映射 |

---

## 7. 插件侧建议补充给平台的字段

当前 JSON 已经很好，但为了和平台长期目标完全对齐，建议队友后续补充：

| 字段 | 原因 |
|---|---|
| `fieldFingerprint` | 稳定缓存与模板学习 |
| `order` | 字段顺序辅助模型理解 repeater |
| `sectionPath` | 区分教育/实习/项目/奖项等模块 |
| `currentValue` | 已用于执行器跳过已有非占位值，避免覆盖用户已有输入 |
| `disabled/readonly/visible` | `disabled/readonly` 已用于跳过不可操作字段；`visible` 当前由扫描/执行阶段可见性判断处理 |
| `ariaLabel/name/htmlType/autocomplete` | 增强字段语义判断 |
| `optionObjects` | 已对 select/radio/checkbox 返回 `{label,value}`，同时保留 `options` 文本兼容旧链路 |
| `frameIndex` | 多 iframe 回填定位 |
| `groupRoleHint` | 可选，插件若能判断“教育/项目/工作”则回传 |

---

## 8. 能否满足你的需求

### 当前“基本填表计划”需求

可以满足，当前已经不需要 adapter：

```text
插件扫描 JSON -> 平台 FillPlanRequest -> 模型返回 filled value -> 插件按 fieldId 填写
```

历史风险是：动态下拉、重复经历、日期、复合字段会有较多低置信或填写失败。
当前已补强动态经历新增、日期/日期范围、富文本、自定义/异步下拉、只读字段、iframe 上下文、open Shadow DOM 控件、复合手机号字段以及缓存命中后的随机 `fieldId` 重映射；真实生产页仍需逐站点验收。

### “真实自动填写”需求

部分满足。

插件侧已经考虑了 React/Vue value tracker、iframe、open Shadow DOM、伪 radio、自定义控件，这是正确方向。平台侧还需要返回更明确的 action，不应只返回 value。

### “越用越强/模板学习”需求

当前还不满足，但插件 JSON 已经提供了基础。核心缺口是：

- 稳定 `fieldFingerprint`
- 平台 observation/feedback 存储
- 模板晋升逻辑
- 用户修改反馈
- 公共模板与个人记忆分离

---

## 9. 建议下一步

1. 平台输出 `FillAction v2`，明确每个字段的执行动作。
2. 插件补充稳定 `fieldFingerprint` 与 `sectionPath`；平台当前会自动生成 fingerprint，但插件生成会更贴近 DOM。
3. 双方用这份 QQ JSON 做第一份端到端测试样例。
4. 后续新增 feedback/self-learning，不要一开始就把学习系统做重。
