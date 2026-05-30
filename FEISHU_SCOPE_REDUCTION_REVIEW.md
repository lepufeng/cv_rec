# Feishu Recruiting Scope Reduction Review

> 结论日期：2026-05-30  
> 新产品范围：当前平台只面向小鹏招聘以及其他飞书招聘系公司表单，不再承诺覆盖所有招聘网站或所有 ATS。

---

## 1. 新定位

本项目从“通用招聘网站自动填写”收缩为“飞书招聘平台优先的简历自动填写工具”。

支持范围：

- 小鹏招聘：`xiaopeng.jobs.feishu.cn` 及可能的 `xpeng` 相关招聘域名。
- 其他飞书招聘系站点：以飞书招聘/Formily/UD 组件为主要 DOM 特征，例如 `data-form-field-i18n-name`、`ud-formily-item`、`applyFormModuleWrapper`、`throne-biz-date-range-picker`、`ud__select`。
- 已知 Feishu-like 公司站点可作为候选，但上线前需要真实页面验收。

不再作为当前 MVP 目标：

- 腾讯校招 `join.qq.com`。
- Moka、北森、Element UI、TDesign 等非飞书招聘底座。
- “新 ATS 零适配”的泛化卖点。
- 面向未知招聘网站的自动扫描与自动填写承诺。

---

## 2. 当前架构

### 2.1 后端 FastAPI

入口：`app/main.py`

核心链路：

1. `app/api/v1/auth.py`：用户注册、登录、token。
2. `app/api/v1/resumes.py`：简历上传与解析。
3. `app/services/resume_service.py`：文件去重、存储、解析状态。
4. `app/services/parsing_service.py`：OCR/视觉/对话模型解析为 `ResumeData`。
5. `app/api/v1/fill_plans.py`：插件扫描结果进入填表方案接口。
6. `app/services/fill_service.py`：结构化简历 + 表单字段匹配，输出 `fieldId -> value/action`。
7. `app/prompts/fill_form.py`：字段语义匹配提示词。

后端基本不需要因为“只支持飞书招聘”而大删。原因是后端处理的是简历结构、字段匹配、缓存、用户与模型配置，这些能力仍然是飞书招聘链路必需的。

### 2.2 Web 前端

入口：`web/src/App.tsx`

核心页面：

- 用户登录/注册：`web/src/pages/UserAuth.tsx`
- 简历上传：`web/src/pages/Upload.tsx`
- 简历预览与修正：`web/src/pages/Profile.tsx`
- 插件连接：`web/src/pages/PluginConnect.tsx`
- 管理后台：`web/src/pages/admin/*`

前端不直接适配 ATS。保留即可。可以把页面文案从“任意招聘网站”改为“小鹏及飞书招聘站点”。

### 2.3 Chrome 插件

入口：

- `With_Le/chrome-extension/content/content.js`
- `With_Le/chrome-extension/content/field-scanner.js`
- `With_Le/chrome-extension/content/fill-engine.js`
- `With_Le/chrome-extension/content/section-manager.js`
- `With_Le/chrome-extension/content/handlers/*.js`

飞书招聘核心能力集中在：

- `field-scanner.js`
  - `data-form-field-i18n-name` 标签提取。
  - `formily-item`/`ud-formily-item` 表单项识别。
  - `applyFormModuleWrapper` 模块标题与空模块识别。
  - `throne-biz-date-range-picker` 日期范围识别。
  - `ud__select`、`aria-haspopup=listbox` 等飞书选择器识别。
- `section-manager.js`
  - 飞书空经历模块的“添加”按钮定位。
  - `applyFormModuleWrapper` 重复模块计数与扩展。
- `date-handler.js`
  - 飞书 month range picker 年份跳转。
  - 小鹏专用 post-fill 日期点击校验。
- `select-handler.js`
  - 飞书搜索选择器、学校/城市等动态下拉。
- `fill-engine.js`
  - 日期 start/end 分组填写。
  - 重复经历字段按 `repeatSection/repeatIndex` 填写。

---

## 3. 保留清单

### 必须保留

| 模块 | 文件 | 原因 |
|---|---|---|
| 用户/简历/模型配置 | `app/api/`, `app/services/`, `app/models/`, `app/repositories/` | 产品主链路，不依赖 ATS 范围 |
| 简历 schema | `app/schemas/resume.py`, `SCHEMA.md` | 飞书表单仍需要教育、实习、项目、技能、语言等字段 |
| 字段匹配 | `app/services/fill_service.py`, `app/prompts/fill_form.py` | 模型判断复杂字段仍是产品差异点 |
| 插件主循环 | `content/content.js` | 扫描、扩展、匹配、填写、报告 |
| 飞书扫描 | `content/field-scanner.js` 中 Formily/UD/Feishu 相关逻辑 | 小鹏和飞书招聘核心 |
| 动态经历扩展 | `content/section-manager.js` 中 `applyFormModuleWrapper` 相关逻辑 | 飞书经历模块常见结构 |
| 日期范围 | `content/handlers/date-handler.js` | 小鹏/飞书日期范围是核心痛点 |
| 选择器填写 | `content/handlers/select-handler.js` | 学校、学历、城市、语言等字段依赖 |
| 文本/富文本/上传 | `text-handler.js`, `upload-handler.js` | 描述、附件、简历上传仍需 |
| 最终提交保护 | `navigation-detector.js` | 必须避免误点最终提交 |
| 小鹏真实扫描 fixture | `tests/fixtures/plugin_scans/1779866110428_zhdbld__xiaopeng.jobs.feishu.cn.json` | 当前最有价值的回归样本 |

