"""
简历AI填写产品 - 双阶段成本压测
模拟真实场景的token消耗，估算不同模型/不同负载下的成本
"""
import tiktoken

enc = tiktoken.get_encoding("cl100k_base")

def count(text):
    return len(enc.encode(text))

# ========== 样本1：典型中文简历内容（约2页）==========
SAMPLE_RESUME_TEXT = """
张三 | 男 | 28岁 | 硕士 | 5年经验
电话：13800138000 | 邮箱：zhangsan@example.com
现居：上海市浦东新区 | 籍贯：江苏南京
求职意向：高级后端工程师 | 期望薪资：30-40K | 到岗时间：1个月

教育经历
2018.09 - 2021.06  上海交通大学  计算机科学与技术  硕士  GPA: 3.8/4.0
- 研究方向：分布式系统、机器学习
- 主修课程：高级算法、分布式计算、操作系统

2014.09 - 2018.06  武汉大学  软件工程  本科  GPA: 3.6/4.0
- 学生会技术部部长
- 校级三好学生（2016, 2017）

工作经历
2021.07 - 至今  字节跳动  后端开发工程师 → 高级后端开发工程师
- 负责抖音电商核心交易链路设计与开发，QPS峰值10w+
- 主导订单系统重构，将平均响应时间从200ms优化至50ms
- 设计并落地分布式事务方案，保障跨服务数据一致性
- 团队带头，指导2名初级工程师

2019.07 - 2021.06  腾讯（实习）  后端开发实习生
- 参与微信支付风控系统开发
- 优化Redis缓存命中率，从75%提升至92%

项目经历
分布式订单系统  2022.03 - 2022.12  技术负责人
- 技术栈：Go, Kafka, MySQL, Redis, Kubernetes
- 日处理订单 500w+，节假日峰值 2000w+
- 成果：双11零故障，订单处理延迟P99从1.5s降至300ms

实时推荐系统  2021.09 - 2022.02
- 技术栈：Python, Flink, Redis, FAISS
- 实时计算用户特征，CTR提升 18%

技能
- 编程语言：Go（精通）, Python（熟练）, Java（熟悉）
- 后端框架：Gin, gRPC, Spring Boot
- 数据库：MySQL, PostgreSQL, MongoDB, Redis, Elasticsearch
- 中间件：Kafka, RabbitMQ, Nacos
- 云原生：Docker, Kubernetes, Istio

证书 / 语言
- AWS Certified Solutions Architect (2022)
- 英语六级 580分 / 可流利日常工作沟通
- PMP认证 (2023)

自我评价
5年互联网后端开发经验，对分布式系统有深入理解。具备从0到1的项目落地能力，熟悉敏捷开发流程，
有团队带领经验。对技术保持热情，关注开源社区，曾向 Apache Flink 贡献过 PR。
"""

RESUME_PARSE_PROMPT = """
你是简历结构化抽取助手。请将简历内容解析为标准化JSON，要求：
1. 完整保留原始信息，不要压缩或概括
2. 时间统一为 YYYY-MM 格式
3. 数字字段（薪资、绩点等）保留原值
4. 缺失字段用 null，不要编造

输出schema:
{
  "basic_info": {name, gender, birth_date, age, phone, email, location, hometown, marital_status, political_status},
  "job_intent": {target_position, expected_salary, available_date, work_location_preference},
  "education": [{school, degree, major, start_date, end_date, gpa, honors, courses}],
  "work_experience": [{company, title, start_date, end_date, achievements, tech_stack}],
  "project_experience": [{name, role, start_date, end_date, tech_stack, description, achievements}],
  "skills": {programming_languages, frameworks, databases, middleware, cloud_native, soft_skills},
  "certifications": [{name, issuer, date}],
  "languages": [{language, level, score}],
  "self_evaluation": ""
}

只输出JSON，不要任何额外说明。
"""

