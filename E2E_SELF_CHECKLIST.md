# 端到端架构自查 Checklist

> 目的：判断当前“简历解析平台 + 浏览器插件 + 招聘网页自动填写”是否真正跑通。  
> 结论先行：当前“不含真实 DOM 填写”的产品闭环已可跑通：用户注册/登录、上传解析、网页复制插件配置、插件扫描招聘页、后端生成方案预览。完整自动填写闭环仍未完成，后续主要缺真实 fill-engine 验证、填写反馈与自学习链路。

---

## 0. 当前可跑通程度

| 链路 | 当前状态 | 说明 |
|---|---:|---|
| 用户登录/上传简历/解析入库 | 基本跑通 | 已有测试与本地实际解析记录 |
| 后端接收插件扫描 JSON | 已跑通 | 队友 QQ JSON 可直接通过 `FillPlanRequest` 校验 |
| 插件连接 Web 账户 | 已跑通 | Web `/plugin` 提供 API、token、简历 ID；插件弹窗可保存配置并打开主页 |
| 插件扫描并生成方案预览 | 已跑通 | 插件调用 `/plugin-scan` / `/plugin-match`，展示 mappings/skipped/warnings |
| 后端生成填表方案 | 已跑通 | 当前返回 `filled[fieldId].value` 与插件友好的 `mappings`，尚非动作级计划 |
| 插件根据平台结果真实填写网页 | 未完全跑通 | 队友说明中 fill-engine 尚未在 join.qq.com 完整验证 |
| 动态下拉/日期/级联选择 | 未完全跑通 | 需要动作协议与插件执行策略配合 |
| 文件上传简历 | 未跑通 | 插件 `upload-handler` 仍是占位，平台也缺文件下载接口 |
| 填写反馈/自学习 | 未跑通 | 还没有 feedback API、observation 表、模板学习 |

---

## 0.1 文档同步规则

- [x] 当前文档入口：`DOCS.md`
- [x] 当前 schema 文档：`SCHEMA.md`
- [x] `README.md` 已指向当前有效文档，并标明历史文档边界
- [ ] 每次修改 `ResumeData` 时同步更新 `SCHEMA.md`
- [ ] 每次修改插件字段或填表返回结构时同步更新 `SCHEMA.md` 与 `PLUGIN_INTEGRATION_REVIEW.md`
- [ ] 每次修改数据流或产品边界时同步更新 `PRODUCT_FLOW_PRD.md`
- [ ] 每次修改架构模块/API 行为时同步更新 `ARCHITECTURE.md`
- [x] 每次新增/调整自检脚本时同步更新本文件

---

## 1. 后端启动与基础连通

- [ ] 后端启动成功：`uvicorn app.main:app --host 127.0.0.1 --port 8000`
- [ ] 健康检查成功：`GET /api/v1/health -> {"status":"ok"}`
- [ ] 日志正常写入：`data/logs/app.log`
- [ ] 数据库可读写：`data/dev.db`
- [ ] 当前模型配置可用：管理员端模型测试返回成功
- [ ] 普通用户和管理员可同时登录

自动自检脚本：

```bash
.venv/bin/python scripts/backend_smoke_check.py
```

如需检查管理员登录、用户/管理员同时在线、模型配置与模型连通性，提供管理员凭据：

```bash
CVR_SMOKE_ADMIN_USERNAME=admin \
CVR_SMOKE_ADMIN_PASSWORD='your-password' \
.venv/bin/python scripts/backend_smoke_check.py --test-model
```

说明：

- 脚本会注册一个临时普通用户，用于验证数据库写入、登录和 `/users/me`。
- 没有管理员凭据时，管理员与模型相关检查会标记为 `SKIP`，不会改数据库里的管理员账号。
- `--test-model` 会调用真实模型测试接口，可能消耗少量模型额度。

检查命令：

```bash
curl -s http://127.0.0.1:8000/api/v1/health
tail -f data/logs/app.log
```

---

## 2. 简历解析链路

- [x] 用户可上传 PDF/DOCX/PNG/JPG
- [x] 后端能保存原始文件
- [x] 后端能写入 `resumes` 记录
- [x] PDF 预处理能生成图片与文本 hint
- [x] 视觉模型返回 JSON
- [x] Pydantic schema 校验通过
- [x] `resumes.parsed_data` 有结构化 JSON
- [x] `parse_status=completed`
- [x] 成本记录写入 `cost_logs`
- [x] 成功后 `parse_error` 为空

最近验证：

```text
2026-05-27 真实上传 /Users/lepulepu/Desktop/张馨方简历-.pdf
resume_id=f8be8010-631c-4102-b1cc-93d5e6f91224
模型=glm-4.6v
结果=13 PASS
```

自动自检脚本：

```bash
.venv/bin/python scripts/resume_parse_chain_check.py
```