### 建议保留但可简化

| 模块 | 保留原因 | 可简化方向 |
|---|---|---|
| 通用 label 推断 | 飞书页面也可能缺 label 或嵌套很深 | 保留 Formily/UD 优先路径，降低未知 DOM fallback 权重 |
| 通用 select/radio/checkbox | 飞书招聘仍有伪单选、多选、搜索下拉 | 删除非飞书框架注释和测试即可，不急着删执行能力 |
| `facts` 动态事实 | 飞书表单也会出现长尾问题 | 不删，避免后端匹配质量下降 |
| 管理后台 | 调模型、成本、用户管理仍有价值 | 可降级成内部工具，不影响交付 |

---

## 4. 可删除/可归档内容

### 4.1 高优先级：文档与样例

这些内容不会影响运行，适合第一批清理。

| 位置 | 建议 | 原因 |
|---|---|---|
| `README.md` 中“任意招聘网站”“新 ATS 零适配” | 已改/应改为飞书招聘范围 | 避免产品定位误导 |
| `ARCHITECTURE.md` 中“新 ATS 零适配” | 已改/应改为飞书范围 | 避免后续开发继续泛化 |
| `ATS_FIELD_REVIEW.md` | 已删除 | 主流 ATS 调研不再是当前目标 |
| `PLUGIN_INTEGRATION_REVIEW.md` | 已删除 | 内容主要围绕非目标站点 |
| `E2E_SELF_CHECKLIST.md` | 已删除 | 当前只验收小鹏/飞书招聘链路 |
| `PRODUCT_FLOW_PRD.md` | 已删除 | 全 ATS 模板库路线图不再驱动当前 MVP |
| `HANDOFF.md`、`.kiro/specs/*`、`With_Le/docs/*` | 已删除 | 这些文档记录旧阶段和泛 ATS 目标，容易误导当前开发 |
| `cost_experiment.py` | 已删除 | 独立成本实验不是当前交付链路 |

### 4.2 高优先级：历史扫描数据

可以保留小鹏和其他明确飞书招聘样本，删除非目标站点样本。

| 位置 | 建议 |
|---|---|
| `With_Le/chrome-extension/mock-server/*` | 已删除；插件当前直连 FastAPI `/fill-plans/plugin-*` |
| `tests/fixtures/plugin_scans/*xiaopeng.jobs.feishu.cn.json` | 保留，用于小鹏/飞书扫描 fixture |
| 桌面/外部 Tencent scan 引用文档 | 已从主仓库移除 |

### 4.3 中优先级：本地测试页

| 位置 | 建议 | 原因 |
|---|---|---|
| `With_Le/chrome-extension/test-form.html` | 改成 Feishu-only test form | 当前混合 Moka/Feishu/Beisen，容易让测试目标发散 |
| `With_Le/chrome-extension/TESTING.md` | 改成 Feishu/Xiaopeng 本地验收说明 | 文档仍写 Moka/Feishu/Beisen |
| `With_Le/chrome-extension/tests/test-form.test.js` | 删除 Moka/Beisen 断言 | 跟随 test form 收缩 |

### 4.4 中优先级：插件测试

以下测试可删除、归档或改写为飞书等价测试。

| 测试 | 建议 |
|---|---|
| `scanner handles Tencent-style Element UI resume form labels and add buttons` | 删除 |
| `section manager handles live Tencent-style send_title resume modules` | 删除 |
| Moka/Beisen empty-section toggle 测试 | 删除或改为 Feishu empty module 测试 |
| `local ATS smoke fills dynamic projects...` | 改名为 Feishu/Xiaopeng smoke |
| `local test form covers Moka, Feishu and Beisen ATS markers` | 改成只覆盖 Feishu/Xiaopeng |
| `fill engine does not run Xiaopeng-only date validation clicks on other hosts` | 可保留，作为小鹏特殊逻辑不外溢的保护 |

### 4.5 中优先级：插件扫描器中的非飞书选择器

这些是明确的非飞书兼容分支。删除前要先把测试页/测试断言收缩，否则测试会失败。

