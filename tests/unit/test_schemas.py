"""Schema sanity tests."""
from __future__ import annotations

from app.schemas.fill_plan import FillPlanLLMOutput, FillPlanRequest, FilledField, FormField
from app.schemas.resume import BasicInfo, ResumeData


def test_resume_data_defaults():
    rd = ResumeData()
    assert rd.schema_version == "1.6"
    assert rd.basic_info.name is None
    assert rd.education == []
    assert rd.internship_experience == []
    assert rd.work_experience == []
    assert rd.campus_experience == []
    assert rd.skills.tools == []
    assert rd.facts == []
    assert rd.extra_sections == []


def test_resume_data_roundtrip():
    rd = ResumeData(basic_info=BasicInfo(name="Alice", phone="12345"))
    dumped = rd.model_dump(mode="json")
    again = ResumeData.model_validate(dumped)
    assert again.basic_info.name == "Alice"
    assert again.basic_info.phone == "12345"


def test_resume_data_unknown_fields_ignored():
    rd = ResumeData.model_validate({
        "basic_info": {"name": "Bob", "weird_extra_field": "ignored"},
        "extra_top_level": [1, 2],
    })
    assert rd.basic_info.name == "Bob"


def test_resume_skills_tools_and_internship_department_preserved():
    rd = ResumeData.model_validate({
        "internship_experience": [{
            "company": "香港城市大学（东莞）",
            "department": "国际交流处GEO",
            "title": "实习助理",
        }],
        "skills": {
            "programming_languages": ["Python", "SQL"],
            "tools": ["Microsoft Office", "Tableau"],
        },
    })
    assert rd.internship_experience[0].department == "国际交流处GEO"
    assert rd.skills.tools == ["Microsoft Office", "Tableau"]


def test_resume_fact_allows_internship_scope():
    rd = ResumeData.model_validate({
        "facts": [{
            "key": "weekly_internship_days",
            "label": "每周可实习天数",
            "value": "每周可实习5天",
            "scope": "internship_experience",
        }],
    })
    assert rd.facts[0].scope == "internship_experience"


def test_resume_campus_experience_preserved():
    rd = ResumeData.model_validate({
        "campus_experience": [
            {
                "organization": "大数据与信息工程学院学生会",
                "department": "主席团",
                "role": "副主席",
                "category": "学生组织",
                "start_date": "2023-09",
                "end_date": "2024-06",
                "achievements": ["统筹学院学生工作与志愿活动"],
                "tags": ["学生干部", "组织协调"],
            },
            {
                "organization": "青年志愿者协会",
                "department": "办公室",
                "role": "部长",
                "category": "志愿服务",
            },
        ],
    })
    assert len(rd.campus_experience) == 2
    assert rd.campus_experience[0].organization == "大数据与信息工程学院学生会"
    assert rd.campus_experience[0].role == "副主席"
    assert rd.campus_experience[1].department == "办公室"


def test_form_field_repeater_recursive():
    f = FormField(
        fieldId="work_exp",
        label="工作经历",
        type="repeater",
        subFields=[
            FormField(fieldId="company", label="公司", type="text"),
            FormField(fieldId="title", label="职位", type="text"),
        ],
    )
    assert f.subFields and f.subFields[0].fieldId == "company"