默认会审计本地数据库最近一条 `completed` 简历，不会调用模型。  
如需真实上传并调用模型，传入一份简历文件：

```bash
.venv/bin/python scripts/resume_parse_chain_check.py \
  --upload-file "/path/to/resume.pdf"
```

脚本会注册一个临时普通用户并上传该文件，因此会新增一条测试简历记录，也会消耗一次真实解析模型调用。

关键日志事件：

```text
resume_upload_received
resume_file_saved
resume_preprocess_done
parse_model_request_started
model_response_parsed
parse_schema_validated
resume_parse_completed
resume_cost_logged
```

---

## 3. 简历数据质量

- [x] `basic_info.name` 正确
- [x] 电话/邮箱未脱敏且准确
- [x] 教育经历按时间倒序
- [x] `ranking` 能识别如 `6/114`
- [x] 明确标注为实习的经历进入 `internship_experience`
- [x] 非实习工作经历进入 `work_experience`
- [x] 项目经历完整
- [x] 技术栈没有误抽市场、地区、数据集等噪声
- [x] `skills.tools` 能保存明确列出的工具，如 Microsoft Office、Tableau
- [x] `internship_experience.department` / `work_experience.department` 能保存明确列出的部门/团队
- [x] `campus_experience` 能保存学生会、社团、志愿服务、班级职务等校园经历
- [x] `facts` 包含可复用动态事实，如到岗时间、每周实习天数
- [x] `extra_sections` 保留 schema 未覆盖但有标题的信息，如兴趣爱好

自动自检脚本：

```bash
.venv/bin/python scripts/resume_data_quality_check.py --resume-id <resume_id>
```

最近验证：

```text
2026-05-27 复查 resume_id=f8be8010-631c-4102-b1cc-93d5e6f91224
schema_version=1.4（升级至 1.6 后需重新解析以生成 internship_experience / campus_experience）
结果=16 PASS, 1 WARN
```

---

## 4. 插件扫描 JSON 接入

- [x] 平台接收 `url`
- [x] 平台接收 `fields`
- [x] 平台提供 `/api/v1/fill-plans/plugin-scan` 校验插件扫描 JSON
- [x] 平台接收 `fieldId`
- [x] 平台接收 `maxLength`
- [x] 平台保留 `widget`
- [x] 平台保留 `enumerable`
- [x] 平台保留 `groupId/groupIndex/groupSize`
- [x] 平台保留 `subLabel`
- [x] 平台保留 `frameUrl`
- [x] 平台自动生成 `fieldFingerprint`
- [x] 结构 hash 忽略临时 `auto_xxx` / `fieldId`，使用字段结构与 `fieldFingerprint` 参与缓存
- [ ] 插件提供稳定 `fieldFingerprint`
- [ ] 插件提供 `sectionPath`
- [ ] 插件提供 `currentValue/visible/disabled/readonly`
- [ ] 插件提供 select 的 `{label,value}` 形式选项

已验证样例：

```text
/Users/lepulepu/Desktop/1779803533413_tqhnr4__join.qq.com.json
字段数：64

tests/fixtures/plugin_scans/1779866110428_zhdbld__xiaopeng.jobs.feishu.cn.json
来源：小鹏飞书招聘系统
字段数：39
字段类型：text=20, date=7, select=6, textarea=6
控件类型：text-input=20, date-picker=7, textarea=6, aria-combobox=4, pseudo-radio=1, search-select=1
已验证：缺省生成 fieldFingerprint；修改全部 auto_xxx fieldId 后结构 hash 不变；真实 options 变化后结构 hash 改变
```

自动化覆盖：

```bash
.venv/bin/python -m pytest tests/unit/test_plugin_scan_fixture.py -q
node --test With_Le/chrome-extension/tests/*.test.js
```

---

## 5. 填表方案生成

- [x] 插件原始 JSON 可直接 POST 到 `/api/v1/fill-plans`
- [x] 插件可调用 `/api/v1/fill-plans/plugin-match` 获取执行器友好的 `mappings`
- [x] 后端能找到用户最新 completed 简历
- [x] 后端能把完整 `fields` 和 `parsed_data` 传给模型
- [x] 模型返回 JSON
- [x] 返回 key 使用原始 `fieldId`
- [x] `filled` 包含 value/confidence/source/reasoning
- [x] 无法确定字段进入 `needs_user_input`
- [x] 动态下拉 `enumerable=false` 时不强制要求 options 内选择
- [x] `groupId` 复合字段能正确拆分，如手机号区号/号码
- [x] 日期字段能返回标准日期值
- [x] 缓存命中后可按 `fieldFingerprint` 重映射刷新后的随机 `fieldId`

当前缺口：

- [ ] 返回还不是动作级 `FillAction v2`
- [ ] 对 `custom-dropdown/cascader/date-picker` 的执行意图不够明确
- [ ] 对 repeater/group 的返回结构还需加强

