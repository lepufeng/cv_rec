"""Pure-function tests for FillService internals."""
from __future__ import annotations

from app.services.fill_service import (
    FillService,
    _augment_fields_with_repeat_context,
    _build_rules_fallback_plan,
    _extract_domain,
    _match_field_from_resume,
)


def test_structure_hash_stable_under_reorder():
    fields_a = [
        {"id": "name", "label": "姓名", "type": "text"},
        {"id": "phone", "label": "手机", "type": "tel"},
    ]
    fields_b = [
        {"id": "phone", "label": "手机", "type": "tel"},
        {"id": "name", "label": "姓名", "type": "text"},
    ]
    assert FillService._structure_hash(fields_a, {}) == FillService._structure_hash(fields_b, {})


def test_structure_hash_changes_with_field_change():
    a = [{"id": "name", "label": "姓名", "type": "text"}]
    b = [{"id": "name", "label": "Name", "type": "text"}]
    assert FillService._structure_hash(a, {}) != FillService._structure_hash(b, {})


def test_extract_domain():
    assert _extract_domain("https://jobs.example.com/apply") == "jobs.example.com"
    assert _extract_domain("not-a-url") == "unknown"


def test_strip_codeblock():
    from app.services.parsing_service import _strip_codeblock

    assert _strip_codeblock("```json\n{\"a\":1}\n```") == '{"a":1}'
    assert _strip_codeblock('{"a":1}') == '{"a":1}'
    assert _strip_codeblock("```\n{}\n```") == "{}"


def test_repeated_project_fields_match_by_repeat_index():
    resume = {
        "project_experience": [
            {
                "name": "旧项目",
                "role": "成员",
                "start_date": "2023-01",
                "end_date": "2023-03",
                "tech_stack": ["Python"],
                "achievements": ["维护旧系统"],
            },
            {
                "name": "智能投递助手",
                "role": "项目负责人",
                "start_date": "2024-01",
                "end_date": "2024-06",
                "tech_stack": ["TypeScript", "FastAPI"],
                "achievements": ["实现多招聘站点自动填写"],
            },
        ],
    }

    fields = {
        "project_name_2": {"label": "项目名称", "repeatSection": "项目经历", "repeatIndex": 1},
        "project_role_2": {"label": "项目角色", "repeatSection": "项目经历", "repeatIndex": 1},
        "project_start_2": {
            "label": "项目时间",
            "subLabel": "开始时间",
            "groupIndex": 0,
            "groupSize": 2,
            "repeatSection": "项目经历",
            "repeatIndex": 1,
        },
        "project_end_2": {
            "label": "项目时间",
            "subLabel": "结束时间",
            "groupIndex": 1,
            "groupSize": 2,
            "repeatSection": "项目经历",
            "repeatIndex": 1,
        },
        "project_stack_2": {"label": "技术栈", "repeatSection": "项目经历", "repeatIndex": 1},
        "project_result_2": {"label": "项目成果", "repeatSection": "项目经历", "repeatIndex": 1},
    }

    assert _match_field_from_resume(fields["project_name_2"], resume) == (
        "智能投递助手",
        "project_experience[1].name",
        0.82,
    )
    assert _match_field_from_resume(fields["project_role_2"], resume) == (
        "项目负责人",
        "project_experience[1].role",
        0.82,
    )
    assert _match_field_from_resume(fields["project_start_2"], resume) == (
        "2024-01",
        "project_experience[1].start_date",
        0.82,
    )
    assert _match_field_from_resume(fields["project_end_2"], resume) == (
        "2024-06",
        "project_experience[1].end_date",
        0.82,
    )
    assert _match_field_from_resume(fields["project_stack_2"], resume) == (
        "TypeScript、FastAPI",
        "project_experience[1].tech_stack",
        0.82,
    )
    assert _match_field_from_resume(fields["project_result_2"], resume) == (
        "实现多招聘站点自动填写",
        "project_experience[1].achievements",
        0.82,
    )


