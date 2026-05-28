# 项目状态文档（Resume Auto-fill Chrome 扩展）

最近更新：2026-05-27

本文档面向两类读者：
1. **下游 LLM**（消费扫描 JSON、决策填充）：第 2-4 节是字段语义契约
2. **下次接手开发的会话**：第 5-9 节是工程状态、已修问题、调试入口

---

## 1. 项目目标

Chrome 扩展，分两阶段：

- **阶段 A（已完成主体）**：扫描招聘网站简历表单，把所有输入字段以结构化 JSON 上传到本地 mock 后端
- **阶段 B（骨架已就位，未跑通）**：从后端拿到「字段 → 简历值」映射后，自动填回页面

已验证目标站点：腾讯校招（join.qq.com）、小鹏招聘（xiaopeng.jobs.feishu.cn / 飞书招聘后台）。后续可能会添加阿里、字节等。

---

## 2. JSON 数据结构（下游 LLM 唯一参考）

每次扫描生成一个 JSON 文件，保存在 `mock-server/scans/<时间戳>__<host>.json`。

### 2.1 顶层结构

```json
{
  "id": "1779870020013_0qce1m",
  "savedAt": "2026-05-27T08:45:31.829Z",
  "url": "https://xiaopeng.jobs.feishu.cn/...",
  "title": "投递简历 - 加入小鹏汽车",
  "scannedAt": "2026-05-27T08:45:31.825Z",
  "fieldCount": 17,
  "frames": [
    { "frameIndex": 0, "url": "...", "title": "...", "fieldCount": 17 }
  ],
  "fields": [ /* 字段对象列表 */ ]
}
```

`frames[]` 中可能出现 `about:blank` 且 `fieldCount: 0` 的条目，是站点埋点 / 广告 iframe，可以忽略。

### 2.2 字段对象属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fieldId` | string | ✅ | 唯一标识，源自 `id`/`name`/`data-field`/`data-name`，否则 `auto_xxx` |
| `label` | string | ✅ | 字段显示名，LLM 主要据此匹配简历字段 |
| `type` | string | ✅ | 扁平类型：`text`/`textarea`/`select`/`radio`/`checkbox`/`date`/`file` |
| `widget` | string | ✅ | 精细子类型，**优先使用**，比 `type` 更准确（见 2.3） |
| `placeholder` | string | ✅ | 输入框提示（可能空字符串） |
| `options` | string[] | ✅ | 可选值列表（可能空数组） |
| `enumerable` | boolean | ✅ | `options` 是否已穷举完整（见 2.4） |
| `required` | boolean | ✅ | 是否必填 |
| `section` | string | ✅ | 所属表单分区（可能空字符串） |
| `subLabel` | string | 否 | 仅 group 成员，从 placeholder 派生的消歧标签 |
| `groupId` | string | 否 | 仅 group 成员，标识复合字段 |
| `groupSize` | number | 否 | 仅 group 成员，group 内控件总数 |
| `groupIndex` | number | 否 | 仅 group 成员，0-based 位置 |
| `maxLength` | number | 否 | 来自 `maxlength` |
| `min` / `max` | string | 否 | 来自 `min` / `max` |
| `pattern` | string | 否 | 来自 `pattern`（正则） |
| `frameUrl` | string | ✅ | 字段所在 frame 的 URL |

### 2.3 widget 类型完整定义

| widget | type 派生 | 含义 | enumerable | 典型例子 |
|---|---|---|---|---|
| `text-input` | text | 普通文本框 | false | 姓名、邮箱、电话 |
| `textarea` | textarea | 多行文本 | false | 自我评价、项目描述 |
| `contenteditable` | text | 富文本编辑区 | false | 在线编辑器 |
| `native-select` | select | 原生 `<select>` | true | 老式表单的下拉 |
| `aria-combobox` | select | ARIA 标注的下拉（无搜索） | false | 学历、政治面貌 |
| `custom-dropdown` | select | 自定义下拉（点击弹层） | false | 各种纯弹层下拉 |
| `search-select` | select | 搜索式下拉（输入即过滤） | false | 城市、学校、专业 |
| `cascader` | select | 级联选择 | false | 省市区 |
| `pseudo-radio` | select | 按钮组型单选 | true | 性别、是否、有无 |
| `radio-group` | radio | 原生单选 | true | 传统 radio |
| `checkbox-group` | checkbox | 原生复选框 | true | 多选标签、布尔开关 |
| `date-picker` | date | 日期/时间选择 | false | 入职、起止日期 |
| `file-upload` | file | 文件上传 | false | 证件照、附件 |

**widget 识别按以下优先级**（在 `_detectWidget` 中实现）：