| 文件 | 可删内容 |
|---|---|
| `field-scanner.js` | `_LABEL_DATA_ATTRS` 中 `data-moka-label`, `data-moka-field`, `data-beisen-label`, `data-beisen-field` |
| `field-scanner.js` | `_TITLE_SELECTOR` 中 `moka-title`, `beisen-title` |
| `field-scanner.js` | `_formItem`/container 相关选择器里的 `moka-form-item`, `moka-field`, `beisen-form-item`, `beisen-field` |
| `field-scanner.js` | 注释和测试中 Tencent/Element UI 专项解释 |
| `section-manager.js` | `_SECTION_TITLE_SELECTOR` 中 `moka-title`, `beisen-title` |
| `section-manager.js` | `_REPEAT_ITEM_SELECTOR` 中 `[class*="moka"]`, `[class*="beisen"]` |
| `section-manager.js` | `_actionContainer` 中 `[class*="moka"]`, `[class*="beisen"]` |
| `content.js` | 注释中的 “Moka, Feishu and Beisen” 改为 Feishu/Xiaopeng |

### 4.6 谨慎删除：通用控件处理能力

这些看起来泛化，但飞书也可能用到，不建议第一轮删除。

| 能力 | 不建议立刻删的原因 |
|---|---|
| `aria-haspopup=listbox/tree` | 飞书搜索下拉/级联可能依赖 |
| `role=combobox/textbox/searchbox` | 飞书或候选站点可能用 ARIA |
| `contenteditable` 富文本 | 项目/实习描述可能是富文本编辑器 |
| `shadow DOM` 扫描 | 当前飞书未必用，但删除收益小 |
| `ant-*` 选择器 | 有些飞书候选站点可能混用 Ant Design 或相似类名；先通过真实样本确认 |
| `facts` 长尾匹配 | 缩小 ATS 范围不等于字段语义变简单 |
| `currentValue`/安全跳过逻辑 | 防止覆盖用户已填内容，必须保留 |

---

## 5. 建议裁剪顺序

### 第 0 步：定位收缩

已完成/建议完成：

- README 和架构文档改成“小鹏及飞书招聘系站点”。
- 新增本文作为删减依据。
- 插件 UI 文案可改成“打开小鹏或飞书招聘页面后点击自动填写”。

### 第 1 步：测试目标收缩

先让测试只描述新目标，再动实现：

1. 把 `test-form.html` 改成 Feishu-only。
2. 删除 Tencent/Moka/Beisen smoke 测试。
3. 保留小鹏真实 fixture 测试和 Feishu Formily/UD 组件测试。
4. 新增至少两个“其他飞书招聘公司”样本测试，例如 jobs.bytedance.com 若确认为同底座。

### 第 2 步：扫描器瘦身

在测试已收缩后删除非飞书 selector：

1. 删除 `data-moka-*` / `data-beisen-*`。
2. 删除 Moka/Beisen repeat item 识别。
3. 删除 Tencent/Element UI 专项场景。
4. 保留 Formily/UD/date-range/search-select。

### 第 3 步：运行时门控

可选但建议做：

- 在插件开始扫描/填写前识别站点。
- 默认允许：
  - `*.jobs.feishu.cn`
  - `jobs.bytedance.com`，如果确认是飞书招聘底座
  - 配置中的飞书招聘 allowlist
- 不支持站点显示明确提示：“当前版本仅支持小鹏及飞书招聘系页面。”

注意：不要只用 hostname 判断所有飞书站点，因为部分公司可能使用自定义域名。更稳的方式是 `host allowlist + DOM 特征探测`。

### 第 4 步：文档归档

本轮已删除以下过期文档，避免继续把项目导向全 ATS 泛化：

- `ATS_FIELD_REVIEW.md`
- `PLUGIN_INTEGRATION_REVIEW.md`
- `E2E_SELF_CHECKLIST.md`
- `PRODUCT_FLOW_PRD.md`
- `HANDOFF.md`
- `.kiro/specs/*`
- `With_Le/docs/*`
- `With_Le/chrome-extension/mock-server/*`
- `cost_experiment.py`
- `examples/form_fields_cross_label.json`

---

## 6. 不建议删除的内容

| 内容 | 原因 |
|---|---|
| 后端用户/认证/上传/解析/模型配置 | 与目标站点无关，是产品基础 |
| `ResumeData` 大部分字段 | 飞书表单仍然会问教育、实习、项目、技能、语言等 |
| `FillService` 的模型语义判断 | 这是“比纯规则插件更强”的核心差异 |
| 填写日志/诊断报告 | 当前问题定位高度依赖日志 |
| 日期范围完整校验 | 小鹏核心问题，不可删 |
| 动态模块添加 | 飞书招聘经历模块常见，必须保留 |
| 最终提交保护 | 安全边界，不可删 |

---

## 7. 推荐交付口径

对外/答辩时建议这样描述：

> 当前版本聚焦飞书招聘生态，已在小鹏招聘等飞书招聘页面完成真实填表验证。系统并不追求短期覆盖所有 ATS，而是先把一个高价值招聘底座做深：包括动态经历模块、日期范围、搜索选择器、重复字段映射、填写后校验与诊断报告。后续如果扩展到其他 ATS，会以独立适配层和测试样本逐步加入，而不是让当前 MVP 背负全站泛化复杂度。