def test_form_field_accepts_plugin_scan_naming_and_keeps_metadata():
    req = FillPlanRequest.model_validate({
        "id": "scan_1",
        "url": "https://xiaopeng.jobs.feishu.cn/index/resume/apply",
        "title": "小鹏招聘 | 简历填写",
        "fieldCount": 2,
        "fields": [
            {
                "fieldId": "auto_name",
                "label": "姓名",
                "type": "text",
                "widget": "text-input",
                "maxLength": 25,
                "enumerable": False,
                "section": "基本信息",
                "frameUrl": "https://xiaopeng.jobs.feishu.cn/index/resume/apply",
            },
            {
                "fieldId": "auto_phone",
                "label": "手机号码",
                "type": "text",
                "groupId": "g_0",
                "groupIndex": 1,
                "groupSize": 2,
                "subLabel": "手机号码",
                "repeatGroupId": "r_0",
                "repeatIndex": 1,
                "repeatSize": 3,
                "repeatSection": "项目经历",
            },
        ],
    })
    assert req.url == "https://xiaopeng.jobs.feishu.cn/index/resume/apply"
    assert len(req.fields) == 2
    assert req.fields[0].fieldId == "auto_name"
    assert req.fields[0].maxLength == 25
    assert req.fields[0].widget == "text-input"
    assert req.fields[0].fieldFingerprint
    assert req.fields[1].groupId == "g_0"
    assert req.fields[1].subLabel == "手机号码"
    assert req.fields[1].repeatGroupId == "r_0"
    assert req.fields[1].repeatIndex == 1
    assert req.fields[1].repeatSize == 3
    assert req.fields[1].repeatSection == "项目经历"


def test_fill_plan_request_still_accepts_legacy_platform_naming():
    req = FillPlanRequest.model_validate({
        "resume_id": "resume_1",
        "site_url": "https://xiaopeng.jobs.feishu.cn/index/resume/apply",
        "form_fields": [
            {
                "id": "name",
                "label": "姓名",
                "type": "text",
                "max_length": 20,
            },
        ],
    })
    assert req.resumeId == "resume_1"
    assert req.url == "https://xiaopeng.jobs.feishu.cn/index/resume/apply"
    assert req.fields[0].fieldId == "name"
    assert req.fields[0].maxLength == 20


def test_filled_field_confidence_bounds():
    f = FilledField(value="x", confidence=0.5, reasoning="r", source="s")
    assert 0 <= f.confidence <= 1


def test_filled_field_allows_checkbox_string_lists():
    f = FilledField(value=["没有工作经历"], confidence=0.8, reasoning="r", source="work_experience")
    assert f.value == ["没有工作经历"]


def test_fill_plan_llm_output_defaults():
    out = FillPlanLLMOutput()
    assert out.filled == {}
    assert out.needs_user_input == []
    assert out.warnings == []


def test_extra_sections_default_and_styles():
    from app.schemas.resume import Education, ExtraSection, ResumeData

    # default empty
    edu = Education(school="X")
    assert edu.extra_sections == []

    # populate at multiple levels
    rd = ResumeData(
        education=[Education(
            school="A大学",
            extra_sections=[ExtraSection(title="导师", style="text", items=["王教授"])],
        )],
        extra_sections=[
            ExtraSection(title="兴趣爱好", style="pills", items=["足球", "吉他"]),
            ExtraSection(title="出版物", items=["《XXX》ICLR 2024"]),  # style defaults to list
        ],
    )
    dumped = rd.model_dump(mode="json")
    again = ResumeData.model_validate(dumped)
    assert again.extra_sections[0].style == "pills"
    assert again.extra_sections[1].style == "list"   # default
    assert again.education[0].extra_sections[0].items == ["王教授"]


def test_extra_section_invalid_style_coerced():
    """Unknown style values fall back to 'list' rather than failing validation."""
    from app.schemas.resume import ExtraSection

    s = ExtraSection(title="x", style="table", items=["a"])  # type: ignore[arg-type]
    assert s.style == "list"


def test_resume_facts_preserve_dynamic_reusable_information():
    """Long-tail resume facts should survive validation for semantic filling."""
    from app.schemas.resume import ResumeData

    rd = ResumeData.model_validate({
        "facts": [
            {
                "key": "Weekly Internship Days",
                "label": "每周可实习天数",
                "value": "每周可实习5天",
                "normalized_value": 5,
                "value_type": "number",
                "scope": "profile",
                "source_text": "每周可实习5天 可实习大于6个月",
                "confidence": 0.94,
                "reuse_likelihood": "high",
            },
            {"label": "", "value": ""},
        ],
    })
    assert len(rd.facts) == 1
    assert rd.facts[0].key == "weekly_internship_days"
    assert rd.facts[0].normalized_value == 5
    assert rd.facts[0].confidence == 0.94