1. 伪选项组（多个 `*-wrapper` / `*-item` 类型节点）→ `pseudo-radio`
2. 原生 `<select>` / `<textarea>` / `[contenteditable]`
3. ARIA：`role=combobox/listbox` 或 `aria-haspopup`
   - 同时有 `aria-autocomplete=list/both` → `search-select`
   - 否则 → `aria-combobox`
4. HTML5 `<input type="date/month/week/datetime-local/time">` → `date-picker`
5. 邻近有日历图标 / 容器 class 含 `date-picker/calendar` → `date-picker`
6. 容器 class 含 `cascader/cascade/tree-select` → `cascader`
7. 邻近有下拉箭头 + readonly 或非 search hint → `custom-dropdown`
8. 邻近有箭头 + search hint → `search-select`
9. readonly + search hint → `search-select`
10. readonly 无箭头 → `custom-dropdown`
11. **祖先 8 层内有 class token 匹配 `^*[-_]select$`**（如 `ud__select` / `ant-select`）→ `search-select`
12. label 含日期关键词（时间/日期/年月/出生/入学/毕业/...）但不含负向关键词（时长/天数/...）→ `date-picker`
13. 默认 → `text-input`

### 2.4 enumerable 字段含义

- **`true`**：`options` 包含该字段所有可选值，LLM 可直接从中选
- **`false`**：`options` 为空或不完整，LLM 应在填写阶段交互式枚举

**enumerable=true 的 widget**：`native-select`、`radio-group`、`checkbox-group`、`pseudo-radio`

### 2.5 group 元数据含义

`groupId` 表示复合字段。同一 form-item 容器内 ≥2 个控件会被分到同一 group：

| 复合字段 | groupSize | 结构 |
|---|---|---|
| 手机号码 | 2 | [0] 区号选择器 + [1] 号码输入 |
| 个人证件 | 2 | [0] 证件类型选择器 + [1] 证件号 |
| 起止时间 | 2 | [0] 开始日期 + [1] 结束日期 |

特点：
- 所有成员共享同一个 `label`（primary label，从第一个有 label 的成员传播）
- `subLabel` 用于区分成员
- `widget` 可能不同（例：`custom-dropdown` + `text-input`）

容器超过 5 个控件不传播（避免错误合并整张卡片）。

### 2.6 单选 checkbox（布尔开关）

当 `widget=checkbox-group` 且 `options` 长度=1 时，是布尔开关：

```json
{ "label": "没有工作经历", "widget": "checkbox-group",
  "options": ["没有工作经历"], "enumerable": true }
```

**LLM 处理**：简历对应数据为空 → 勾选；有数据 → 不勾。

---

## 3. LLM 决策指南

### 3.1 主路径：label 语义匹配

```
简历: { name, gender, phone, email, education[], work_experience[], ... }
```

| label 模式 | 简历字段 |
|---|---|
| 姓名 / name | `name` |
| 性别 / gender | `gender` |
| 手机号码 / phone | `phone` |
| 邮箱 / email | `email` |
| 学校名称 / 学校 | `education[].school` |
| 学历 / degree | `education[].degree` |
| 专业 / major | `education[].major` |
| 起止时间（group） | `start_date` + `end_date` |
| 公司名称 | `work_experience[].company` |
| 职位名称 | `work_experience[].title` |
| 描述 | `work_experience[].description` |

### 3.2 按 widget 选填写策略

| widget | 策略 |
|---|---|
| `text-input` / `textarea` | 直接写入 |
| `search-select` | 打开下拉 → 输入关键词 → 等过滤结果 → 点击匹配项 |
| `custom-dropdown` / `aria-combobox` | 打开下拉 → 列表中找匹配项 → 点击 |
| `cascader` | 多级展开 → 逐级选择 |
| `pseudo-radio` / `radio-group` | 点击对应按钮 |
| `checkbox-group`（单选） | 按布尔决定勾或不勾 |
| `checkbox-group`（多选） | 对每个匹配项点击勾选 |
| `date-picker` | 打开日历 → 选年月日 |
| `file-upload` | 当前不实现 |

### 3.3 enumerable=true 时归一化值

简历"硕士研究生" + options `["本科", "硕士", "博士"]` → 选 `"硕士"`。

### 3.4 label 为空的 fallback

按顺序尝试：`placeholder` → `section` → group 内其他成员的 label。

---

## 4. 已知限制

1. **动态字段**：点击"添加"按钮才出现的字段，扫描阶段看不到。已支持可选预展开（popup 复选框「扫描前自动点击添加按钮」）；填写阶段也可主动展开。
2. **纯 div 自定义控件**：无 input、无 ARIA role、未点开时 DOM 无内容的下拉，扫描器看不见（典型：腾讯「个人证件类型」前置选择器）。需在填写阶段交互探测。
3. **label 为空**：多列布局第二个 input、被黑名单过滤、站点未提供语义标签。
4. **options 为空**：自定义/搜索下拉的可选值动态生成，扫描时拿不到（这是 `enumerable=false` 的预期行为）。