def test_repeated_education_and_internship_fields_match_by_index():
    resume = {
        "education": [
            {"school": "本科大学", "degree": "本科", "major": "软件工程"},
            {"school": "研究生大学", "degree": "硕士", "major": "计算机科学"},
        ],
        "internship_experience": [
            {"company": "旧实习", "title": "助理", "department": "测试部"},
            {"company": "腾讯", "title": "后端开发实习生", "department": "云开发平台部"},
        ],
    }

    assert _match_field_from_resume(
        {"label": "学校名称", "repeatSection": "教育经历", "repeatIndex": 1},
        resume,
    ) == ("研究生大学", "education[1].school", 0.82)
    assert _match_field_from_resume(
        {"label": "专业", "repeatSection": "教育经历", "repeatIndex": 1},
        resume,
    ) == ("计算机科学", "education[1].major", 0.82)
    assert _match_field_from_resume(
        {"label": "实习公司", "repeatSection": "实习经历", "repeatIndex": 1},
        resume,
    ) == ("腾讯", "internship_experience[1].company", 0.82)
    assert _match_field_from_resume(
        {"label": "实习岗位", "repeatSection": "实习经历", "repeatIndex": 1},
        resume,
    ) == ("后端开发实习生", "internship_experience[1].title", 0.82)


def test_repeated_fields_can_infer_section_from_label_and_repeat_index():
    resume = {
        "education": [
            {"school": "本科大学", "degree": "本科", "major": "软件工程"},
            {"school": "研究生大学", "degree": "硕士", "major": "计算机科学"},
        ],
        "work_experience": [
            {"company": "旧公司", "title": "开发"},
            {"company": "未来科技", "title": "后端工程师"},
        ],
    }

    assert _match_field_from_resume(
        {"label": "学校名称", "repeatIndex": 1},
        resume,
    ) == ("研究生大学", "education[1].school", 0.82)
    assert _match_field_from_resume(
        {"label": "专业", "repeatIndex": 1},
        resume,
    ) == ("计算机科学", "education[1].major", 0.82)
    assert _match_field_from_resume(
        {"label": "公司", "repeatIndex": 1},
        resume,
    ) == ("未来科技", "work_experience[1].company", 0.82)