def test_resume_data_invalid_enum_coerced():
    """Bad degree / gender values are coerced to '其他' instead of rejected."""
    from app.schemas.resume import ResumeData

    rd = ResumeData.model_validate({
        "basic_info": {"gender": "Female"},
        "education": [{"school": "X University", "degree": "交换生"}],
    })
    assert rd.basic_info.gender == "其他"
    assert rd.education[0].degree == "其他"


def test_education_honors_strip_wrapping_quotes():
    """Stray quote characters from OCR drift must be cleaned from list items."""
    from app.schemas.resume import Education

    edu = Education.model_validate({
        "school": "X",
        "honors": [
            "'校级一等奖学金'",                  # ASCII single, full wrap
            "\u201c优秀交换生\u201d",            # CJK double-quote pair
            "2024-2025学年'校级三好学生奖学金'",  # mid-string ASCII pair after time prefix
            "保留'引号-但只有一个",                 # odd count → keep as-is
        ],
    })
    assert edu.honors == [
        "校级一等奖学金",
        "优秀交换生",
        "2024-2025学年校级三好学生奖学金",
        "保留'引号-但只有一个",
    ]


def test_education_honors_drops_metrics():
    """GPA / rank entries should never appear in honors."""
    from app.schemas.resume import Education

    edu = Education.model_validate({
        "school": "X",
        "honors": [
            "GPA: 3.82/4.3",
            "gpa 3.5",
            "班级排名: 2/30",
            "年级排名 5%",
            "Rank 1/100",
            "校级三好学生",
        ],
    })
    assert edu.honors == ["校级三好学生"]


def test_education_ranking_accepts_raw_string():
    """Academic ranking should be preserved separately from honors."""
    from app.schemas.resume import Education

    edu = Education.model_validate({
        "school": "X",
        "ranking": "专业排名：6/114",
        "honors": ["排名：6/114", "校级三好学生"],
    })
    assert edu.ranking is not None
    assert edu.ranking.raw == "专业排名：6/114"
    assert edu.ranking.rank == 6
    assert edu.ranking.total == 114
    assert edu.ranking.context == "专业排名"
    assert edu.honors == ["校级三好学生"]


def test_education_ranking_drops_non_ranking_context():
    from app.schemas.resume import Education

    edu = Education.model_validate({
        "school": "贵州大学",
        "ranking": {
            "raw": "6/114",
            "rank": 6,
            "total": 114,
            "context": "大数据与信息工程学院",
        },
    })
    assert edu.ranking is not None
    assert edu.ranking.context is None


def test_education_ranking_accepts_percentile():
    """Percentile-only ranking should keep the raw expression."""
    from app.schemas.resume import Education

    edu = Education.model_validate({
        "school": "X",
        "ranking": {"raw": "年级排名 前 10%"},
    })
    assert edu.ranking is not None
    assert edu.ranking.raw == "年级排名 前 10%"
    assert edu.ranking.percentile == "前10%"
    assert edu.ranking.context == "年级排名"


def test_project_tech_stack_keeps_tools_not_methods():
    """Tech stack should stay focused on languages/packages/tooling."""
    from app.schemas.resume import ProjectExperience

    project = ProjectExperience.model_validate({
        "name": "X",
        "tech_stack": [
            "Python",
            "SQL",
            "Pandas",
            "Matplotlib",
            "K-Means",
            "Validation集",
            "LATAM",
            "DeepSeek API",
        ],
    })
    assert project.tech_stack == ["Python", "SQL", "Pandas", "Matplotlib"]


def test_project_extra_sections_drops_keyword_blocks():
    """Project extra sections should not duplicate keywords from achievements."""
    from app.schemas.resume import ProjectExperience

    project = ProjectExperience.model_validate({
        "name": "X",
        "extra_sections": [
            {"title": "算法与方法", "style": "list", "items": ["K-Means"]},
            {"title": "数据集", "style": "pills", "items": ["Validation集"]},
            {"title": "市场", "style": "pills", "items": ["LATAM"]},
            {"title": "开源链接", "style": "list", "items": ["https://example.com"]},
        ],
    })
    assert [s.title for s in project.extra_sections] == ["开源链接"]