---

## 5. 文件树

```
f:\With_Le\
├── chrome-extension\
│   ├── manifest.json                 MV3，content_scripts 设 all_frames=true
│   ├── test-form.html
│   ├── test-resume.json
│   ├── shared\
│   │   ├── message-types.js          MSG 常量
│   │   └── dom-utils.js              isVisible/isVisibleStrict/setNativeValue
│   ├── content\
│   │   ├── content.js                入口，暴露 window.__resumeAutofillStart
│   │   ├── field-scanner.js          ★ 字段扫描器（核心）
│   │   ├── fill-engine.js            填写引擎
│   │   ├── section-manager.js        多条目展开
│   │   ├── navigation-detector.js    下一步/提交按钮
│   │   ├── result-annotator.js       结果浮窗
│   │   └── handlers\                 text/select/date/choice/upload
│   ├── popup\
│   │   ├── popup.html                按钮 + 「扫描前自动点击添加按钮」复选框
│   │   ├── popup.css
│   │   └── popup.js                  注入 + 触发 / 扫描 / 上传
│   ├── service-worker\
│   │   └── service-worker.js         消息转发到 mock 后端
│   └── mock-server\
│       ├── server.js                 端口 3000，无依赖
│       └── scans\                    扫描结果 JSON 落盘目录
├── dist\resume-autofill\             已打包发行版（含 README）
└── docs\
    └── PROJECT_STATE.md              本文件
```

---

## 6. 关键模块速查

### `content/field-scanner.js`（最重要，最近改动最频繁）

核心算法：**全局有序分割**
1. 收集所有 control（真实表单元素 + ARIA 控件 + 伪选项组），按文档顺序排
2. 一次 DOM 遍历构建 `[ctrl, text, ...]` 序列，control 内部文字被剔除
3. 第 N 个 control 的 label = 它和第 N-1 个 control 之间区间内、最靠近它的合格文本
4. label 候选必须不在黑名单祖先中（按钮/链接/选项/已选值/帮助文字等）
5. group 后处理：同 form-item 容器多控件合并，传播 label，加 group 元数据
6. label 等于 placeholder 时视为"placeholder 渗漏"，被 primary label 覆盖
7. group 内 label 改变时重判 widget（用 label 语义二次确认 date-picker）

关键常量：
- `_PSEUDO_ITEM_SELECTOR`：伪选项组识别（覆盖 ant/element/feishu UD/腾讯 TDesign）
- `_LABEL_BLACKLIST_ANCESTOR`：label 候选的禁止祖先类名
- `_TITLE_SELECTOR`：section 探测
- `_DATE_LABEL_REGEX` / `_DATE_LABEL_NEGATIVE`：日期语义识别
- `_SELECT_BLOCK_REGEX = /^(?:[a-z0-9]+[-_]+)*select$/i`：select 包装器识别（飞书 `ud__select`、Ant `ant-select`）
- `_ITEM_GROUP_SELECTORS`：form-item 容器（含 `formily-item`）

### `popup/popup.js`

三个按钮 + 一个开关：
- **一键填充**：注入 + 调用 `__resumeAutofillStart(resumeId)`
- **扫描页面字段并上传**：注入 → 在每个 frame 跑 `FieldScanner.scan()` → 主线程合并 → 通过 service worker `POST /api/page-fields`
- **扫描前自动点击添加按钮**（默认关）：扫描前自动点击空模块的「添加」按钮，让动态字段也被扫到。状态持久化到 `chrome.storage.local.expandOnScan`
- **调试：强制填入测试值**：跳过后端，把所有 text/textarea 写入 `测试_xxx`

### `mock-server/server.js`

端口 3000，纯 Node `http`：
- `GET /api/resume/:id` → `test-resume.json`
- `POST /api/match-fields` → 关键字 mock 匹配
- `POST /api/page-fields` → 保存 JSON 到 `scans/`，返回 `{id, path, fieldCount}`
- `GET /api/page-fields/list` / `GET /api/page-fields/<file>`

---

## 7. 已修问题清单（按时间顺序，便于不再走回头路）