RESUME_PARSED_JSON = """
{
  "basic_info": {
    "name": "张三", "gender": "男", "birth_date": null, "age": 28,
    "phone": "13800138000", "email": "zhangsan@example.com",
    "location": "上海市浦东新区", "hometown": "江苏南京",
    "marital_status": null, "political_status": null
  },
  "job_intent": {
    "target_position": "高级后端工程师",
    "expected_salary": "30-40K",
    "available_date": "1个月", "work_location_preference": null
  },
  "education": [
    {"school": "上海交通大学", "degree": "硕士", "major": "计算机科学与技术",
     "start_date": "2018-09", "end_date": "2021-06", "gpa": "3.8/4.0",
     "honors": [], "courses": ["高级算法", "分布式计算", "操作系统"]},
    {"school": "武汉大学", "degree": "本科", "major": "软件工程",
     "start_date": "2014-09", "end_date": "2018-06", "gpa": "3.6/4.0",
     "honors": ["校级三好学生(2016, 2017)", "学生会技术部部长"], "courses": []}
  ],
  "work_experience": [
    {"company": "字节跳动", "title": "高级后端开发工程师",
     "start_date": "2021-07", "end_date": null,
     "achievements": ["负责抖音电商核心交易链路设计与开发，QPS峰值10w+",
                       "主导订单系统重构，平均响应时间从200ms优化至50ms",
                       "设计并落地分布式事务方案，保障跨服务数据一致性",
                       "团队带头，指导2名初级工程师"],
     "tech_stack": ["Go", "Kafka", "MySQL", "Redis"]},
    {"company": "腾讯", "title": "后端开发实习生",
     "start_date": "2019-07", "end_date": "2021-06",
     "achievements": ["参与微信支付风控系统开发",
                       "优化Redis缓存命中率，从75%提升至92%"],
     "tech_stack": []}
  ],
  "project_experience": [
    {"name": "分布式订单系统", "role": "技术负责人",
     "start_date": "2022-03", "end_date": "2022-12",
     "tech_stack": ["Go", "Kafka", "MySQL", "Redis", "Kubernetes"],
     "description": "日处理订单500w+，节假日峰值2000w+",
     "achievements": ["双11零故障", "订单处理延迟P99从1.5s降至300ms"]},
    {"name": "实时推荐系统", "role": null,
     "start_date": "2021-09", "end_date": "2022-02",
     "tech_stack": ["Python", "Flink", "Redis", "FAISS"],
     "description": "实时计算用户特征",
     "achievements": ["CTR提升18%"]}
  ],
  "skills": {
    "programming_languages": ["Go(精通)", "Python(熟练)", "Java(熟悉)"],
    "frameworks": ["Gin", "gRPC", "Spring Boot"],
    "databases": ["MySQL", "PostgreSQL", "MongoDB", "Redis", "Elasticsearch"],
    "middleware": ["Kafka", "RabbitMQ", "Nacos"],
    "cloud_native": ["Docker", "Kubernetes", "Istio"],
    "soft_skills": []
  },
  "certifications": [
    {"name": "AWS Certified Solutions Architect", "issuer": "AWS", "date": "2022"},
    {"name": "PMP认证", "issuer": "PMI", "date": "2023"}
  ],
  "languages": [{"language": "英语", "level": "六级", "score": "580分"}],
  "self_evaluation": "5年互联网后端开发经验，对分布式系统有深入理解。具备从0到1的项目落地能力..."
}
"""