def test_flat_repeated_field_runs_gain_repeat_context():
    fields = [
        {"fieldId": "edu1_school", "label": "学校名称", "type": "text"},
        {"fieldId": "edu1_degree", "label": "学历", "type": "select"},
        {"fieldId": "edu1_major", "label": "专业", "type": "text"},
        {"fieldId": "edu1_start", "label": "起止时间", "type": "date", "groupIndex": 0},
        {"fieldId": "edu1_end", "label": "起止时间", "type": "date", "groupIndex": 1},
        {"fieldId": "edu2_school", "label": "学校名称", "type": "text"},
        {"fieldId": "edu2_degree", "label": "学历", "type": "select"},
        {"fieldId": "edu2_major", "label": "专业", "type": "text"},
        {"fieldId": "edu2_start", "label": "起止时间", "type": "date", "groupIndex": 0},
        {"fieldId": "edu2_end", "label": "起止时间", "type": "date", "groupIndex": 1},
        {"fieldId": "summary", "label": "自我评价", "type": "textarea"},
    ]

    augmented = _augment_fields_with_repeat_context(fields)
    assert "repeatIndex" not in fields[0]
    assert [field["repeatIndex"] for field in augmented[:10]] == [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
    assert {field["repeatSize"] for field in augmented[:10]} == {2}
    assert {field["repeatSection"] for field in augmented[:10]} == {"教育经历"}
    assert "repeatIndex" not in augmented[10]


def test_rules_fallback_maps_flat_repeated_fields_by_inferred_index():
    resume = {
        "education": [
            {
                "school": "本科大学",
                "degree": "本科",
                "major": "软件工程",
                "start_date": "2018-09",
                "end_date": "2022-06",
            },
            {
                "school": "研究生大学",
                "degree": "硕士",
                "major": "计算机科学",
                "start_date": "2022-09",
                "end_date": "2025-06",
            },
        ],
    }
    fields = [
        {"fieldId": "edu1_school", "label": "学校名称", "type": "text"},
        {"fieldId": "edu1_degree", "label": "学历", "type": "select"},
        {"fieldId": "edu1_major", "label": "专业", "type": "text"},
        {"fieldId": "edu1_start", "label": "起止时间", "type": "date", "groupIndex": 0},
        {"fieldId": "edu1_end", "label": "起止时间", "type": "date", "groupIndex": 1},
        {"fieldId": "edu2_school", "label": "学校名称", "type": "text"},
        {"fieldId": "edu2_degree", "label": "学历", "type": "select"},
        {"fieldId": "edu2_major", "label": "专业", "type": "text"},
        {"fieldId": "edu2_start", "label": "起止时间", "type": "date", "groupIndex": 0},
        {"fieldId": "edu2_end", "label": "起止时间", "type": "date", "groupIndex": 1},
    ]

    plan = _build_rules_fallback_plan(resume, fields)
    assert plan.filled["edu1_school"].value == "本科大学"
    assert plan.filled["edu2_school"].value == "研究生大学"
    assert plan.filled["edu2_degree"].source == "education[1].degree"
    assert plan.filled["edu2_start"].value == "2022-09"
    assert plan.filled["edu2_end"].value == "2025-06"


def test_repeated_current_flag_maps_when_end_date_is_open():
    resume = {
        "work_experience": [
            {"company": "旧公司", "title": "开发", "end_date": "2022-12"},
            {"company": "当前公司", "title": "后端工程师", "end_date": None},
        ],
        "project_experience": [
            {"name": "已结束项目", "end_date": "2023-06"},
            {"name": "进行中项目", "end_date": "Present"},
        ],
    }

    assert _match_field_from_resume(
        {"label": "至今", "type": "checkbox", "options": ["至今"], "repeatSection": "工作经历", "repeatIndex": 1},
        resume,
    ) == ("至今", "work_experience[1].end_date", 0.82)
    assert _match_field_from_resume(
        {"label": "Present", "type": "checkbox", "options": ["Present"], "repeatSection": "项目经历", "repeatIndex": 1},
        resume,
    ) == ("Present", "project_experience[1].end_date", 0.82)
    assert _match_field_from_resume(
        {"label": "至今", "type": "checkbox", "options": ["至今"], "repeatSection": "工作经历", "repeatIndex": 0},
        resume,
    ) is None


def test_single_date_range_field_maps_start_and_end_together():
    resume = {
        "project_experience": [
            {
                "name": "智能投递助手",
                "start_date": "2024-01",
                "end_date": "2024-06",
            },
        ],
        "work_experience": [
            {
                "company": "当前公司",
                "start_date": "2025-01",
                "end_date": None,
            },
        ],
    }

    assert _match_field_from_resume(
        {
            "label": "起止时间",
            "type": "date",
            "widget": "date-range",
            "repeatSection": "项目经历",
            "repeatIndex": 0,
        },
        resume,
    ) == ("2024-01 - 2024-06", "project_experience[0].date_range", 0.82)
    assert _match_field_from_resume(
        {
            "label": "任职日期",
            "type": "date",
            "widget": "date-range",
            "repeatSection": "工作经历",
            "repeatIndex": 0,
        },
        resume,
    ) == ("2025-01 - 至今", "work_experience[0].date_range", 0.82)


def test_location_preference_list_maps_to_multi_select_text():
    resume = {
        "job_intent": {
            "work_location_preference": ["上海", "深圳"],
        },
    }

    assert _match_field_from_resume(
        {"label": "期望工作城市（至多三个）", "type": "select"},
        resume,
    ) == ("上海、深圳", "job_intent.work_location_preference", 0.74)


def test_rules_skip_plain_readonly_but_keep_interactive_readonly_fields():
    resume = {
        "basic_info": {
            "email": "resume@example.com",
            "birth_date": "1998-05-01",
        },
        "education": [
            {"degree": "硕士"},
        ],
    }

    assert _match_field_from_resume(
        {
            "fieldId": "locked_email",
            "label": "邮箱",
            "type": "text",
            "widget": "text-input",
            "htmlType": "email",
            "readonly": True,
        },
        resume,
    ) is None
    assert _match_field_from_resume(
        {
            "fieldId": "locked_email_selectish",
            "label": "邮箱",
            "type": "select",
            "widget": "custom-dropdown",
            "htmlType": "text",
            "readonly": True,
        },
        resume,
    ) is None
    assert _match_field_from_resume(
        {
            "fieldId": "degree",
            "label": "学历",
            "type": "select",
            "widget": "custom-dropdown",
            "htmlType": "text",
            "readonly": True,
        },
        resume,
    ) == ("硕士", "education[0].degree", 0.82)
    assert _match_field_from_resume(
        {
            "fieldId": "birth",
            "label": "出生日期",
            "type": "date",
            "widget": "date-picker",
            "htmlType": "text",
            "readonly": True,
        },
        resume,
    ) == ("1998-05-01", "basic_info.birth_date", 0.86)
