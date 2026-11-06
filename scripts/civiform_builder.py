#!/usr/bin/env python3
"""
CiviForm Deterministic Program Builder SDK (`civiform_builder.py`)

Provides type-safe Python helper functions and a Standard Universal/PAI Question Bank
for compiling CiviForm Program Migration JSON files (`ProgramMigrationWrapper`) that
are 100% compliant with CiviForm's Jackson & AutoValue models on the first pass.

Key Guardrails Built In:
1. Enforces `^[a-z0-9-]+$` on program `adminName` and `^[a-z0-9_]+$` on question `config.name`.
2. Enforces `<= 100` character limit on `localizedShortDescription`.
3. Automatically strips redundant `"Screen N:"` / `"Step N:"` prefixes from block titles.
4. Enforces `addressCorrectionEnabled: false` by default (preventing ESRI runtime exceptions).
5. Automatically converts option `adminName` strings or integer indices into stringified numeric
   option IDs (`"[\"0\", \"1\"]"`) in `SELECTION` predicates (preventing `NumberFormatException` on publish).
6. Enforces Single-Question `LEAF_OPERATION` eligibility predicates on blocks.
7. Provides `StandardQuestionBank` with Universal & Primary Applicant Info (PAI) tags (`APPLICANT_NAME`,
   `APPLICANT_DOB`, `APPLICANT_EMAIL`, `APPLICANT_PHONE`) so guest submissions never show `<Unnamed User>`.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from validate_civiform_json import validate_multi_program_suite, validate_single_program

SCREEN_PREFIX_RE = re.compile(r"^\s*(?:Screen|Step)\s+\d+\s*[:\-–—]\s*", re.IGNORECASE)
DIGIT_TO_ALPHA_WORD = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}


def sanitize_question_admin_name(raw_name: str) -> str:
    """
    Sanitizes a question Admin ID (`config.name`) so that digits are converted to alphabetic
    words (`_p1_` -> `_pa_`, `_p2_` -> `_pb_`, `1` -> `one`, `2` -> `two`, etc.).
    CiviForm's `QuestionDefinition.getQuestionNameKey()` strips all non-letter characters
    (`[^a-zA-Z]`), so numeric differentiators like `_p1_` vs `_p2_` or `_1_` vs `_2_`
    compile to the exact same Question Key and fail on import.
    """
    s = str(raw_name or "").lower()
    s = re.sub(r"(^|_)p1(?=_|$)", r"\1pa", s)
    s = re.sub(r"(^|_)p2(?=_|$)", r"\1pb", s)
    s = re.sub(r"\d", lambda m: f"_{DIGIT_TO_ALPHA_WORD[m.group(0)]}_", s)
    s = re.sub(r"[^a-z_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "cf_question"


def make_localized(
    en_text: str,
    extra_translations: Optional[Dict[str, str]] = None,
    is_required: bool = True,
) -> Dict[str, Any]:
    """Creates a CiviForm LocalizedStrings dictionary."""
    translations: Dict[str, str] = {"en_US": en_text}
    if extra_translations:
        translations.update(extra_translations)
    obj: Dict[str, Any] = {"translations": translations}
    if is_required:
        obj["isRequired"] = True
    return obj


def q_simple(
    q_id: int,
    q_type: str,
    admin_name: str,
    description: str,
    question_text: str,
    help_text: str = "",
    validation_predicates: Optional[Dict[str, Any]] = None,
    universal: bool = False,
    pai_tags: Optional[List[str]] = None,
    extra_question_translations: Optional[Dict[str, str]] = None,
    extra_help_translations: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Constructs a standard CiviForm non-multioption QuestionDefinition."""
    vp = dict(validation_predicates) if validation_predicates is not None else {"type": q_type}
    vp["type"] = q_type
    clean_admin_name = sanitize_question_admin_name(admin_name)
    return {
        "type": q_type,
        "config": {
            "name": clean_admin_name,
            "description": description,
            "questionText": make_localized(question_text, extra_question_translations),
            "questionHelpText": (
                make_localized(help_text, extra_help_translations, is_required=False)
                if help_text
                else {"translations": {}}
            ),
            "validationPredicates": vp,
            "id": q_id,
            "universal": universal,
            "primaryApplicantInfoTags": list(pai_tags) if pai_tags else [],
            "displayMode": "VISIBLE",
        },
    }