FORM_FIELDS_MEDIUM = """
[
  {"id": "name", "label": "姓名", "type": "text", "required": true},
  {"id": "gender", "label": "性别", "type": "select", "options": ["男","女"], "required": true},
  {"id": "birth", "label": "出生日期", "type": "date", "required": true},
  {"id": "ethnicity", "label": "民族", "type": "select", "options": ["汉族","满族","..."], "required": true},
  {"id": "political", "label": "政治面貌", "type": "select", "options": ["群众","共青团员","中共党员","民主党派","其他"], "required": true},
  {"id": "marital", "label": "婚姻状况", "type": "select", "options": ["未婚","已婚","离异"], "required": false},
  {"id": "phone", "label": "手机号码", "type": "tel", "required": true},
  {"id": "email", "label": "电子邮箱", "type": "email", "required": true},
  {"id": "id_card", "label": "身份证号", "type": "text", "required": true},
  {"id": "household", "label": "户籍所在地", "type": "text", "required": true},
  {"id": "address", "label": "现居住地址", "type": "text", "required": true},
  {"id": "height", "label": "身高(cm)", "type": "number", "required": false},
  {"id": "weight", "label": "体重(kg)", "type": "number", "required": false},
  {"id": "edu_level", "label": "最高学历", "type": "select", "options": ["大专","本科","硕士","博士"], "required": true},
  {"id": "school", "label": "毕业院校", "type": "text", "required": true},
  {"id": "major", "label": "专业", "type": "text", "required": true},
  {"id": "graduation", "label": "毕业年份", "type": "number", "required": true},
  {"id": "gpa", "label": "在校绩点", "type": "text", "required": false},
  {"id": "english_level", "label": "英语水平", "type": "select", "options": ["四级","六级","专四","专八","其他"], "required": false},
  {"id": "current_company", "label": "当前公司", "type": "text", "required": false},
  {"id": "current_position", "label": "当前职位", "type": "text", "required": false},
  {"id": "work_years", "label": "工作年限", "type": "number", "required": true},
  {"id": "expected_salary", "label": "期望薪资", "type": "text", "required": true},
  {"id": "expected_city", "label": "期望工作城市", "type": "select", "required": true},
  {"id": "available_date", "label": "可入职时间", "type": "date", "required": true},
  {"id": "skills_text", "label": "专业技能", "type": "textarea", "required": false},
  {"id": "self_eval", "label": "自我评价", "type": "textarea", "required": false},
  {"id": "work_exp", "label": "工作经历", "type": "repeater", "required": true, "fields": ["company","position","start","end","description"]},
  {"id": "project_exp", "label": "项目经历", "type": "repeater", "required": false, "fields": ["name","role","start","end","tech","desc"]},
  {"id": "emergency_contact", "label": "紧急联系人", "type": "text", "required": false}
]
"""

FORM_FIELDS_SIMPLE = """
[
  {"id": "name", "label": "姓名", "type": "text"},
  {"id": "phone", "label": "手机", "type": "tel"},
  {"id": "email", "label": "邮箱", "type": "email"},
  {"id": "city", "label": "现居城市", "type": "text"},
  {"id": "edu", "label": "最高学历", "type": "select"},
  {"id": "school", "label": "学校", "type": "text"},
  {"id": "major", "label": "专业", "type": "text"},
  {"id": "current_company", "label": "目前公司", "type": "text"},
  {"id": "current_role", "label": "目前职位", "type": "text"},
  {"id": "work_years", "label": "工作年限", "type": "number"},
  {"id": "expected_salary", "label": "期望薪资", "type": "text"},
  {"id": "self_eval", "label": "自我评价", "type": "textarea"}
]
"""

# 复杂表单：在中等基础上追加约30个国央企特有字段
COMPLEX_EXTRA = """
[
  {"id":"father_name","label":"父亲姓名"},{"id":"father_work","label":"父亲工作单位"},
  {"id":"father_position","label":"父亲职务"},{"id":"father_phone","label":"父亲电话"},
  {"id":"mother_name","label":"母亲姓名"},{"id":"mother_work","label":"母亲工作单位"},
  {"id":"mother_position","label":"母亲职务"},{"id":"mother_phone","label":"母亲电话"},
  {"id":"spouse_name","label":"配偶姓名"},{"id":"spouse_work","label":"配偶工作单位"},
  {"id":"award_1","label":"主要奖励1"},{"id":"award_2","label":"主要奖励2"},
  {"id":"award_3","label":"主要奖励3"},{"id":"punishment","label":"是否受过处分"},
  {"id":"training_1","label":"培训经历1"},{"id":"training_2","label":"培训经历2"},
  {"id":"part_time","label":"社会兼职"},{"id":"overseas_exp","label":"海外经历"},
  {"id":"recommender_1_name","label":"推荐人1姓名"},{"id":"recommender_1_phone","label":"推荐人1电话"},
  {"id":"recommender_2_name","label":"推荐人2姓名"},{"id":"recommender_2_phone","label":"推荐人2电话"},
  {"id":"only_child","label":"是否独生子女"},{"id":"hukou_type","label":"户口性质","options":["农业","非农业","居民"]},
  {"id":"political_check","label":"政治考察情况"},{"id":"physical_check","label":"体检情况"},
  {"id":"confidential","label":"保密要求知晓"},{"id":"sign_term","label":"签约年限"},
  {"id":"liquidated","label":"违约金接受程度"},{"id":"job_seeking_status","label":"求职状态"}
]
"""

