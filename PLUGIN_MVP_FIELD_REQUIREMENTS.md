# 浏览器插件字段扫描上报要求（MVP）

> 面向插件开发同学。  
> 当前目标：先跑通“插件扫描招聘表单 → 平台生成填写方案 → 插件执行填写”的 MVP。  
> 自学习、跨用户模板沉淀、长期字段记忆可以后续逐步上线，因此本文只列解析和填写当下真正需要的数据。

结论日期：2026-05-27

---

## 1. 插件与平台分工

插件负责：

- 在招聘网页中扫描真实表单字段。
- 给每个字段生成本次执行用的 `fieldId`。
- 提取字段语义信息，如 `label`、`type`、`widget`、`options`、`sectionPath`。
- 保存 `fieldId -> DOM element` 的本地映射。
- 收到平台返回的 `filled[fieldId]` 后，在网页上执行文本填写、选项选择、日期选择等动作。

平台负责：

- 保存用户已解析好的简历 JSON。
- 根据插件上报的字段列表，调用模型理解字段语义。
- 从简历标准字段、`facts`、`extra_sections` 中找到答案。
- 返回以插件原始 `fieldId` 为 key 的填写方案。

---

## 2. 顶层 JSON

插件向平台发送的请求建议使用以下结构：

```json
{
  "url": "https://xiaopeng.jobs.feishu.cn/index/resume/apply",
  "title": "投递简历 - 加入小鹏汽车",
  "fieldCount": 39,
  "frames": [],
  "fields": [],
  "thinkingMode": "disabled"
}
```

| 字段 | 必须性 | 说明 |
|---|---:|---|
| `url` | 必须 | 当前招聘页面 URL，用于识别来源、日志定位、缓存区分 |
| `fields` | 必须 | 字段数组，核心数据 |
| `title` | 建议必传 | 页面标题，可辅助模型判断公司/系统/投递场景 |
| `fieldCount` | 建议传 | 便于校验扫描完整性 |
| `frames` | iframe 场景建议传 | iframe 元数据，便于调试和执行定位 |
| `thinkingMode` | 可选 | `enabled` / `disabled`。复杂表单可开启增强推理；不传则使用平台默认策略 |

---

## 3. 单个字段必须上报的数据

每个 `fields[]` 元素建议包含：

```json
{
  "fieldId": "auto_3q8u9n",
  "label": "姓名",
  "type": "text",
  "widget": "text-input",
  "required": true,
  "sectionPath": ["基本信息"],
  "visible": true,
  "disabled": false,
  "readonly": false,
  "currentValue": ""
}
```

| 字段 | 必须性 | 用途 |
|---|---:|---|
| `fieldId` | 必须 | 本次扫描里的字段 ID。平台返回 `filled` 时会原样使用它，插件用它找到 DOM 并执行填写 |
| `label` | 必须 | 字段语义，如“姓名”“邮箱”“学历”“起止时间”。如果页面没有显式 label，请尽量用附近文字、placeholder、aria/name/autocomplete 推断 |
| `type` | 必须 | 通用字段类型，如 `text`、`select`、`date`、`textarea`、`radio`、`checkbox`、`file` |
| `widget` | 必须 | 具体控件类型，如 `text-input`、`date-picker`、`search-select`、`pseudo-radio`、`custom-dropdown`、`textarea` |
| `required` | 建议必传 | 是否必填。平台可优先处理必填项，低置信字段也会优先提醒用户 |
| `sectionPath` | 经历/重复模块必须 | 字段所在模块路径，如 `["教育经历", "第1段"]`、`["项目经历"]`、`["基本信息"]`。用于区分同名字段 |
| `visible` | 建议必传 | 是否当前可见。隐藏字段通常不应直接填写 |
| `disabled` | 建议必传 | 是否禁用。禁用字段不应生成可执行填写动作 |
| `readonly` | 建议必传 | 是否只读。只读字段可见但不可编辑 |
| `currentValue` | 建议必传 | 当前已有值。用于避免覆盖用户手填内容，也便于后续判断是否填写成功 |

说明：`fieldId` 不要求跨扫描稳定，但必须在本次扫描和本次执行期间稳定。也就是说，插件本地需要保存 `fieldId -> DOM element` 映射。

---

## 4. 选择题字段

如果字段是 `select` / `radio` / `checkbox`，请额外上报：

```json
{
  "fieldId": "auto_f9lnem",
  "label": "推荐方式",
  "type": "select",
  "widget": "pseudo-radio",
  "required": false,
  "options": ["无", "内推"],
  "enumerable": true,
  "sectionPath": ["投递信息"],
  "visible": true,
  "disabled": false,
  "readonly": false
}
```

| 字段 | 必须性 | 用途 |
|---|---:|---|
| `options` | 选择题必须 | 页面可选项。能枚举时尽量完整上报 |
| `enumerable` | 选择题必须 | `true` 表示 `options` 已完整；`false` 表示动态下拉/搜索下拉，当前无法完整枚举 |
| `isSearchableSelect` | 搜索型下拉建议传 | 告诉平台和执行器该字段需要搜索后选择 |
| `isMultiselect` | 多选字段必须 | 告诉平台返回单值还是多值 |

如果能拿到真实提交值，建议用对象形式：

```json
{
  "options": [
    {"label": "本科", "value": "bachelor"},
    {"label": "硕士", "value": "master"}
  ]
}
```

如果暂时只能拿到字符串，也可以先传：

```json
{
  "options": ["本科", "硕士"]
}
```

---

## 5. 复合字段与分组字段

