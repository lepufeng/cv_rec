"""Structured resume schema (the contract with the browser extension).

This is the canonical shape returned by Stage A and consumed by Stage B.
Keep changes backward-compatible by bumping `schema_version` on breaking
modifications.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SCHEMA_VERSION = "1.6"

Gender = Literal["男", "女", "其他"]
MaritalStatus = Literal["未婚", "已婚", "离异", "其他"]
Degree = Literal["大专", "本科", "硕士", "博士", "其他"]
SectionStyle = Literal["pills", "list", "text"]
FactScope = Literal[
    "profile",
    "basic_info",
    "job_intent",
    "education",
    "internship_experience",
    "work_experience",
    "campus_experience",
    "project_experience",
    "skills",
    "certifications",
    "languages",
    "other",
]
FactValueType = Literal[
    "text",
    "number",
    "date",
    "boolean",
    "url",
    "list",
    "duration",
    "money",
    "location",
    "unknown",
]
FactSensitivity = Literal["none", "low", "sensitive"]
FactReuseLikelihood = Literal["high", "medium", "low"]


_VALID_GENDERS = {"男", "女", "其他"}
_VALID_MARITAL = {"未婚", "已婚", "离异", "其他"}
_VALID_DEGREES = {"大专", "本科", "硕士", "博士", "其他"}


# ---------------- value cleaning helpers ----------------

import re

_DIGITS_RE = re.compile(r"\D+")
_RANK_FRACTION_RE = re.compile(r"(?P<rank>\d+)\s*/\s*(?P<total>\d+)")
_RANK_PERCENTILE_RE = re.compile(r"(前\s*\d+(?:\.\d+)?\s*%|top\s*\d+(?:\.\d+)?\s*%)", re.IGNORECASE)
_RANK_CONTEXT_MARKERS = ("专业排名", "班级排名", "年级排名", "学院排名", "综合排名")


def _clean_phone(value):
    """Normalize a phone string to a clean Chinese mobile number.

    Rules:
    - Strip all non-digits (spaces, hyphens, parentheses, leading +).
    - Drop leading "86" country code if the resulting length would otherwise be 13.
    - If the cleaned form is exactly 11 digits and starts with 1, return it.
    - Otherwise return the cleaned digit string anyway (so users can see and fix
      the OCR drift), but mark it as needing review via `_phone_invalid`.
    The validator below also returns None if the input is empty.
    """
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        value = str(value)
    digits = _DIGITS_RE.sub("", value)
    # Strip +86 / 86 country code
    if len(digits) == 13 and digits.startswith("86"):
        digits = digits[2:]
    return digits or None


def is_valid_cn_mobile(digits: str | None) -> bool:
    return bool(digits) and len(digits) == 11 and digits.startswith("1")


def _coerce_to_other(value, allowed: set[str]):
    """If the value isn't recognized, fall back to '其他' so a single rogue
    enum value from the LLM doesn't poison the entire parse."""
    if value is None or value == "":
        return None
    if isinstance(value, str) and value in allowed:
        return value
    return "其他"


# Quote characters the model occasionally wraps list items with.
# Includes ASCII single/double, CJK double/single, Japanese kakko, and a few others.
_WRAPPING_QUOTES = "\"'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u00ab\u00bb"


def _strip_wrapping_quotes(items: list[str]) -> list[str]:
    """Clean stray quote characters introduced by vision-model OCR drift.

    Two passes:
    1. Peel matched outer quote pairs (handles "'校级一等奖学金'" → "校级一等奖学金").
    2. Strip any remaining ASCII straight quotes when they appear in matched
       pairs inside the string (handles "2024-2025学年'校级三好学生奖学金'"
       where a year prefix sits outside the inner quote pair). We only do
       this for ASCII straight quotes — CJK quotation marks are usually
       intentional content and should be preserved.
    """
    cleaned: list[str] = []
    for raw in items:
        if not isinstance(raw, str):
            cleaned.append(raw)
            continue
        s = raw.strip()
        # Pass 1: peel matched outer pairs
        while len(s) >= 2 and s[0] in _WRAPPING_QUOTES and s[-1] in _WRAPPING_QUOTES:
            if (s[0], s[-1]) in {
                ("'", "'"), ('"', '"'),
                ("\u201c", "\u201d"), ("\u2018", "\u2019"),
                ("\u300c", "\u300d"), ("\u300e", "\u300f"),
                ("\u00ab", "\u00bb"),
            }:
                s = s[1:-1].strip()
            else:
                break
        # Pass 2: drop ASCII straight quotes that appear in even count
        # (clearly an OCR artifact rather than apostrophes in real content).
        for q in ("'", '"'):
            if s.count(q) >= 2 and s.count(q) % 2 == 0:
                s = s.replace(q, "")
        cleaned.append(s.strip())
    return cleaned