FORM_FIELDS_COMPLEX = FORM_FIELDS_MEDIUM + "\n额外字段:\n" + COMPLEX_EXTRA

FORM_FILL_PROMPT = """
你是简历表单智能填写助手。给定：
1. 用户的结构化简历JSON
2. 当前网页需填写的表单字段列表（含label/type/options/required）

任务：
- 为每个表单字段，从简历中找到最匹配的内容
- 不存在或无法推断的字段，标记为 needs_user_input
- 对于select/radio字段，从options中选择最接近的值
- 对于复合字段（工作经历等repeater），按时间倒序填充
- 对于推断字段（如年龄→出生年份），可基于其他信息合理推算
- 严禁编造数据，宁可留空

输出格式：
{
  "filled": {field_id: {value, confidence: 0-1, reasoning, source}},
  "needs_user_input": [field_id列表],
  "warnings": []
}
"""

# ============================================
# 实验执行
# ============================================
print("="*72)
print(" 简历AI填写产品 · 双阶段成本压测")
print("="*72)

A_input_text_tokens = count(SAMPLE_RESUME_TEXT)
A_image_tokens = 1800
A_prompt_tokens = count(RESUME_PARSE_PROMPT)
A_output_tokens = count(RESUME_PARSED_JSON)
A_input_total = A_image_tokens + A_prompt_tokens + A_input_text_tokens

print(f"\n[阶段A] 简历解析（首次上传，每用户1次）")
print(f"  输入: 图片 {A_image_tokens} + Prompt {A_prompt_tokens} + 文字 {A_input_text_tokens} = {A_input_total} tokens")
print(f"  输出: 结构化JSON = {A_output_tokens} tokens")

parsed_resume_tokens = count(RESUME_PARSED_JSON)
prompt_b_tokens = count(FORM_FILL_PROMPT)

scenarios = {
    "B-简单(互联网,~12字段)": (FORM_FIELDS_SIMPLE, 600),
    "B-中等(大厂/外企,~30字段)": (FORM_FIELDS_MEDIUM, 1500),
    "B-复杂(国央企,~60字段)": (FORM_FIELDS_COMPLEX, 3000),
}

stage_b_costs = {}
print(f"\n[阶段B] 表单智能填写（每次投递1次）")
print(f"  固定输入: 简历JSON {parsed_resume_tokens} + Prompt {prompt_b_tokens}")
for sn, (ft, oe) in scenarios.items():
    ftk = count(ft)
    bi = parsed_resume_tokens + prompt_b_tokens + ftk
    print(f"  {sn:30s} 表单{ftk:>5} tk | 总输入{bi:>5} | 输出{oe:>5}")
    stage_b_costs[sn] = (bi, oe)

# 价格表（元/百万tokens）
MODELS = {
    "GLM-4.6V-Flash(限免)":     {"in": 0,    "out": 0,    "cap": "入门"},
    "qwen-vl-ocr":              {"in": 0.5,  "out": 1.0,  "cap": "入门"},
    "GLM-4.6V-FlashX":          {"in": 0.3,  "out": 2.9,  "cap": "经济"},
    "qwen-vl-plus":             {"in": 1.5,  "out": 4.5,  "cap": "经济"},
    "GLM-4.6V":                 {"in": 2.2,  "out": 6.5,  "cap": "标准"},
    "qwen-vl-max":              {"in": 3.0,  "out": 9.0,  "cap": "标准"},
    "GLM-4.5V":                 {"in": 4.3,  "out": 13.0, "cap": "旗舰"},
    "moonshot-v1-32k-vision":   {"in": 24.0, "out": 24.0, "cap": "旗舰"},
}

def cost(in_tk, out_tk, model):
    p = MODELS[model]
    return (in_tk * p["in"] + out_tk * p["out"]) / 1_000_000

print("\n" + "="*72)
print(" 单次成本明细（元/份 或 元/次投递）")
print("="*72)

for cf in ["入门", "经济", "标准", "旗舰"]:
    print(f"\n[{cf}级]")
    print(f"  {'模型':26s} {'阶段A':>10s} {'B-简单':>10s} {'B-中等':>10s} {'B-复杂':>10s}")
    for m, info in MODELS.items():
        if info["cap"] != cf: continue
        ca = cost(A_input_total, A_output_tokens, m)
        cb_s = cost(*stage_b_costs["B-简单(互联网,~12字段)"], m)
        cb_m = cost(*stage_b_costs["B-中等(大厂/外企,~30字段)"], m)
        cb_c = cost(*stage_b_costs["B-复杂(国央企,~60字段)"], m)
        print(f"  {m:26s} {ca:>10.5f} {cb_s:>10.5f} {cb_m:>10.5f} {cb_c:>10.5f}")

