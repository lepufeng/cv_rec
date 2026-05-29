from app.api.v1.fill_plans import _build_section_actions


def test_build_section_actions_supports_common_ats_section_names():
    resume_data = {
        "project_experience": [{}, {}, {}],
        "education": [{}, {}],
        "work_experience": [{}, {}, {}],
        "internship_experience": [{}, {}, {}],
        "campus_experience": [{}, {}],
    }
    sections = [
        {"name": "项目经验", "currentCount": 1, "addButton": True},
        {"name": "教育背景", "currentCount": 1, "addButton": True},
        {"name": "工作履历", "currentCount": 1, "addButton": True},
        {"name": "实习经验", "currentCount": 2, "addButton": True},
        {"name": "社会实践", "currentCount": 1, "addButton": True},
        {"name": "工作城市", "currentCount": 1, "addButton": True},
        {"name": "employment-history", "currentCount": 3, "addButton": True},
    ]

    assert _build_section_actions(sections, resume_data) == {
        "项目经验": "add_2",
        "教育背景": "add_1",
        "工作履历": "add_2",
        "实习经验": "add_1",
        "社会实践": "add_1",
    }


def test_build_section_actions_ignores_sections_without_add_button():
    resume_data = {"project_experience": [{}, {}]}
    sections = [{"name": "项目经历", "currentCount": 1, "addButton": False}]

    assert _build_section_actions(sections, resume_data) == {}


def test_build_section_actions_counts_empty_repeat_sections_from_zero():
    resume_data = {"project_experience": [{}, {}, {}]}
    sections = [{"name": "项目经历", "currentCount": 0, "addButton": True}]

    assert _build_section_actions(sections, resume_data) == {"项目经历": "add_3"}
