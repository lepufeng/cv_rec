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
FillActionType = Literal[
    "set_text",
    "select_option",
    "set_date",
    "check",
    "upload_file",
    "needs_user_input",
]
SectionActionType = Literal["add_repeat_items"]


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
    repeatGroupId: str | None = Field(
        default=None,
        validation_alias=AliasChoices("repeat_group_id", "repeatGroupId"),
    )
    repeatIndex: int | None = Field(
        default=None,
        validation_alias=AliasChoices("repeat_index", "repeatIndex"),
    )
    repeatSize: int | None = Field(
        default=None,
        validation_alias=AliasChoices("repeat_size", "repeatSize"),
    )
    repeatSection: str | None = Field(
        default=None,
        validation_alias=AliasChoices("repeat_section", "repeatSection"),
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
            "repeatIndex": self.repeatIndex,
            "repeatSize": self.repeatSize,
            "repeatSection": self.repeatSection,
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
    sections: list[dict[str, Any]] | None = None
    forceRefresh: bool = Field(
        default=False,
        validation_alias=AliasChoices("forceRefresh", "force_refresh"),
    )
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


class FillAction(BaseModel):
    """Typed execution step for the browser extension."""

    model_config = ConfigDict(extra="ignore")

    fieldId: str
    actionType: FillActionType
    value: Any = None
    label: str | None = None
    fieldType: str | None = None
    widget: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    source: str = ""
    reasoning: str = ""


class SectionAction(BaseModel):
    """Typed dynamic-section expansion step for repeated experiences."""

    model_config = ConfigDict(extra="ignore")

    sectionName: str
    actionType: SectionActionType = "add_repeat_items"
    sectionKey: str
    currentCount: int = Field(ge=0)
    targetCount: int = Field(ge=0)
    addCount: int = Field(ge=0)
    legacyAction: str


class PluginMatchResponse(FillPlanResponse):
    """Chrome-extension friendly response shape.

    The current teammate extension can execute a simple
    `{ fieldId: value }` mapping. Keep the richer `filled` object for debug
    and future feedback, while exposing `mappings` for the MVP executor.
    """

    mappings: dict[str, Any] = Field(default_factory=dict)
    actions: list[FillAction] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    sectionActions: dict[str, str] = Field(default_factory=dict)
    sectionActionDetails: list[SectionAction] = Field(default_factory=list)

    @classmethod
    def from_fill_plan(
        cls,
        plan: FillPlanResponse,
        fields: list[FormField] | None = None,
        section_actions: dict[str, str] | None = None,
        section_action_details: list[SectionAction] | None = None,
    ) -> "PluginMatchResponse":
        mappings: dict[str, Any] = {}
        skipped = list(plan.needs_user_input)
        actions: list[FillAction] = []
        fields_by_id = {field.fieldId: field for field in (fields or [])}
        ordered_ids = [field.fieldId for field in (fields or [])]
        ordered_ids.extend(field_id for field_id in plan.filled if field_id not in ordered_ids)
        ordered_ids.extend(field_id for field_id in plan.needs_user_input if field_id not in ordered_ids)

        for field_id, filled in plan.filled.items():
            if field_id in plan.needs_user_input:
                continue
            if filled.value is None:
                skipped.append(field_id)
                continue
            mappings[field_id] = filled.value

        for field_id in dict.fromkeys(ordered_ids):
            field = fields_by_id.get(field_id)
            filled = plan.filled.get(field_id)
            needs_input = field_id in plan.needs_user_input or filled is None or filled.value is None
            actions.append(_fill_action_for_field(field_id, field, filled, needs_input))

        return cls(
            plan_id=plan.plan_id,
            filled=plan.filled,
            needs_user_input=plan.needs_user_input,
            warnings=plan.warnings,
            cache_hit=plan.cache_hit,
            model_used=plan.model_used,
            cost_cny=plan.cost_cny,
            mappings=mappings,
            actions=actions,
            skipped=list(dict.fromkeys(skipped)),
            sectionActions=section_actions or {},
            sectionActionDetails=section_action_details or [],
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


def _fill_action_for_field(
    field_id: str,
    field: FormField | None,
    filled: FilledField | None,
    needs_input: bool,
) -> FillAction:
    if needs_input:
        return FillAction(
            fieldId=field_id,
            actionType="needs_user_input",
            value=None,
            label=field.label if field else None,
            fieldType=field.type if field else None,
            widget=field.widget if field else None,
            confidence=filled.confidence if filled else None,
            source=filled.source if filled else "",
            reasoning=filled.reasoning if filled and filled.reasoning else "需要用户确认",
        )

    assert filled is not None
    return FillAction(
        fieldId=field_id,
        actionType=_infer_action_type(field),
        value=filled.value,
        label=field.label if field else None,
        fieldType=field.type if field else None,
        widget=field.widget if field else None,
        confidence=filled.confidence,
        source=filled.source,
        reasoning=filled.reasoning,
    )


def _infer_action_type(field: FormField | None) -> FillActionType:
    if field is None:
        return "set_text"

    field_type = str(field.type or "").casefold()
    widget = str(field.widget or "").casefold()
    if field_type == "file" or widget == "file-upload":
        return "upload_file"
    if field_type == "date" or widget in {"date-picker", "date-range"}:
        return "set_date"
    if field_type == "checkbox":
        return "check"
    if (
        field_type in {"select", "radio"}
        or widget in {"native-select", "aria-combobox", "custom-dropdown", "search-select", "cascader", "pseudo-radio"}
    ):
        return "select_option"
    return "set_text"