# 端到端单次完整投递成本
print("\n" + "="*72)
print(" 端到端单次投递成本 = 阶段A摊销 + 阶段B")
print(" 假设：每份简历平均投递10家企业，A摊销 1/10")
print("="*72)

def end_to_end(model, form_type, parses_per_resume=10):
    a_amort = cost(A_input_total, A_output_tokens, model) / parses_per_resume
    b = cost(*stage_b_costs[form_type], model)
    return a_amort, b, a_amort + b

print(f"\n  {'模型':26s} {'表单类型':22s} {'A摊销':>9s} {'B':>9s} {'合计':>9s}")
for m in MODELS:
    for ftype in stage_b_costs:
        a, b, t = end_to_end(m, ftype)
        print(f"  {m:26s} {ftype:22s} {a:>9.5f} {b:>9.5f} {t:>9.5f}")

# 多负载场景
print("\n" + "="*72)
print(" 不同负载下的月度成本（主力模型对比）")
print(" 表单分布: 简单50% + 中等35% + 复杂15%")
print("="*72)

def loaded_cost(model, monthly_apps, parses_per_resume=10, mix=(0.5, 0.35, 0.15)):
    a_per = cost(A_input_total, A_output_tokens, model) / parses_per_resume
    b_s = cost(*stage_b_costs["B-简单(互联网,~12字段)"], model)
    b_m = cost(*stage_b_costs["B-中等(大厂/外企,~30字段)"], model)
    b_c = cost(*stage_b_costs["B-复杂(国央企,~60字段)"], model)
    avg_b = mix[0]*b_s + mix[1]*b_m + mix[2]*b_c
    per = a_per + avg_b
    return per, per * monthly_apps

LOAD_SCENARIOS = [
    ("个人开发期 (10投递/月)",         10),
    ("内测 (1k用户, 5w投递/月)",       50_000),
    ("早期产品 (1万用户, 50w/月)",     500_000),
    ("中型规模 (10万用户, 500w/月)",   5_000_000),
    ("大规模 (100万用户, 5000w/月)",   50_000_000),
]

CANDS = ["GLM-4.6V-Flash(限免)", "GLM-4.6V-FlashX", "qwen-vl-plus", "GLM-4.6V", "qwen-vl-max"]

print(f"\n  {'场景':32s} " + "  ".join([f"{m[:15]:>15s}" for m in CANDS]))
print(f"  {'每次成本':32s} " + "  ".join([f"{loaded_cost(m,1)[0]:>15.5f}" for m in CANDS]))
print("-"*72)
for sn, n in LOAD_SCENARIOS:
    line = f"  {sn:32s} "
    for m in CANDS:
        _, t = loaded_cost(m, n)
        if t == 0: cs = "免费"
        elif t < 10: cs = f"{t:.2f}元"
        elif t < 1000: cs = f"{t:.0f}元"
        elif t < 10000: cs = f"{t/1000:.1f}k元"
        else: cs = f"{t/10000:.1f}万元"
        line += f"  {cs:>15s}"
    print(line)

# 优化策略
print("\n" + "="*72)
print(" 优化策略对成本的影响（基线: qwen-vl-plus, 月50w投递）")
print("="*72)

m = "qwen-vl-plus"
n = 500_000

base_per, base_total = loaded_cost(m, n)
print(f"\n[基线] 单次 {base_per:.5f}元 | 月度 {base_total:,.0f}元")

# Prompt Caching
def loaded_cost_with_cache(model, monthly_apps, cache_discount=0.2):
    p = MODELS[model]
    a_per = cost(A_input_total, A_output_tokens, model) / 10
    avg_b = 0
    for ftype, weight in zip(stage_b_costs.keys(), [0.5, 0.35, 0.15]):
        in_tk, out_tk = stage_b_costs[ftype]
        non_cached = in_tk - prompt_b_tokens
        b = (non_cached * p["in"] + prompt_b_tokens * p["in"] * cache_discount + out_tk * p["out"]) / 1_000_000
        avg_b += weight * b
    per = a_per + avg_b
    return per, per * monthly_apps