1. **`Could not establish connection`**：iframe 没注入 → manifest 加 `all_frames: true`，popup 改用 `chrome.scripting.executeScript({ allFrames: true })`
2. **能连上但写不进去**：React value tracker → `DOMUtils.setNativeValue` 用 prototype native setter
3. **`Failed to fetch`**：service worker 抓 fetch 异常 + 中文错误提示
4. **label 全是「男」「是」「中国大陆」**：弃用 class 名匹配，改全局有序分割
5. **同卡片字段共享 label**（"教育经历"刷遍）：按 control 序列分段
6. **label 写成「建议填写常用 QQ 邮箱」**：黑名单加 hint/tip/help/extra/notice/...
7. **性别字段没扫到**：腾讯纯按钮组，加 `_collectPseudoGroups`
8. **复合字段第二个 input label 空**：`_propagateGroupLabels` 后处理 + groupId
9. **placeholder 文案不可靠（阿里"请输入"实际是搜索下拉）**：引入 `widget` 字段，用结构特征识别（ARIA / 图标 / readonly / select 包装器），完全不看 placeholder 文案
10. **小鹏起止时间识别成 text**：加日历图标变体 + `_DATE_HINT_CLASS` + label 语义兜底
11. **小鹏起止时间第二个 input label 空**：在 `_propagateGroupLabels` 中传播 label 时重判 widget
12. **第二个起止时间 label 变成「选择日期」**：placeholder 渗漏检测，label === placeholder 时被 primary 覆盖
13. **意向城市识别成 text**：去掉 ARIA wrapper "已含 input 就丢弃"的过度防御；同时新增 `aria-autocomplete=list` → `search-select`
14. **小鹏推荐方式（飞书 UD radio）扫不到**：
    - `_PSEUDO_ITEM_SELECTOR` 加 BEM 双下划线变体（`ud__radio__wrapper`）
    - `_collectPseudoGroups` 给 radio/checkbox 例外，不视为「已含原生控件」
    - `DOMUtils.isVisible` 给 radio/checkbox 例外（可被 opacity:0 隐藏，仍保留）
15. **飞书 group 错合并卡片**（姓名+邮箱 / 推荐方式+内推码+意向城市）：`_ITEM_GROUP_SELECTORS` 加 `formily-item`
16. **飞书工作经历卡片字段 label 空**：`applyFormModuleWrapper-placeholder` 误命中 `[class*="placeholder"]` 黑名单，收紧到 `__placeholder` / `-placeholder-` / `input__placeholder`
17. **「没有工作经历」单选 checkbox 没扫到**：
    - `DOMUtils.isVisible` 对 radio/checkbox input 仅检查 `display:none`
    - `_extractOptions` 对无 name 属性的 radio/checkbox 退到 wrapper label 文本
    - `_resolveLabel` 对 radio/checkbox 在 `el.labels` 空时退到 `closest('label')`
18. **学校名称识别成 text**（飞书 `<div class="ud__select">` 包裹的 input）：新增 `_hasSelectWrapper` 向上 8 层查 BEM 块名 `*-select`/`*_select` → `search-select`

---

## 8. 当前已知问题 / 下次接手优先

按重要程度排：

- **fill-engine 没在真实站点验证过**：扫描+上传通了，但填写主路径没跑通。后端 `match-fields` 是关键字简单匹配，`fieldId` 全是 `auto_xxx`，匹配率低。要让填写跑起来需要替换为基于 `label` 语义的真后端（接 LLM）。
- **section 字段大量为空**：`_TITLE_SELECTOR` 在腾讯/飞书命中率不高。
- **upload-handler 是空实现**：file 字段全部跳过。
- **纯 div 自定义控件**：扫描阶段无能为力，等填写阶段交互探测。

---

## 9. 复现 / 调试

```cmd
# 启动后端
cd f:\With_Le\chrome-extension\mock-server
node server.js
# 期望: Mock backend running at http://localhost:3000/api

# 加载扩展
chrome://extensions → 开发者模式 → 加载已解压 → 选 chrome-extension 目录
改代码后必须点扩展卡片刷新按钮（manifest 改了也要刷）

# 测试扫描
打开目标招聘页 → 扩展图标 → 点「扫描页面字段并上传」
查看 mock-server/scans/<新文件>.json

# 看 service worker 日志
chrome://extensions → 扩展卡片 → Service Worker 链接

# 看 content script 日志
目标页 F12 → Console → 切到正确的 frame
```

---

## 10. 给下次会话的建议

1. **先读 2、3、5 节即可上手**。其他章节用到再翻。
2. **新出错时最有效的反馈方式**：让用户右键 → 检查那个具体 input → 复制外层 4-5 层 outerHTML（含 class），对着真实结构改 `field-scanner.js` 的选择器或黑名单。
3. **不要往 `field-scanner.js` 里塞站点专属规则**。设计原则是"通用 + 黑名单"，每条规则要能解释为什么是黑名单（值显示 / 帮助文字 / 按钮 / 结构装饰）。
4. **改了文件不需要再同步到 `dist/`**，那是已经打包发出去的版本。
5. **优先级**：扫描准确率 > 后端真实匹配 > 填写。当前阶段 A 主体已完成，下一步该接 LLM 后端。
6. **JSON 字段名是契约，不要改**。新增字段必须可选，并在 §2.2 表格里加一行。