如果多个输入框共同表达一个语义，例如“开始日期 + 结束日期”“手机号区号 + 手机号”“学校名称 + 学历 + 专业”，请上报 group 信息。

```json
[
  {
    "fieldId": "auto_start",
    "label": "起止时间",
    "type": "date",
    "widget": "date-picker",
    "groupId": "g_education_time_0",
    "groupIndex": 0,
    "groupSize": 2,
    "sectionPath": ["教育经历", "第1段"]
  },
  {
    "fieldId": "auto_end",
    "label": "起止时间",
    "type": "date",
    "widget": "date-picker",
    "groupId": "g_education_time_0",
    "groupIndex": 1,
    "groupSize": 2,
    "sectionPath": ["教育经历", "第1段"]
  }
]
```

| 字段 | 必须性 | 用途 |
|---|---:|---|
| `groupId` | 复合字段必须 | 标记一组字段属于同一个复合输入 |
| `groupIndex` | 复合字段必须 | 当前字段在组内的顺序 |
| `groupSize` | 复合字段必须 | 当前组一共有几个字段 |
| `subLabel` | 有就必传 | 子字段语义，如“区号”“手机号”“YYYY” |
| `sectionPath` | 复合字段强烈建议 | 标记这组字段属于教育、实习、项目还是奖项 |

---

## 6. iframe 场景

如果字段在 iframe 内，请上报：

| 字段 | 必须性 | 用途 |
|---|---:|---|
| `frameUrl` | iframe 场景必须 | 字段所在 iframe 的 URL |
| `frameIndex` | iframe 场景建议传 | 字段所在 iframe 的序号 |

插件执行时仍以本地 `fieldId -> DOM element` 映射为准；`frameUrl/frameIndex` 主要用于排查和复现。

---

## 7. 当前可以暂不强制的数据

这些字段对未来质量、自学习、缓存会有帮助，但不阻塞当前 MVP：

| 字段 | 当前处理方式 |
|---|---|
| `fieldFingerprint` | 先不强制。平台现在会自动生成，并且结构缓存已忽略临时 `auto_xxx fieldId` |
| `optionObjects` | 后续增强。MVP 可以先用字符串 `options` |
| `htmlType` / `ariaLabel` / `name` / `autocomplete` | 后续增强。对空 label 字段有帮助，但不是当前第一优先级 |
| `pattern` / `min` / `max` / `maxLength` | 后续增强。可用于控制格式和长度 |

注意：`fieldFingerprint` 未来会很重要。它是“长期识别同一个字段”的稳定指纹，用于缓存和自学习。但现在为了先跑通填写流程，可以由平台临时自动生成。

---

## 8. 平台返回格式

平台会返回：

```json
{
  "plan_id": "xxx",
  "filled": {
    "auto_3q8u9n": {
      "value": "张三",
      "confidence": 1.0,
      "reasoning": "匹配简历 basic_info.name",
      "source": "basic_info.name"
    }
  },
  "needs_user_input": [],
  "warnings": [],
  "cache_hit": false
}
```

插件需要注意：

- `filled` 的 key 一定是插件上报的原始 `fieldId`。
- 插件执行时按 `fieldId` 找到 DOM，并根据 `widget/type` 选择执行方式。
- `needs_user_input` 里的字段不应自动填写，需要用户确认或补充。
- `warnings` 可以展示给用户或写入调试日志。

---

## 9. MVP 自检清单

插件侧在交付扫描 JSON 前，可以先检查：

- [ ] 顶层有 `url`
- [ ] 顶层有 `fields`
- [ ] 每个字段都有唯一 `fieldId`
- [ ] 每个字段都有尽量准确的 `label`
- [ ] 每个字段都有 `type`
- [ ] 每个字段都有 `widget`
- [ ] select/radio/checkbox 有 `options` 和 `enumerable`
- [ ] 搜索型下拉 `enumerable=false`
- [ ] 复合字段有 `groupId/groupIndex/groupSize`
- [ ] 重复经历字段有 `sectionPath`
- [ ] 字段状态有 `visible/disabled/readonly/currentValue`
- [ ] iframe 字段有 `frameUrl`

---

## 10. 最小可用示例

```json
{
  "url": "https://xiaopeng.jobs.feishu.cn/index/resume/apply",
  "title": "投递简历 - 加入小鹏汽车",
  "fields": [
    {
      "fieldId": "auto_3q8u9n",
      "label": "姓名",
      "type": "text",
      "widget": "text-input",
      "required": true,
      "sectionPath": ["基本信息"],
      "visible": true,
      "disabled": false,
      "readonly": false,
      "currentValue": ""
    },
    {
      "fieldId": "auto_f9lnem",
      "label": "推荐方式",
      "type": "select",
      "widget": "pseudo-radio",
      "required": false,
      "options": ["无", "内推"],
      "enumerable": true,
      "sectionPath": ["投递信息"],
      "visible": true,
      "disabled": false,
      "readonly": false,
      "currentValue": ""
    },
    {
      "fieldId": "auto_city",
      "label": "意向城市",
      "type": "select",
      "widget": "search-select",
      "required": false,
      "options": [],
      "enumerable": false,
      "isSearchableSelect": true,
      "sectionPath": ["投递信息"],
      "visible": true,
      "disabled": false,
      "readonly": false,
      "currentValue": ""
    }
  ]
}
```

一句话总结：

**当前 MVP 最重要的是：每个字段有 `fieldId + label + type + widget + sectionPath + 状态信息`；选择题补 `options/enumerable`；复合字段补 `groupId/groupIndex/groupSize`。`fieldFingerprint` 可暂缓，由平台先自动生成。**