# Phrases that should never appear as items inside `honors` — they are
# academic metrics, not awards. The model occasionally smuggles them in to
# "fill" the field; we strip them so the UI doesn't display them as honors.
_HONORS_BLACKLIST_PREFIXES = (
    "GPA",
    "gpa",
    "绩点",
    "成绩",
    "排名",
    "班级排名",
    "年级排名",
    "Rank",
    "rank",
)


def _filter_honors(items: list[str]) -> list[str]:
    """Drop entries that clearly aren't honors (GPA, ranks, etc.)."""
    out: list[str] = []
    for raw in items:
        if not isinstance(raw, str):
            out.append(raw)
            continue
        s = raw.strip()
        if not s:
            continue
        if any(s.startswith(prefix) for prefix in _HONORS_BLACKLIST_PREFIXES):
            continue
        out.append(s)
    return out


_TECH_STACK_BLACKLIST_EXACT = {
    "stacking",
    "stacking集成学习",
    "boosting",
    "rfm",
    "rfm模型",
    "k-means",
    "k-means聚类算法",
    "holt-winters",
    "holt-winters模型",
    "bi-lstm",
    "attention",
    "注意力机制",
    "linear regression",
    "logistic regression",
    "xgboost",
    "random forest",
    "deep neural network",
    "rmse",
    "loss",
    "recall",
    "precision",
    "f1",
    "auc",
    "pems08",
    "validation集",
    "latam",
    "central区域",
    "deepseek api",
}

_TECH_STACK_BLACKLIST_KEYWORDS = (
    "算法",
    "模型",
    "机制",
    "损失函数",
    "验证集",
    "数据集",
    "市场",
    "区域",
)

_PROJECT_EXTRA_SECTION_BLACKLIST_TITLES = {
    "算法",
    "算法与方法",
    "算法方法",
    "方法",
    "模型",
    "模型与算法",
    "评估指标",
    "指标",
    "数据集",
    "数据来源",
    "验证集",
    "市场",
    "区域",
    "技术",
    "技术栈",
    "工具",
}

_FACT_KEY_RE = re.compile(r"[^a-z0-9_]+")


def _filter_tech_stack(items: list[str]) -> list[str]:
    """Keep tech stack focused on languages, packages, frameworks and tooling."""
    out: list[str] = []
    for raw in items:
        if not isinstance(raw, str):
            out.append(raw)
            continue
        s = raw.strip()
        if not s:
            continue
        lower = s.lower()
        if lower in _TECH_STACK_BLACKLIST_EXACT:
            continue
        if any(keyword in s for keyword in _TECH_STACK_BLACKLIST_KEYWORDS):
            continue
        if lower.endswith(" api"):
            continue
        out.append(s)
    return out


def _filter_project_extra_sections(sections: list["ExtraSection"]) -> list["ExtraSection"]:
    """Drop project sections that are usually keyword extraction duplicates."""
    out: list[ExtraSection] = []
    for section in sections:
        title = section.title.strip()
        if title in _PROJECT_EXTRA_SECTION_BLACKLIST_TITLES:
            continue
        out.append(section)
    return out


def _normalize_fact_key(value: str | None) -> str | None:
    if value is None:
        return None
    key = value.strip().lower().replace("-", "_").replace(" ", "_")
    key = _FACT_KEY_RE.sub("_", key).strip("_")
    return key or None


class _Strict(BaseModel):
    """Strict base: forbid extras to catch model drift early."""
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class ExtraSection(_Strict):
    """Open-ended sub-section that the model can attach to any container.

    Used when the resume contains content that doesn't fit any standard
    field. The model picks the title, suggests a render style, and lists
    the items. Stage B later matches these against form labels semantically,
    so they fully participate in smart form-filling.
    """
    title: str               # 简短中文标题, 2-8 字
    style: SectionStyle = "list"
    items: list[str] = Field(default_factory=list)

    @field_validator("style", mode="before")
    @classmethod
    def _coerce_style(cls, v):
        # If the model invents an unknown style (eg "table", "grid"),
        # fall back to "list" so we don't reject the entire payload.
        if v in {"pills", "list", "text"}:
            return v
        return "list"

    @field_validator("items", mode="after")
    @classmethod
    def _clean_items(cls, v):
        return _strip_wrapping_quotes(v)