---

## 6. 插件真实填写执行

插件侧自查：

- [x] 插件保存 `fieldId -> DOM element` 映射
- [x] text/textarea 可写入 React/Vue 受控组件
- [x] pseudo-radio 可选择
- [x] native select 可选择
- [x] custom-dropdown 可打开并搜索/选择
- [x] cascader 可逐级选择
- [x] date-picker 可选择日期
- [x] checkbox/radio 可点击
- [x] repeater 可新增多段经历
- [ ] file upload 可上传简历文件
- [x] iframe 页面可定位并执行
- [ ] Shadow DOM 场景有处理方案
- [x] 失败字段能给出具体原因

当前根据队友说明：

- [x] 扫描链路基本 OK
- [x] React/Vue value tracker 已考虑
- [x] iframe 注入已考虑
- [ ] join.qq.com 上真实 fill-engine 尚未完整验证
- [ ] upload-handler 仍未实现

---

## 7. 填写结果反馈

- [ ] 平台提供 `POST /api/v1/fill-plans/{plan_id}/feedback`
- [ ] 插件回传每个字段执行状态
- [ ] 插件回传用户是否修改
- [ ] 插件回传最终值与失败原因
- [ ] 平台保存 feedback
- [ ] 平台能区分公共模板学习与个人记忆

建议反馈结构：

```json
{
  "plan_id": "uuid",
  "results": [
    {
      "fieldId": "auto_name",
      "action": "set_text",
      "planned_value": "张三",
      "final_value": "张三",
      "status": "filled",
      "user_modified": false,
      "error": null
    }
  ],
  "submitted": false
}
```

---

## 8. 自学习闭环

- [ ] 保存每次扫描到的 form observation
- [ ] 保存字段级 mapping observation
- [ ] 保存用户确认/修改反馈
- [ ] 生成稳定 form_structure_hash
- [ ] 生成稳定 fieldFingerprint
- [ ] 聚合同公司/同平台/同字段指纹
- [ ] 达到阈值后由推理模型判断是否晋升模板
- [ ] 管理员可审核/禁用模板
- [ ] 模板命中时跳过或减少模型调用
- [ ] 未知字段仍交给推理模型

当前状态：未实现。

---

## 9. 安全与隐私

- [ ] 日志不写 API key
- [ ] 日志不写完整简历正文
- [ ] 日志不写完整模型 response
- [ ] 敏感字段进入 facts 时带 sensitivity
- [ ] 用户之间数据隔离
- [ ] 插件 token 存储安全
- [ ] 原始简历文件下载需要鉴权
- [ ] 未来公共模板不沉淀用户个人答案

当前状态：

- [x] 解析 trace 已避免写完整正文和 key
- [x] 用户数据按 user_id 隔离
- [ ] DB 敏感字段尚未加密
- [ ] 插件专用 token/refresh 策略未设计

---

## 10. 端到端验收用例

### Case 1：最小预览闭环（当前目标，不含真实填写）

- [x] 用户注册/登录后进入简历解析平台
- [x] 用户上传简历并解析成功
- [x] Web `/plugin` 提供后端 API、登录 token、简历 ID
- [x] 插件弹窗可打开主页并保存 API/token/简历 ID
- [x] 插件扫描表单字段
- [x] 插件 POST 扫描 JSON 到平台校验
- [x] 插件 POST 字段与简历 ID 到平台生成方案
- [x] 平台返回 `mappings/skipped/warnings`
- [x] 插件展示方案预览
- [ ] 插件成功填写文本字段（下一阶段，不属于当前“不含真实填写”的验收）

### Case 2：腾讯 join.qq.com

- [ ] 插件扫描 QQ 简历编辑页 60+ 字段
- [ ] 平台接收原始扫描 JSON
- [ ] 平台生成填表方案
- [ ] 姓名/邮箱/手机号填写成功
- [ ] 性别 pseudo-radio 选择成功
- [ ] 学历/城市 custom-dropdown 可处理
- [ ] 起止时间 date-picker 可处理
- [ ] 教育/实习/项目 group 能对应正确经历
- [ ] 无法确定字段进入用户确认

### Case 3：反馈学习

- [ ] 插件回传字段填写成功/失败
- [ ] 用户修改某个答案后回传
- [ ] 平台记录 observation
- [ ] 第二次同表单命中缓存或模板

---

## 11. 当前最小下一步

真实填写阶段按优先级：

1. 实现 `FillAction v2` 响应，明确动作类型。
2. 用 QQ JSON 真实请求 `/fill-plans`，检查模型返回质量。
3. 插件按 `fieldId` 执行文本字段填写，先跑姓名/邮箱/手机。
4. 处理 `custom-dropdown/date-picker/group`。
5. 新增 feedback API。
6. 再开始自学习模板。