def _extract_option_tuple(
    raw_opt: Any, idx: int
) -> Tuple[str, str, Optional[Dict[str, str]]]:
    """Normalizes a string, dict, or tuple option into (admin_name, label, extra_translations)."""
    if isinstance(raw_opt, str):
        label = raw_opt.strip()
        admin = re.sub(r"[^a-z0-9_]+", "_", label.lower()).strip("_") or f"option_{idx + 1}"
        return admin, label, None
    if isinstance(raw_opt, dict):
        label = str(
            raw_opt.get("label")
            or raw_opt.get("text")
            or raw_opt.get("optionText")
            or (raw_opt.get("localizedOptionText", {}).get("translations", {}).get("en_US"))
            or raw_opt.get("name")
            or raw_opt.get("value")
            or raw_opt.get("adminName")
            or f"Option {idx + 1}"
        ).strip()
        raw_admin = str(raw_opt.get("adminName") or raw_opt.get("id") or label)
        admin = re.sub(r"[^a-z0-9_]+", "_", raw_admin.lower()).strip("_") or f"option_{idx + 1}"
        if re.match(r"^[0-9]", admin):
            admin = f"opt_{admin}"
        return admin, label, None
    if isinstance(raw_opt, (tuple, list)) and len(raw_opt) >= 2:
        opt_admin = re.sub(r"[^a-z0-9_]+", "_", str(raw_opt[0]).lower()).strip("_") or f"option_{idx + 1}"
        opt_label = str(raw_opt[1]).strip() or f"Option {idx + 1}"
        opt_extra = raw_opt[2] if len(raw_opt) > 2 else None
        return opt_admin, opt_label, opt_extra
    label = str(raw_opt).strip() or f"Option {idx + 1}"
    admin = re.sub(r"[^a-z0-9_]+", "_", label.lower()).strip("_") or f"option_{idx + 1}"
    return admin, label, None