class ResumeFact(_Strict):
    """Atomic reusable information discovered from the resume.

    Facts preserve long-tail content that does not deserve a permanent schema
    field yet, while still making it available for semantic form filling.
    """

    key: str | None = None
    label: str
    value: str
    normalized_value: str | int | float | bool | list[str] | None = None
    value_type: FactValueType = "text"
    scope: FactScope = "profile"
    source_path: str | None = None
    source_text: str | None = None
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    sensitivity: FactSensitivity = "none"
    reuse_likelihood: FactReuseLikelihood = "medium"

    @field_validator("key", mode="before")
    @classmethod
    def _clean_key(cls, v):
        if v is None:
            return None
        return _normalize_fact_key(str(v))

    @field_validator("label", "value", mode="before")
    @classmethod
    def _stringify_required_text(cls, v):
        if v is None:
            return ""
        return str(v).strip()


class BasicInfo(_Strict):
    name: str | None = None
    gender: Gender | None = None
    birth_date: str | None = None      # YYYY-MM-DD
    age: int | None = None
    phone: str | None = None
    email: str | None = None
    location: str | None = None        # 现居
    hometown: str | None = None        # 籍贯
    marital_status: MaritalStatus | None = None
    political_status: str | None = None
    ethnicity: str | None = None
    id_card: str | None = None
    # Warnings populated by validators when something looks off (e.g. phone
    # not 11 digits, name only 1 character). Surfaced to the UI so users know
    # which fields to double-check. Not consumed by browser-extension fill flow.
    parse_warnings: list[str] = Field(default_factory=list)

    @field_validator("gender", mode="before")
    @classmethod
    def _coerce_gender(cls, v):
        return _coerce_to_other(v, _VALID_GENDERS)

    @field_validator("marital_status", mode="before")
    @classmethod
    def _coerce_marital(cls, v):
        return _coerce_to_other(v, _VALID_MARITAL)

    @field_validator("phone", mode="before")
    @classmethod
    def _normalize_phone(cls, v):
        # Always reduce to digits; the model_validator below decides whether
        # to keep it on phone or move it to parse_warnings.
        return _clean_phone(v)

    @model_validator(mode="after")
    def _post_check(self):
        warnings: list[str] = []
        if self.phone is not None and not is_valid_cn_mobile(self.phone):
            warnings.append(
                f"phone:识别结果为 {self.phone}，不是 11 位中国大陆手机号，请确认"
            )
        if self.name is not None and len(self.name.strip()) <= 1:
            warnings.append(
                f"name:识别结果为 {self.name}，长度过短，可能识别不完整，请确认"
            )
        if warnings:
            self.parse_warnings = warnings
        return self


class JobIntent(_Strict):
    target_position: str | None = None
    expected_salary: str | None = None
    available_date: str | None = None
    work_location_preference: list[str] = Field(default_factory=list)


class AcademicRanking(_Strict):
    raw: str | None = None
    rank: int | None = None
    total: int | None = None
    percentile: str | None = None
    context: str | None = None

    @model_validator(mode="after")
    def _normalize(self):
        if self.raw:
            raw = self.raw.strip()
            self.raw = raw or None
            if self.rank is None or self.total is None:
                match = _RANK_FRACTION_RE.search(raw)
                if match:
                    self.rank = self.rank or int(match.group("rank"))
                    self.total = self.total or int(match.group("total"))
            if self.percentile is None:
                match = _RANK_PERCENTILE_RE.search(raw)
                if match:
                    self.percentile = match.group(1).replace(" ", "")
            if self.context is None:
                for marker in _RANK_CONTEXT_MARKERS:
                    if marker in raw:
                        self.context = marker
                        break
        if self.context and not any(marker in self.context for marker in _RANK_CONTEXT_MARKERS):
            self.context = None
        if self.raw is None and self.rank is not None and self.total is not None:
            self.raw = f"{self.rank}/{self.total}"
        return self


