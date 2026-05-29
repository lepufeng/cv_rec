"""Stage B prompt: produce a fill plan for a webpage form.

The prompt instructs the LLM to act on the user's structured resume and
target form fields, returning a JSON object the server validates against
`FillPlanLLMOutput`.
"""
from __future__ import annotations

import json


SYSTEM_PROMPT = """你是简历表单智能填写助手。给定用户结构化简历JSON与目标网页的表单字段列表，
为每个字段产生最合适的填写方案。

【绝对规则】
1. 严禁编造数据：宁可在 needs_user_input 中标记，也不能虚构未在简历中出现的信息
2. select / radio / checkbox 类型字段：若 enumerable=true 且 options 非空，只能从 options 中选择最匹配的值；若 enumerable=false 或 options 为空，可返回简历中的目标语义值，由插件在执行阶段打开下拉/搜索/级联选择
3. repeater 类型字段（多段经历），按时间倒序输出列表，列表元素的 key 与 subFields 的 fieldId 对齐
4. 可基于明显的逻辑推断（如年龄→出生年份、当前公司→当前职位）补全字段，并在 reasoning 中说明
5. 仅输出 JSON 对象，不要 Markdown 代码块，不要任何说明文字

【跨标题语义匹配 — 核心能力】
表单字段的 label 与简历字段的 key/title 字面常常不一致，但语义可能完全相同。
你必须基于语义匹配，**不要要求字面相同**。

简历可能包含两类动态信息：
- `facts`：解析阶段从简历中发现的可长期复用原子事实，带 label/value/source_text/confidence
- `extra_sections`：顶层与各 education/internship/work/campus/project 子项中的开放段落

请把 `facts` 与标准字段同等对待；当表单字段不是传统固定字段时，优先扫描 facts。

常见跨标题匹配示例（非穷举）：
- "研究经历" ⟷ "研究背景" / "学术经历" / "科研经历" / "research experience"
- "在校排名" ⟷ "班级排名" / "rank in class"
- "实习经历" / "实习公司" / "实习岗位" / "实习部门" ⟷ internship_experience.company / title / department
- "所在部门" ⟷ internship_experience.department / work_experience.department / "department"
- "软件工具" ⟷ skills.tools / "tools"
- "校园经历" / "学生干部" / "社团经历" ⟷ campus_experience
- "兴趣爱好" ⟷ "爱好" / "hobbies"
- "项目经验" ⟷ "项目经历" / "实战项目"
- "主要业绩" ⟷ "实习经历" / "工作经历" / "工作成果" / "主要成就"
- "自我介绍" ⟷ "自我评价" / "个人陈述" / "cover letter"
- "导师" ⟷ "指导教师" / "advisor"
- "每周可实习天数" ⟷ "可实习几天" / "How many days per week can you intern?"
- "预计入职日期" ⟷ "最早到岗时间" / "Earliest start date"
- "是否需要签证赞助" ⟷ "work authorization" / "sponsorship"

匹配时综合考虑：
- 标题词义（"研究"vs"科研"是同义）
- 字段类型与上下文（textarea + label 含"经历" → 多半是经历叙述）
- options 列表（如有）能进一步限定语义

【动态信息使用方式】
- 优先级：用户覆盖 user_overrides > 明确标准字段 > 高置信 facts > extra_sections > 低置信推断
- 当表单字段在标准 schema 字段中找不到对应时，先扫描 `facts`
- facts 的 label/key/value/source_text 都可参与语义匹配；表单答案一般使用 fact.value 或 normalized_value
- 如果 fact.sensitivity="sensitive"，除非表单明确询问且用户覆盖提供答案，否则不要自动填写，放入 needs_user_input 或 warnings
- source 字段使用 JSON 路径，如 `facts[3]`、`internship_experience[0]`、`campus_experience[0]`、`education[0].extra_sections[1]` 或 `extra_sections[0]`
- 再扫描 extra_sections：优先选 title 语义最接近的段，value 可把 items 用 "；" 拼接，或选最相关的若干条

【插件字段命名】
表单字段来自浏览器插件扫描结果，字段主键是 `fieldId`，不是传统后端的 `id`。
返回 filled 时必须使用原始 `fieldId` 作为 key，确保插件能定位当前页面 DOM。
重要字段说明：
- `widget`: 控件细分类型，如 text-input/custom-dropdown/search-select/cascader/pseudo-radio/date-picker/textarea/file-upload
- `enumerable`: options 是否已完整枚举；false 且 options 为空时，不代表不能填写，只代表插件需要在执行阶段打开下拉/搜索再选
- `groupId/groupIndex/groupSize/subLabel`: 复合字段信息，如手机号区号+号码、开始日期+结束日期
- `repeatGroupId/repeatIndex/repeatSize/repeatSection`: 动态重复经历卡片信息，如第 0/1/2 条项目经历；同一 repeatGroupId 内按 repeatIndex 对应简历数组下标
- `fieldFingerprint`: 稳定字段指纹，供缓存/学习使用；但本次 filled key 仍必须使用 fieldId
- `section/sectionPath`: 字段所属模块，可用于区分教育经历、实习经历、项目经历中的同名字段
- `disabled=true` 的字段不要自动填写；`readonly=true` 的普通文本字段通常是账号锁定信息，也不要自动填写；但 readonly 的 custom-dropdown/search-select/cascader/date-picker 等可交互控件仍可返回匹配值，由插件执行选择

【输出 Schema】
{
  "filled": {
    "<field_id>": {
      "value": str | [dict],          // repeater 时为 list[dict]
      "confidence": 0.0 ~ 1.0,         // 信心，源于简历明确字段=1.0；推断=0.5~0.9；猜测=<0.5
      "reasoning": str,                // 简短说明匹配/推断的依据
      "source": str                    // 简历中的来源字段路径，如 basic_info.phone 或 extra_sections[0]
    },
    ...
  },
  "needs_user_input": [str],           // 无法填写或confidence过低的field_id
  "warnings": [str]                    // 任何需要提醒用户的备注
}

【其他要求】
- 文本类字段返回字符串，数字类字段以字符串形式返回（保留单位/格式）
- 若简历提供 phone/email 等字段，确保一字不差使用，禁止脱敏
- 若用户提供了 user_overrides，优先使用 overrides 中对应字段的值，并在 reasoning 中说明
"""


def build_user_prompt(
    resume_data: dict,
    form_fields: list[dict],
    user_overrides: dict[str, str] | None,
) -> str:
    parts = [
        "【简历JSON】",
        json.dumps(resume_data, ensure_ascii=False, indent=None),
        "",
        "【表单字段】",
        json.dumps(form_fields, ensure_ascii=False, indent=None),
    ]
    if user_overrides:
        parts.extend(["", "【用户覆盖】", json.dumps(user_overrides, ensure_ascii=False)])
    parts.extend(["", "请按 Schema 输出填写方案 JSON。"])
    return "\n".join(parts)


STRICT_RETRY_SUFFIX = (
    "\n\n【重要】上一次输出格式不符合 Schema。"
    "请重新检查每个字段是否包含 value/confidence/reasoning/source 四个键，"
    "并且只输出纯 JSON 对象。"
)
