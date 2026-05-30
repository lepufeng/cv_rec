"""Sample structured resume used to seed FakeModel responses."""
from __future__ import annotations


SAMPLE_PARSED_RESUME = {
    "schema_version": "1.6",
    "basic_info": {
        "name": "张三",
        "gender": "男",
        "birth_date": "1996-05-15",
        "age": 28,
        "phone": "13800138000",
        "email": "zhangsan@example.com",
        "location": "上海市浦东新区",
        "hometown": "江苏南京",
        "marital_status": "未婚",
        "political_status": "中共党员",
        "ethnicity": "汉族",
        "id_card": None,
    },
    "job_intent": {
        "target_position": "高级后端工程师",
        "expected_salary": "30-40K",
        "available_date": "1个月",
        "work_location_preference": ["上海", "北京"],
    },
    "education": [
        {
            "school": "上海交通大学",
            "degree": "硕士",
            "major": "计算机科学与技术",
            "start_date": "2018-09",
            "end_date": "2021-06",
            "gpa": "3.8/4.0",
            "ranking": None,
            "honors": [],
            "courses": ["高级算法", "分布式计算"],
        }
    ],
    "work_experience": [
        {
            "company": "字节跳动",
            "department": "电商",
            "title": "高级后端开发工程师",
            "start_date": "2021-07",
            "end_date": None,
            "achievements": ["负责抖音电商核心交易链路"],
            "tech_stack": ["Go", "Kafka"],
        }
    ],
    "internship_experience": [
        {
            "company": "小鹏汽车",
            "department": "智能平台部",
            "title": "后端开发实习生",
            "start_date": "2020-06",
            "end_date": "2020-09",
            "achievements": ["参与内部工具接口开发与测试"],
            "tech_stack": ["Python", "FastAPI"],
        }
    ],
    "campus_experience": [
        {
            "organization": "上海交通大学学生会",
            "department": "技术部",
            "role": "部长",
            "category": "学生组织",
            "start_date": "2019-09",
            "end_date": "2020-06",
            "achievements": ["负责校园活动报名系统维护"],
            "tags": ["学生干部"],
        }
    ],
    "project_experience": [],
    "skills": {
        "programming_languages": ["Go", "Python"],
        "frameworks": [],
        "databases": ["MySQL", "Redis"],
        "middleware": ["Kafka"],
        "cloud_native": ["Kubernetes"],
        "tools": [],
        "soft_skills": [],
    },
    "certifications": [],
    "languages": [
        {"language": "英语", "level": "六级", "score": "580"}
    ],
    "self_evaluation": "5年互联网后端开发经验",
    "facts": [
        {
            "key": "github_profile",
            "label": "GitHub",
            "value": "https://github.com/example",
            "normalized_value": "https://github.com/example",
            "value_type": "url",
            "scope": "profile",
            "source_path": None,
            "source_text": "GitHub: https://github.com/example",
            "confidence": 0.95,
            "sensitivity": "none",
            "reuse_likelihood": "high",
        }
    ],
}


SAMPLE_FILL_PLAN = {
    "filled": {
        "name": {
            "value": "张三",
            "confidence": 1.0,
            "reasoning": "直接来自简历 basic_info.name",
            "source": "basic_info.name",
        },
        "phone": {
            "value": "13800138000",
            "confidence": 1.0,
            "reasoning": "直接来自简历 basic_info.phone",
            "source": "basic_info.phone",
        },
        "email": {
            "value": "zhangsan@example.com",
            "confidence": 1.0,
            "reasoning": "直接来自简历",
            "source": "basic_info.email",
        },
    },
    "needs_user_input": ["height", "weight"],
    "warnings": [],
}