c1_per, c1_total = loaded_cost_with_cache(m, n)
print(f"[+提示词缓存] 单次 {c1_per:.5f}元 | 月度 {c1_total:,.0f}元 | 节省 {(1-c1_total/base_total)*100:.1f}%")

# 表单方案缓存
def loaded_cost_with_form_cache(model, monthly_apps, form_reuse=0.3):
    p, t = loaded_cost(model, monthly_apps)
    saved = t * 0.95 * form_reuse  # B占95%(A仅占摊销小部分), 30%可复用
    return p, t - saved

c2_per, c2_total = loaded_cost_with_form_cache(m, n)
print(f"[+表单方案缓存30%] 单次 {c2_per:.5f}元 | 月度 {c2_total:,.0f}元 | 节省 {(1-c2_total/base_total)*100:.1f}%")

# 分级路由
def tiered(monthly_apps, simple_ratio=0.7):
    p1, t1 = loaded_cost("qwen-vl-plus", int(monthly_apps * simple_ratio))
    p2, t2 = loaded_cost("qwen-vl-max", int(monthly_apps * (1-simple_ratio)))
    return (t1+t2)/monthly_apps, t1+t2

c3_per, c3_total = tiered(n)
_, base_max_total = loaded_cost("qwen-vl-max", n)
print(f"[+分级路由70%plus+30%max] 单次 {c3_per:.5f}元 | 月度 {c3_total:,.0f}元 | 较纯max省 {(1-c3_total/base_max_total)*100:.1f}%")

# 全部叠加
c4_total = c1_total * (1 - 0.3 * 0.95)
print(f"[+全部叠加(估)] 月度 ~{c4_total:,.0f}元 | 累计节省 {(1-c4_total/base_total)*100:.1f}%")

# 阶段B 架构变体
print("\n" + "="*72)
print(" 阶段B 架构变体对比（决策点：B如何拆分调用）")
print("="*72)
m = "qwen-vl-plus"
b_in, b_out = stage_b_costs["B-中等(大厂/外企,~30字段)"]

v1 = cost(b_in, b_out, m)
v2_1 = cost(prompt_b_tokens + count(FORM_FIELDS_MEDIUM), 800, m)
v2_2 = cost(prompt_b_tokens + parsed_resume_tokens + 800, b_out, m)
v2 = v2_1 + v2_2
v3 = 30 * cost(prompt_b_tokens + parsed_resume_tokens + 100, 80, m)

print(f"\n以中等表单(30字段) + qwen-vl-plus 为例：")
print(f"  方案1: 单次大调用            {v1:.5f} 元/次  (1.0x) ← 推荐")
print(f"  方案2: 两段(理解+填值)       {v2:.5f} 元/次  ({v2/v1:.1f}x)")
print(f"  方案3: 每字段独立调用         {v3:.5f} 元/次  ({v3/v1:.1f}x) ← 不推荐")

# 商业模型推算
print("\n" + "="*72)
print(" 商业可行性推算")
print("="*72)

# 假设主力 qwen-vl-plus + 全优化，每用户月投递 30 次
optimized_per_app = c1_per * (1 - 0.3 * 0.95)  # 约0.0008元
monthly_per_user = 30
cost_per_user_month = optimized_per_app * monthly_per_user

pricing_models = [
    ("免费版 (5次/月限制)", 0, 5),
    ("标准版 (¥9.9/月, 30次)", 9.9, 30),
    ("Pro版 (¥29/月, 不限)", 29, 100),
]

print(f"\n优化后单次实际成本: {optimized_per_app:.5f} 元")
print(f"\n  {'套餐':28s} {'月费':>8s} {'用户月用量':>12s} {'API成本':>10s} {'毛利':>10s} {'毛利率':>10s}")
for name, fee, usage in pricing_models:
    api_cost = optimized_per_app * usage
    profit = fee - api_cost
    margin = profit / fee * 100 if fee > 0 else 0
    print(f"  {name:28s} {fee:>7.1f}元 {usage:>11}次 {api_cost:>9.4f}元 {profit:>9.4f}元 {margin:>9.1f}%")