def q_multioption(
    q_id: int,
    multi_type: str,  # "RADIO_BUTTON", "CHECKBOX", or "DROPDOWN"
    admin_name: str,
    description: str,
    question_text: str,
    options: Sequence[Union[str, Dict[str, Any], Tuple[str, str], Tuple[str, str, Dict[str, str]]]],
    help_text: str = "",
    min_choices: Optional[int] = None,
    max_choices: Optional[int] = None,
    extra_question_translations: Optional[Dict[str, str]] = None,
    extra_help_translations: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Constructs a CiviForm multioption QuestionDefinition with unique option labels, adminNames, and 0-indexed numeric option IDs."""
    vp: Dict[str, Any] = {"type": "multioption"}
    if min_choices is not None:
        vp["minChoicesRequired"] = min_choices
    if max_choices is not None:
        vp["maxChoicesAllowed"] = max_choices

    question_options = []
    seen_admins: set = set()
    seen_labels: set = set()
    for raw_idx, raw_opt in enumerate(options):
        opt_admin, opt_label, opt_extra = _extract_option_tuple(raw_opt, raw_idx)
        if "[object Object]" in opt_label or opt_admin.startswith("object_object"):
            continue
        if opt_label.lower() in seen_labels:
            continue
        seen_labels.add(opt_label.lower())

        unique_admin = opt_admin
        suffix = 2
        while unique_admin.lower() in seen_admins:
            unique_admin = f"{opt_admin}_{suffix}"
            suffix += 1
        seen_admins.add(unique_admin.lower())

        out_idx = len(question_options)
        question_options.append(
            {
                "id": out_idx,
                "adminName": unique_admin,
                "localizedOptionText": make_localized(opt_label, opt_extra),
                "displayInAnswerOptions": True,
                "displayOrder": out_idx,
            }
        )

    clean_admin_name = sanitize_question_admin_name(admin_name)
    return {
        "type": "multioption",
        "config": {
            "name": clean_admin_name,
            "description": description,
            "questionText": make_localized(question_text, extra_question_translations),
            "questionHelpText": (
                make_localized(help_text, extra_help_translations, is_required=False)
                if help_text
                else {"translations": {}}
            ),
            "validationPredicates": vp,
            "id": q_id,
            "universal": False,
            "primaryApplicantInfoTags": [],
            "displayMode": "VISIBLE",
        },
        "questionOptions": question_options,
        "multiOptionQuestionType": multi_type,
    }


# --- Predicate Builders ---


def _resolve_option_id_str(
    opt_ref: Union[int, str],
    question_obj: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Converts an option index (int or numeric str) or option adminName into a stringified
    numeric option ID ('0', '1', ...), preventing NumberFormatException on publish.
    """
    if isinstance(opt_ref, int):
        return str(opt_ref)
    if isinstance(opt_ref, str) and opt_ref.isdigit():
        return opt_ref
    if question_obj and question_obj.get("type") == "multioption":
        for opt in question_obj.get("questionOptions", []):
            if opt.get("adminName") == opt_ref:
                return str(opt["id"])
    raise ValueError(
        f"Cannot resolve option reference '{opt_ref}' to a numeric option ID. "
        "Pass integer option indices (0, 1, ...) or pass question_obj=<multioption_dict>."
    )


def leaf_selection_in(
    question_id: int,
    selected_options: Sequence[Union[int, str]],
    operator: str = "IN",
    question_obj: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Builds a LEAF_OPERATION ExpressionNode for a multioption SELECTION check using
    stringified numeric option IDs (e.g. '["0", "1"]').
    """
    if operator not in {"IN", "NOT_IN", "ANY_OF"}:
        raise ValueError(f"Unsupported SELECTION list operator '{operator}'.")
    numeric_ids = [_resolve_option_id_str(o, question_obj) for o in selected_options]
    return {
        "type": "LEAF_OPERATION",
        "node": {
            "type": "leaf",
            "questionId": question_id,
            "scalar": "SELECTION",
            "operator": operator,
            "value": {
                "value": json.dumps(numeric_ids),
                "type": "LIST_OF_STRINGS",
            },
        },
    }


def leaf_age_older_than(question_id: int, age_years: int) -> Dict[str, Any]:
    """Builds a LEAF_OPERATION ExpressionNode checking DATE AGE_OLDER_THAN `age_years`."""
    return {
        "type": "LEAF_OPERATION",
        "node": {
            "type": "leaf",
            "questionId": question_id,
            "scalar": "DATE",
            "operator": "AGE_OLDER_THAN",
            "value": {
                "value": str(age_years),
                "type": "LONG",
            },
        },
    }


def leaf_number_comparison(
    question_id: int,
    operator: str,  # "GREATER_THAN", "GREATER_THAN_OR_EQUAL_TO", "LESS_THAN", "LESS_THAN_OR_EQUAL_TO", "EQUAL_TO"
    value: int,
    scalar: str = "NUMBER",
) -> Dict[str, Any]:
    """Builds a LEAF_OPERATION ExpressionNode comparing a numeric or currency scalar."""
    return {
        "type": "LEAF_OPERATION",
        "node": {
            "type": "leaf",
            "questionId": question_id,
            "scalar": scalar,
            "operator": operator,
            "value": {
                "value": str(value),
                "type": "LONG",
            },
        },
    }


def make_hide_predicate(
    root_node: Dict[str, Any],
    action: str = "SHOW_BLOCK",
    predicate_format: str = "SINGLE_QUESTION",
) -> Dict[str, Any]:
    """Creates a BlockDefinition `hidePredicate` object."""
    return {
        "rootNode": root_node,
        "action": action,
        "predicateFormat": predicate_format,
    }


def make_single_question_eligibility(leaf_node: Dict[str, Any]) -> Dict[str, Any]:
    """
    Creates a BlockDefinition `eligibilityDefinition` scoped to a single primary gating
    question (`LEAF_OPERATION`) so CiviForm highlights only the failed question in the yellow alert.
    """
    if leaf_node.get("type") != "LEAF_OPERATION":
        raise ValueError(
            "Single-Question Eligibility Rule violation: eligibilityDefinition rootNode must be 'LEAF_OPERATION'."
        )
    return {
        "predicate": {
            "rootNode": leaf_node,
            "action": "ELIGIBLE_BLOCK",
            "predicateFormat": "SINGLE_QUESTION",
        }
    }


# --- Block & Program Builders ---


def make_block(
    block_id: int,
    name: str,
    description: str,
    question_ids: Sequence[int],
    optional_ids: Optional[Sequence[int]] = None,
    eligibility_definition: Optional[Dict[str, Any]] = None,
    hide_predicate: Optional[Dict[str, Any]] = None,
    eligibility_message: Optional[str] = None,
    extra_name_translations: Optional[Dict[str, str]] = None,
    extra_desc_translations: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Constructs a CiviForm BlockDefinition (Screen), automatically stripping any 'Screen N:'
    prefix and setting `addressCorrectionEnabled: False` for safety.
    """
    clean_name = SCREEN_PREFIX_RE.sub("", name).strip()
    opt_set = set(optional_ids or [])
    pqds = [
        {
            "id": qid,
            "optional": qid in opt_set,
            "addressCorrectionEnabled": False,
        }
        for qid in question_ids
    ]

    block_obj: Dict[str, Any] = {
        "id": block_id,
        "name": clean_name,
        "description": description,
        "localizedName": make_localized(clean_name, extra_name_translations),
        "localizedDescription": make_localized(description, extra_desc_translations),
        "repeaterId": None,
        "hidePredicate": hide_predicate,
        "optionalPredicate": None,
        "questionDefinitions": pqds,
        "eligibilityDefinition": eligibility_definition,
    }
    if eligibility_message:
        block_obj["localizedEligibilityMessage"] = make_localized(eligibility_message)
    return block_obj


def build_program_migration_wrapper(
    program_id: int,
    admin_name: str,
    admin_description: str,
    external_link: str,
    localized_name: str,
    localized_short_description: str,
    localized_description: str,
    localized_confirmation_message: str,
    application_steps: Sequence[Tuple[str, str]],
    block_definitions: Sequence[Dict[str, Any]],
    questions: Sequence[Dict[str, Any]],
    eligibility_is_gating: bool = False,
    display_mode: str = "PUBLIC",
    login_only: bool = False,
) -> Dict[str, Any]:
    """
    Constructs a complete CiviForm `ProgramMigrationWrapper` dictionary and validates it
    against all Jackson and UX rules.
    """
    if len(localized_short_description) > 100:
        raise ValueError(
            f"localizedShortDescription for '{admin_name}' is {len(localized_short_description)} chars (must be <= 100)."
        )

    steps_objs = [
        {
            "title": make_localized(title),
            "description": make_localized(desc),
        }
        for title, desc in application_steps
    ]

    wrapper = {
        "program": {
            "id": program_id,
            "adminName": admin_name,
            "adminDescription": admin_description,
            "externalLink": external_link,
            "displayMode": display_mode,
            "loginOnly": login_only,
            "notificationPreferences": ["EMAIL_PROGRAM_ADMIN_ALL_SUBMISSIONS"],
            "localizedName": make_localized(localized_name),
            "localizedShortDescription": make_localized(localized_short_description),
            "localizedDescription": make_localized(localized_description),
            "localizedConfirmationMessage": make_localized(localized_confirmation_message),
            "programType": "DEFAULT",
            "eligibilityIsGating": eligibility_is_gating,
            "acls": {"tiProgramViewAcls": []},
            "categories": [],
            "applicationSteps": steps_objs,
            "blockDefinitions": list(block_definitions),
            "bridgeDefinitions": {},
        },
        "questions": list(questions),
    }

    issues = validate_single_program(wrapper, admin_name)
    errors = [i for i in issues if i.severity == "ERROR"]
    if errors:
        err_text = "\n".join(str(e) for e in errors)
        raise ValueError(f"Validation failed while building '{admin_name}':\n{err_text}")

    return wrapper


# --- Standard Universal / PAI Question Bank ---


class StandardQuestionBank:
    """
    Provides reusable, canonical Universal / Primary Applicant Info (PAI) questions
    and shared Organization/Employer questions for a jurisdiction prefix (e.g. 'mt', 'ut', 'ca').

    Sharing the canonical `participant_name` (ID 4002, `APPLICANT_NAME`) across ALL programs
    in a suite ensures guest applicants never see `<Unnamed User>` on the confirmation page.
    """

    def __init__(self, prefix: str = "cf", state_name: str = "your state"):
        self.prefix = prefix.lower().strip("_")
        self.state_name = state_name

    def participant_dob(self, q_id: int = 4001) -> Dict[str, Any]:
        return q_simple(
            q_id,
            "date",
            f"{self.prefix}_shared_date_of_birth",
            "Applicant date of birth",
            "Date of birth",
            universal=True,
            pai_tags=["APPLICANT_DOB"],
        )

    def participant_name(self, q_id: int = 4002) -> Dict[str, Any]:
        return q_simple(
            q_id,
            "name",
            f"{self.prefix}_shared_participant_name",
            "Applicant full legal name",
            "Full legal name",
            universal=True,
            pai_tags=["APPLICANT_NAME"],
        )

    def participant_email(self, q_id: int = 4003) -> Dict[str, Any]:
        return q_simple(
            q_id,
            "email",
            f"{self.prefix}_shared_email_address",
            "Contact email address",
            "Email address",
            "We will send confirmation and status updates to this email.",
            universal=True,
            pai_tags=["APPLICANT_EMAIL"],
        )

    def participant_phone(self, q_id: int = 4004) -> Dict[str, Any]:
        return q_simple(
            q_id,
            "phone",
            f"{self.prefix}_shared_phone_number",
            "Applicant phone number",
            "Phone number",
            universal=True,
            pai_tags=["APPLICANT_PHONE"],
        )

    def participant_address(self, q_id: int = 4005) -> Dict[str, Any]:
        return q_simple(
            q_id,
            "address",
            f"{self.prefix}_shared_home_address",
            "Applicant residential address",
            "Home street address",
            universal=True,
        )

    def electronic_signature(self, q_id: int = 4006) -> Dict[str, Any]:
        return q_simple(
            q_id,
            "text",
            f"{self.prefix}_shared_electronic_signature",
            "Applicant electronic signature",
            "Electronic signature (type your full legal name)",
            "Typing your full legal name serves as your legal signature.",
        )

    def organization_questions(self, base_id: int = 4030) -> List[Dict[str, Any]]:
        """Returns 5 shared employer/organization questions (`base_id` to `base_id + 4`)."""
        return [
            q_simple(
                base_id,
                "text",
                f"{self.prefix}_shared_org_name",
                "Business or organization name",
                "Business or organization legal name",
            ),
            q_simple(
                base_id + 1,
                "text",
                f"{self.prefix}_shared_org_tax_id",
                "Federal Employer Identification Number (FEIN) or 501(c)(3) Tax ID",
                "Federal Tax ID (FEIN) or 501(c)(3) number",
            ),
            q_simple(
                base_id + 2,
                "address",
                f"{self.prefix}_shared_org_address",
                "Business or organization address",
                f"Business or organization address in {self.state_name}",
            ),
            q_simple(
                base_id + 3,
                "phone",
                f"{self.prefix}_shared_org_phone",
                "Business or organization phone number",
                "Business or organization phone number",
            ),
            q_simple(
                base_id + 4,
                "text",
                f"{self.prefix}_shared_org_official_name",
                "Authorized representative name and title",
                "Authorized representative full name and job title",
            ),
        ]

    def household_sliding_fee_questions(
        self,
        districts: Sequence[Tuple[str, str]],
        assistance_options: Sequence[Tuple[str, str]],
        district_label: str = "Supervisory or Magisterial District",
        district_help: str = "Select the district where your household lives.",
        base_id: int = 4010,
    ) -> List[Dict[str, Any]]:
        """
        Returns 5 shared cross-agency household & sliding-fee questions (`base_id` to `base_id + 4`):
        - `base_id` (4010): Residency confirmation (RADIO_BUTTON, option 0 = resident)
        - `base_id + 1` (4011): District / Region / County (DROPDOWN)
        - `base_id + 2` (4012): Total Household Size (number)
        - `base_id + 3` (4013): Public Assistance Programs Received (CHECKBOX)
        - `base_id + 4` (4014): Annual Gross Household Income (currency)
        """
        return [
            q_multioption(
                base_id,
                "RADIO_BUTTON",
                f"{self.prefix}_shared_county_residency",
                f"{self.state_name} residency confirmation",
                f"Do you currently live in {self.state_name}?",
                [
                    ("yes_resident", f"Yes, I live in {self.state_name}"),
                    ("no_non_resident", f"No, I live outside {self.state_name}"),
                ],
                f"To qualify for county fee reductions and scholarships, your household must reside in {self.state_name}.",
            ),
            q_multioption(
                base_id + 1,
                "DROPDOWN",
                f"{self.prefix}_shared_magisterial_district",
                district_label,
                f"Which {district_label} do you live in?",
                districts,
                district_help,
            ),
            q_simple(
                base_id + 2,
                "number",
                f"{self.prefix}_shared_household_size",
                "Total number of people in household",
                "How many people live in your household (including yourself, other adults, and children under 18)?",
                "Include all adults and dependent children living in your home who share income and expenses.",
                validation_predicates={"type": "number", "min": 1, "max": 25},
            ),
            q_multioption(
                base_id + 3,
                "CHECKBOX",
                f"{self.prefix}_shared_public_assistance_programs",
                "Household public assistance program enrollment",
                "Does anyone in your household currently receive any of the following public assistance benefits?",
                assistance_options,
                "Select all programs that apply. If you receive one of these benefits, you may qualify for fast-track scholarship verification.",
            ),
            q_simple(
                base_id + 4,
                "currency",
                f"{self.prefix}_shared_annual_household_income",
                "Total gross annual household income before taxes",
                "What is your household's total gross annual income (before taxes and deductions)?",
                "Include wages, salaries, self-employment income, child support, unemployment benefits, and pensions for all adults in your household.",
            ),
        ]



def write_and_validate_programs(outputs: Sequence[Tuple[str, Dict[str, Any]]]) -> None:
    """
    Writes one or more `(output_path, wrapper_dict)` pairs to disk and runs both
    single-program and cross-program suite validation.
    """
    loaded_for_suite: List[Tuple[str, Dict[str, Any]]] = []
    all_issues = []

    for out_path, wrapper in outputs:
        label = os.path.basename(out_path)
        loaded_for_suite.append((label, wrapper))
        all_issues.extend(validate_single_program(wrapper, label))

    if len(loaded_for_suite) > 1:
        all_issues.extend(validate_multi_program_suite(loaded_for_suite))

    errors = [i for i in all_issues if i.severity == "ERROR"]
    if errors:
        err_msg = "\n".join(str(e) for e in errors)
        raise ValueError(f"Refusing to write invalid CiviForm JSON(s):\n{err_msg}")

    for out_path, wrapper in outputs:
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(wrapper, f, indent=2, ensure_ascii=False)
            f.write("\n")
        blocks_cnt = len(wrapper["program"]["blockDefinitions"])
        q_cnt = len(wrapper["questions"])
        print(f"✅ Wrote {out_path} ({blocks_cnt} screens, {q_cnt} questions)")

    warnings = [i for i in all_issues if i.severity == "WARNING"]
    if warnings:
        print(f"⚠️ Completed with {len(warnings)} warning(s):")
        for w in warnings:
            print(f"  - {w}")
    else:
        print(f"🎉 All {len(outputs)} program file(s) passed with 0 Errors and 0 Warnings!")
