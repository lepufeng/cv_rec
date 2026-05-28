"""Stage-B contract: form fields in, intelligent fill plan out."""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


FieldType = Literal[
    "text", "tel", "email", "number", "date", "url",
    "select", "radio", "checkbox", "textarea", "repeater", "file",
]
ThinkingMode = Literal["enabled", "disabled"]


class FormOption(BaseModel):
    """One selectable option reported by the browser extension."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    label: str
    value: str | None = None


class FormField(BaseModel):
    """One form field declared by the browser extension."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    fieldId: str = Field(validation_alias=AliasChoices("fieldId", "id"))
    label: str
    type: FieldType = "text"
    options: list[str | FormOption] | None = None        # for select/radio/checkbox
    required: bool = False
    subFields: list["FormField"] | None = Field(
        default=None,
        validation_alias=AliasChoices("sub_fields", "subFields"),
    )  # for repeater
    maxLength: int | None = Field(
        default=None,
        validation_alias=AliasChoices("max_length", "maxLength"),
    )
    placeholder: str | None = None

    # Plugin v2 metadata. These fields are semantic hints for the model and
    # later execution engine; they are not DOM selectors.
    widget: str | None = None
    enumerable: bool | None = None
    section: str | None = None
    sectionPath: list[str] | None = Field(
        default=None,
        validation_alias=AliasChoices("section_path", "sectionPath"),
    )
    subLabel: str | None = Field(
        default=None,
        validation_alias=AliasChoices("sub_label", "subLabel"),
    )
    groupId: str | None = Field(
        default=None,
        validation_alias=AliasChoices("group_id", "groupId"),
    )
    groupSize: int | None = Field(
        default=None,
        validation_alias=AliasChoices("group_size", "groupSize"),
    )
    groupIndex: int | None = Field(
        default=None,
        validation_alias=AliasChoices("group_index", "groupIndex"),
    )
    fieldFingerprint: str | None = Field(
        default=None,
        validation_alias=AliasChoices("field_fingerprint", "fieldFingerprint"),
    )
    frameUrl: str | None = Field(
        default=None,
        validation_alias=AliasChoices("frame_url", "frameUrl"),
    )
    frameIndex: int | None = Field(
        default=None,
        validation_alias=AliasChoices("frame_index", "frameIndex"),
    )
    htmlType: str | None = Field(
        default=None,
        validation_alias=AliasChoices("html_type", "htmlType"),
    )
    ariaLabel: str | None = Field(
        default=None,
        validation_alias=AliasChoices("aria_label", "ariaLabel"),
    )
    autocomplete: str | None = None
    name: str | None = None
    currentValue: str | None = Field(
        default=None,
        validation_alias=AliasChoices("current_value", "currentValue"),
    )
    visible: bool | None = None
    disabled: bool | None = None
    readonly: bool | None = None
    pattern: str | None = None
    min: str | None = Field(default=None, validation_alias=AliasChoices("min_value", "min"))
    max: str | None = Field(default=None, validation_alias=AliasChoices("max_value", "max"))
    order: int | None = None
    isMultiselect: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("is_multiselect", "isMultiselect", "isMultiSelect"),
    )
    isSearchableSelect: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("is_searchable_select", "isSearchableSelect"),
    )
    optionObjects: list[FormOption] | None = Field(
        default=None,
        validation_alias=AliasChoices("option_objects", "optionObjects"),
    )

    @model_validator(mode="after")
    def _ensure_field_fingerprint(self) -> "FormField":
        if self.fieldFingerprint:
            return self
        payload: dict[str, Any] = {
            "label": self.label,
            "type": self.type,
            "widget": self.widget,
            "section": self.section,
            "sectionPath": self.sectionPath,
            "placeholder": self.placeholder,
            "subLabel": self.subLabel,
            "groupIndex": self.groupIndex,
            "groupSize": self.groupSize,
            "options": [_option_fingerprint_part(o) for o in (self.options or [])],
        }
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        self.fieldFingerprint = "ff_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
        return self


FormField.model_rebuild()


class FillPlanRequest(BaseModel):
    """Payload from the extension."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    resumeId: str | None = Field(
        default=None,
        validation_alias=AliasChoices("resumeId", "resume_id"),
    )  # if None, server uses user's default
    url: str = Field(validation_alias=AliasChoices("url", "site_url"))
    fields: list[FormField] = Field(validation_alias=AliasChoices("fields", "form_fields"))
    user_overrides: dict[str, str] = Field(default_factory=dict)
    id: str | None = Field(default=None, validation_alias=AliasChoices("id", "scan_id"))
    title: str | None = Field(default=None, validation_alias=AliasChoices("title", "page_title"))
    fieldCount: int | None = Field(default=None, validation_alias=AliasChoices("fieldCount", "field_count"))
    frames: list[dict[str, Any]] | None = None
    thinkingMode: ThinkingMode | None = Field(
        default=None,
        validation_alias=AliasChoices("thinkingMode", "thinking_mode"),
    )


class FilledField(BaseModel):
    """Per-field outcome from the LLM."""

    model_config = ConfigDict(extra="ignore")

    value: str | list[dict] | None
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    source: str = ""


class FillPlanResponse(BaseModel):
    """API response for POST /fill-plans."""

    plan_id: str
    filled: dict[str, FilledField] = Field(default_factory=dict)
    needs_user_input: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    cache_hit: bool = False
    model_used: str | None = None
    cost_cny: Decimal | None = None


class PluginMatchResponse(FillPlanResponse):
    """Chrome-extension friendly response shape.

    The current teammate extension can execute a simple
    `{ fieldId: value }` mapping. Keep the richer `filled` object for debug
    and future feedback, while exposing `mappings` for the MVP executor.
    """

    mappings: dict[str, Any] = Field(default_factory=dict)
    skipped: list[str] = Field(default_factory=list)
    sectionActions: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def from_fill_plan(cls, plan: FillPlanResponse) -> "PluginMatchResponse":
        mappings: dict[str, Any] = {}
        skipped = list(plan.needs_user_input)

        for field_id, filled in plan.filled.items():
            if field_id in plan.needs_user_input:
                continue
            if filled.value is None:
                skipped.append(field_id)
                continue
            mappings[field_id] = filled.value

        return cls(
            plan_id=plan.plan_id,
            filled=plan.filled,
            needs_user_input=plan.needs_user_input,
            warnings=plan.warnings,
            cache_hit=plan.cache_hit,
            model_used=plan.model_used,
            cost_cny=plan.cost_cny,
            mappings=mappings,
            skipped=list(dict.fromkeys(skipped)),
            sectionActions={},
        )


class PluginScanResponse(BaseModel):
    """Lightweight acknowledgement for extension scan uploads."""

    id: str
    path: str | None = None
    fieldCount: int
    warnings: list[str] = Field(default_factory=list)


class FillPlanLLMOutput(BaseModel):
    """Schema we expect from the LLM. Used for validation before persisting."""

    model_config = ConfigDict(extra="ignore")

    filled: dict[str, FilledField] = Field(default_factory=dict)
    needs_user_input: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def _option_fingerprint_part(option: str | FormOption) -> str | dict[str, str | None]:
    if isinstance(option, FormOption):
        return option.model_dump(mode="json", exclude_none=True)
    return option