class Education(_Strict):
    school: str
    degree: Degree | None = None
    major: str | None = None
    start_date: str | None = None      # YYYY-MM
    end_date: str | None = None
    gpa: str | None = None             # raw string, no normalization
    ranking: AcademicRanking | None = None
    honors: list[str] = Field(default_factory=list)
    courses: list[str] = Field(default_factory=list)
    extra_sections: list[ExtraSection] = Field(default_factory=list)

    @field_validator("degree", mode="before")
    @classmethod
    def _coerce_degree(cls, v):
        return _coerce_to_other(v, _VALID_DEGREES)

    @field_validator("ranking", mode="before")
    @classmethod
    def _coerce_ranking(cls, v):
        if v in (None, "", {}):
            return None
        if isinstance(v, str):
            return {"raw": v}
        return v

    @field_validator("honors", mode="after")
    @classmethod
    def _clean_honors(cls, v):
        return _filter_honors(_strip_wrapping_quotes(v))

    @field_validator("courses", mode="after")
    @classmethod
    def _clean_courses(cls, v):
        return _strip_wrapping_quotes(v)


class WorkExperience(_Strict):
    company: str
    department: str | None = None
    title: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    achievements: list[str] = Field(default_factory=list)
    tech_stack: list[str] = Field(default_factory=list)
    extra_sections: list[ExtraSection] = Field(default_factory=list)

    @field_validator("achievements", mode="after")
    @classmethod
    def _clean_lists(cls, v):
        return _strip_wrapping_quotes(v)

    @field_validator("tech_stack", mode="after")
    @classmethod
    def _clean_tech_stack(cls, v):
        return _filter_tech_stack(_strip_wrapping_quotes(v))


class InternshipExperience(WorkExperience):
    """Student internship experience; shape intentionally mirrors work entries."""


class CampusExperience(_Strict):
    organization: str
    department: str | None = None
    role: str | None = None
    category: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    achievements: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    extra_sections: list[ExtraSection] = Field(default_factory=list)

    @field_validator("achievements", "tags", mode="after")
    @classmethod
    def _clean_lists(cls, v):
        return _strip_wrapping_quotes(v)


class ProjectExperience(_Strict):
    name: str
    role: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    description: str | None = None
    achievements: list[str] = Field(default_factory=list)
    extra_sections: list[ExtraSection] = Field(default_factory=list)

    @field_validator("achievements", mode="after")
    @classmethod
    def _clean_lists(cls, v):
        return _strip_wrapping_quotes(v)

    @field_validator("tech_stack", mode="after")
    @classmethod
    def _clean_tech_stack(cls, v):
        return _filter_tech_stack(_strip_wrapping_quotes(v))

    @field_validator("extra_sections", mode="after")
    @classmethod
    def _clean_extra_sections(cls, v):
        return _filter_project_extra_sections(v)


class Skills(_Strict):
    programming_languages: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    databases: list[str] = Field(default_factory=list)
    middleware: list[str] = Field(default_factory=list)
    cloud_native: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    soft_skills: list[str] = Field(default_factory=list)

    @field_validator("tools", mode="after")
    @classmethod
    def _clean_tools(cls, v):
        return _strip_wrapping_quotes(v)


class Certification(_Strict):
    name: str
    issuer: str | None = None
    date: str | None = None


class Language(_Strict):
    language: str
    level: str | None = None
    score: str | None = None


class ResumeData(_Strict):
    """Top-level structured resume payload."""

    schema_version: str = SCHEMA_VERSION
    basic_info: BasicInfo = Field(default_factory=BasicInfo)
    job_intent: JobIntent | None = None
    education: list[Education] = Field(default_factory=list)
    internship_experience: list[InternshipExperience] = Field(default_factory=list)
    work_experience: list[WorkExperience] = Field(default_factory=list)
    campus_experience: list[CampusExperience] = Field(default_factory=list)
    project_experience: list[ProjectExperience] = Field(default_factory=list)
    skills: Skills = Field(default_factory=Skills)
    certifications: list[Certification] = Field(default_factory=list)
    languages: list[Language] = Field(default_factory=list)
    self_evaluation: str | None = None
    facts: list[ResumeFact] = Field(default_factory=list)
    extra_sections: list[ExtraSection] = Field(default_factory=list)

    @field_validator("facts", mode="after")
    @classmethod
    def _drop_empty_facts(cls, v):
        return [fact for fact in v if fact.label and fact.value]
