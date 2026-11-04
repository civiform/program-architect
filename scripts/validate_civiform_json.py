#!/usr/bin/env python3
"""
CiviForm Universal Program Migration JSON Validator (`validate_civiform_json.py`)

Validates one or more CiviForm Program Migration JSON files against:
1. Java/Play Jackson & AutoValue serialization contracts (`ProgramMigrationWrapper`)
2. Naming regexes (`^[a-z0-9-]+$` for programs, `^[a-z0-9_]+$` for questions)
3. Short description length limit (<= 100 chars)
4. Block UX rules (no 'Screen N' prefix, fileupload screen isolation, addressCorrectionEnabled=false)
5. Predicate rules ('hidePredicate' field, 'LEAF_OPERATION' node types, numeric option IDs in SELECTION predicates)
6. Eligibility Engine rules (Single-Question 'LEAF_OPERATION' eligibility predicates)
7. Primary Applicant Info (PAI) '<Unnamed User>' prevention ('APPLICANT_NAME' question present)
8. Cross-program suite safety (shared question consistency, single canonical APPLICANT_NAME across programs,
   and cross-program shared-question eligibility badge safety)

Usage:
    python3 validate_civiform_json.py <file1.json> [<file2.json> ...]
"""

import json
import os
import re
import sys
from typing import Any, Dict, List, Set, Tuple

VALID_DISPLAY_MODES = {"PUBLIC", "TI_ONLY", "DISABLED", "HIDDEN_IN_INDEX"}
VALID_NOTIFICATION_PREFS = {"EMAIL_PROGRAM_ADMIN_ALL_SUBMISSIONS"}
VALID_QUESTION_TYPES = {
    "text", "name", "date", "number", "email", "address",
    "multioption", "enumerator", "fileupload", "phone", "currency", "id"
}
VALID_MULTIOPTION_TYPES = {"RADIO_BUTTON", "CHECKBOX", "DROPDOWN"}
PROGRAM_SLUG_RE = re.compile(r"^[a-z0-9-]+$")
QUESTION_NAME_RE = re.compile(r"^[a-z0-9_]+$")

FORBIDDEN_COPY_PATTERNS = [
    (re.compile(r"\bPIRL\b", re.IGNORECASE), "Internal federal reporting acronym 'PIRL' in applicant-facing copy"),
    (re.compile(r"\b20\s+CFR\b", re.IGNORECASE), "Statutory citation '20 CFR' in applicant-facing copy"),
    (re.compile(r"\bshared question\b", re.IGNORECASE), "Internal architecture note 'shared question' in applicant-facing copy"),
]

THIRD_PARTY_SIGNATURE_RE = re.compile(
    r"(organization\s+official|agency\s+staff|job\s+service\s+staff|caseworker).*signature",
    re.IGNORECASE,
)


class ValidationIssue:
    def __init__(self, severity: str, file_label: str, path: str, message: str):
        self.severity = severity  # "ERROR" or "WARNING"
        self.file_label = file_label
        self.path = path
        self.message = message

    def __str__(self) -> str:
        return f"[{self.severity}] ({self.file_label}) {self.path}: {self.message}"


def _extract_predicate_leaf_nodes(node_wrapper: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Recursively extracts all leaf operation nodes from a CiviForm ExpressionNode tree."""
    if not isinstance(node_wrapper, dict):
        return []
    node_type = node_wrapper.get("type")
    inner = node_wrapper.get("node", {})
    if node_type == "LEAF_OPERATION" and isinstance(inner, dict):
        return [inner]
    leaves: List[Dict[str, Any]] = []
    if isinstance(inner, dict) and isinstance(inner.get("children"), list):
        for child in inner["children"]:
            leaves.extend(_extract_predicate_leaf_nodes(child))
    return leaves


def _validate_expression_tree(
    node_wrapper: Any,
    file_label: str,
    path: str,
    q_map: Dict[int, Dict[str, Any]],
    issues: List[ValidationIssue],
) -> None:
    if not isinstance(node_wrapper, dict):
        issues.append(ValidationIssue("ERROR", file_label, path, "ExpressionNode must be a JSON object."))
        return

    node_type = node_wrapper.get("type")
    if node_type not in {"LEAF_OPERATION", "AND", "OR"}:
        issues.append(
            ValidationIssue(
                "ERROR",
                file_label,
                f"{path}.type",
                f"ExpressionNode missing or invalid 'type': '{node_type}'. Must be 'LEAF_OPERATION', 'AND', or 'OR'.",
            )
        )
        return

    inner = node_wrapper.get("node")
    if not isinstance(inner, dict):
        issues.append(ValidationIssue("ERROR", file_label, f"{path}.node", "ExpressionNode missing inner 'node' object."))
        return

    if node_type == "LEAF_OPERATION":
        q_id = inner.get("questionId")
        if q_id not in q_map:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{path}.node.questionId",
                    f"Predicate references questionId {q_id} which is not in top-level questions array.",
                )
            )
        scalar = inner.get("scalar")
        if q_id in q_map and scalar:
            target_q = q_map[q_id]
            q_type = target_q.get("type", "")
            valid_scalars_by_type = {
                "multioption": {"SELECTION"},
                "date": {"DATE"},
                "number": {"NUMBER"},
                "currency": {"CURRENCY", "CURRENCY_CENTS"},
                "name": {"FIRST_NAME", "MIDDLE_NAME", "LAST_NAME", "NAME_SUFFIX"},
                "address": {"STREET", "CITY", "STATE", "ZIP"},
                "email": {"EMAIL", "TEXT"},
                "phone": {"PHONE_NUMBER", "TEXT"},
                "text": {"TEXT"},
                "id": {"TEXT"},
                "fileupload": set(),
            }
            allowed_scalars = valid_scalars_by_type.get(q_type)
            if allowed_scalars is not None and scalar not in allowed_scalars:
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{path}.node.scalar",
                        f"Predicate scalar '{scalar}' is invalid for questionId {q_id} of type '{q_type}' (allowed: {sorted(allowed_scalars) or 'none'}).",
                    )
                )
        val_obj = inner.get("value", {})
        raw_val = val_obj.get("value") if isinstance(val_obj, dict) else None
        if scalar == "SELECTION" and raw_val is not None:
            target_q = q_map.get(q_id, {})
            if q_id in q_map and target_q.get("type") != "multioption":
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{path}.node.scalar",
                        f"SELECTION predicate references questionId {q_id} of type '{target_q.get('type')}' (must be 'multioption').",
                    )
                )
            valid_opt_ids = {
                str(opt.get("id")) for opt in target_q.get("questionOptions", []) if opt.get("id") is not None
            }
            # Verify that SELECTION values are numeric option IDs (either a numeric string like "0"
            # or a JSON list of numeric strings like '["0", "1"]'), never option adminNames.
            val_type = val_obj.get("type")
            if val_type == "LIST_OF_STRINGS":
                try:
                    parsed_list = json.loads(raw_val)
                    if not isinstance(parsed_list, list) or not all(
                        isinstance(item, str) and item.isdigit() for item in parsed_list
                    ):
                        issues.append(
                            ValidationIssue(
                                "ERROR",
                                file_label,
                                f"{path}.node.value",
                                f"SELECTION LIST_OF_STRINGS value '{raw_val}' must contain stringified numeric option IDs (e.g. '[\"0\", \"1\"]'), not option adminNames (causes NumberFormatException on publish).",
                            )
                        )
                    elif valid_opt_ids:
                        invalid_ids = [item for item in parsed_list if item not in valid_opt_ids]
                        if invalid_ids:
                            issues.append(
                                ValidationIssue(
                                    "ERROR",
                                    file_label,
                                    f"{path}.node.value",
                                    f"SELECTION predicate references option ID(s) {invalid_ids} which do not exist on questionId {q_id} (valid option IDs: {sorted(valid_opt_ids)}).",
                                )
                            )
                except Exception:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{path}.node.value",
                            f"Invalid JSON list in LIST_OF_STRINGS predicate value: {raw_val}",
                        )
                    )
            elif val_type == "STRING":
                if not (isinstance(raw_val, str) and raw_val.isdigit()):
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{path}.node.value",
                            f"SELECTION STRING value '{raw_val}' must be a numeric option ID string (e.g. '0'), not an option adminName.",
                        )
                    )
                elif valid_opt_ids and raw_val not in valid_opt_ids:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{path}.node.value",
                            f"SELECTION predicate references option ID '{raw_val}' which does not exist on questionId {q_id} (valid option IDs: {sorted(valid_opt_ids)}).",
                        )
                    )
        elif q_id in q_map:
            target_type = q_map[q_id].get("type")
            if scalar == "DATE" and target_type != "date":
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{path}.node.scalar",
                        f"DATE predicate references questionId {q_id} of type '{target_type}' (must be 'date').",
                    )
                )
            elif scalar in {"NUMBER", "CURRENCY"} and target_type not in {"number", "currency"}:
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{path}.node.scalar",
                        f"{scalar} predicate references questionId {q_id} of type '{target_type}' (must be 'number' or 'currency').",
                    )
                )
    else:
        children = inner.get("children", [])
        if not isinstance(children, list) or not children:
            issues.append(
                ValidationIssue("ERROR", file_label, f"{path}.node.children", f"'{node_type}' node must have a non-empty children array.")
            )
        else:
            for c_idx, child in enumerate(children):
                _validate_expression_tree(child, file_label, f"{path}.node.children[{c_idx}]", q_map, issues)


SPANISH_INDICATOR_RE = re.compile(
    r"[áéíóúñ¿¡]|\b(solicitud|solicitante|propietario|dirección|direccion|teléfono|telefono|correo|electrónico|electronico|construcción|construccion|proyecto|ubicación|ubicacion|residencial|información|informacion|requerido|adjuntar|permiso|sí)\b",
    re.IGNORECASE,
)


def _check_applicant_copy(text: str, file_label: str, path: str, issues: List[ValidationIssue]) -> None:
    if not text:
        return
    for pattern, msg in FORBIDDEN_COPY_PATTERNS:
        if pattern.search(text):
            issues.append(ValidationIssue("WARNING", file_label, path, f"{msg}: '{text[:80]}...'"))
    if " / " in text:
        left, right = text.split(" / ", 1)
        if SPANISH_INDICATOR_RE.search(right) and not SPANISH_INDICATOR_RE.search(left):
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    path,
                    f"Concatenated bilingual 'English / Español' string found in single locale ('{text[:70]}'). Put pure English in en_US and pure Spanish in es_US.",
                )
            )


def validate_single_program(data: Dict[str, Any], file_label: str) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []

    # 1. Top-level container
    allowed_top_keys = {"program", "questions", "duplicateQuestionHandlingOptions"}
    extra_keys = set(data.keys()) - allowed_top_keys
    if extra_keys:
        issues.append(
            ValidationIssue("ERROR", file_label, "root", f"Unrecognized top-level keys {extra_keys}. Allowed: {allowed_top_keys}.")
        )

    if "program" not in data or not isinstance(data["program"], dict):
        issues.append(ValidationIssue("ERROR", file_label, "root", "Missing top-level 'program' object."))
        return issues
    if "questions" not in data or not isinstance(data["questions"], list):
        issues.append(ValidationIssue("ERROR", file_label, "root", "Missing top-level 'questions' array."))
        return issues

    program = data["program"]
    questions = data["questions"]

    # 2. Program metadata
    admin_name = program.get("adminName", "")
    if not admin_name:
        issues.append(ValidationIssue("ERROR", file_label, "program.adminName", "Program adminName is missing or empty."))
    elif not PROGRAM_SLUG_RE.match(admin_name):
        issues.append(
            ValidationIssue(
                "ERROR",
                file_label,
                "program.adminName",
                f"Program adminName '{admin_name}' must match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens only).",
            )
        )

    display_mode = program.get("displayMode")
    if display_mode not in VALID_DISPLAY_MODES:
        issues.append(
            ValidationIssue(
                "ERROR",
                file_label,
                "program.displayMode",
                f"Invalid displayMode '{display_mode}'. Must be one of {sorted(VALID_DISPLAY_MODES)}.",
            )
        )

    notif_prefs = program.get("notificationPreferences", [])
    if not isinstance(notif_prefs, list):
        issues.append(ValidationIssue("ERROR", file_label, "program.notificationPreferences", "Must be a JSON array."))
    else:
        for pref in notif_prefs:
            if pref not in VALID_NOTIFICATION_PREFS:
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        "program.notificationPreferences",
                        f"Invalid notification preference '{pref}'. Must be 'EMAIL_PROGRAM_ADMIN_ALL_SUBMISSIONS'.",
                    )
                )

    bridge_defs = program.get("bridgeDefinitions")
    if bridge_defs is not None and not isinstance(bridge_defs, dict):
        issues.append(
            ValidationIssue("ERROR", file_label, "program.bridgeDefinitions", "bridgeDefinitions must be a JSON object ({}), not an array ([]).")
        )

    acls = program.get("acls")
    if not isinstance(acls, dict) or "tiProgramViewAcls" not in acls:
        issues.append(ValidationIssue("WARNING", file_label, "program.acls", "acls should contain 'tiProgramViewAcls': []."))

    short_desc = program.get("localizedShortDescription", {}).get("translations", {})
    if not short_desc.get("en_US"):
        issues.append(ValidationIssue("ERROR", file_label, "program.localizedShortDescription", "Missing en_US short description."))
    for locale, text in short_desc.items():
        if len(text) > 100:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"program.localizedShortDescription.translations.{locale}",
                    f"Short description is {len(text)} chars (must be <= 100 characters).",
                )
            )
        _check_applicant_copy(text, file_label, f"program.localizedShortDescription.{locale}", issues)

    for locale, text in program.get("localizedDescription", {}).get("translations", {}).items():
        _check_applicant_copy(text, file_label, f"program.localizedDescription.{locale}", issues)

    # 3. Validate Questions
    q_map: Dict[int, Dict[str, Any]] = {}
    q_ids: Set[int] = set()
    q_names: Set[str] = set()
    has_pai_applicant_name = False

    for idx, q in enumerate(questions):
        q_path = f"questions[{idx}]"
        q_type = q.get("type")
        if not q_type or q_type not in VALID_QUESTION_TYPES:
            issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.type", f"Invalid question type '{q_type}'."))

        config = q.get("config", {})
        q_id = config.get("id")
        q_name = config.get("name", "")

        if q_id is None:
            issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.config.id", "Missing question id."))
        elif q_id in q_ids:
            issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.config.id", f"Duplicate question id {q_id}."))
        else:
            q_ids.add(q_id)
            q_map[q_id] = q

        if not q_name:
            issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.config.name", "Missing question config.name."))
        elif not QUESTION_NAME_RE.match(q_name):
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{q_path}.config.name",
                    f"Question config.name '{q_name}' must match ^[a-z0-9_]+$ (lowercase snake_case, underscores only).",
                )
            )
        elif q_name in q_names:
            issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.config.name", f"Duplicate question config.name '{q_name}'."))
        else:
            q_names.add(q_name)

        pai_tags = config.get("primaryApplicantInfoTags", [])
        if "APPLICANT_NAME" in pai_tags and config.get("universal") is True:
            has_pai_applicant_name = True

        q_text_map = config.get("questionText", {}).get("translations", {})
        en_q_text = q_text_map.get("en_US", "")
        if not en_q_text:
            issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.config.questionText", "Missing en_US questionText."))
        else:
            _check_applicant_copy(en_q_text, file_label, f"{q_path}.config.questionText", issues)
            if THIRD_PARTY_SIGNATURE_RE.search(en_q_text) or THIRD_PARTY_SIGNATURE_RE.search(q_name):
                issues.append(
                    ValidationIssue(
                        "WARNING",
                        file_label,
                        f"{q_path}.config.questionText",
                        f"Question '{q_name}' appears to ask for a third-party/staff signature inside an applicant form.",
                    )
                )

        en_help_text = config.get("questionHelpText", {}).get("translations", {}).get("en_US", "")
        _check_applicant_copy(en_help_text, file_label, f"{q_path}.config.questionHelpText", issues)

        v_pred = config.get("validationPredicates")
        if not isinstance(v_pred, dict) or v_pred.get("type") != q_type:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{q_path}.config.validationPredicates",
                    f"Missing or mismatched validationPredicates.type (expected '{q_type}').",
                )
            )

        if q_type == "multioption":
            multi_type = q.get("multiOptionQuestionType")
            if multi_type not in VALID_MULTIOPTION_TYPES:
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{q_path}.multiOptionQuestionType",
                        f"Invalid multiOptionQuestionType '{multi_type}'. Must be one of {sorted(VALID_MULTIOPTION_TYPES)}.",
                    )
                )
            options = q.get("questionOptions", [])
            if not options:
                issues.append(ValidationIssue("ERROR", file_label, f"{q_path}.questionOptions", "Multioption question has no options."))
            seen_opt_admins: Set[str] = set()
            seen_opt_texts_by_locale: Dict[str, Set[str]] = {}
            seen_opt_ids: Set[int] = set()
            for o_idx, opt in enumerate(options):
                opt_path = f"{q_path}.questionOptions[{o_idx}]"
                opt_id = opt.get("id")
                if not isinstance(opt_id, int) or opt_id < 0:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{opt_path}.id",
                            f"Option id must be a non-negative integer (got {opt_id!r}).",
                        )
                    )
                elif opt_id in seen_opt_ids:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{opt_path}.id",
                            f"Duplicate option id {opt_id} in question '{q_name}'.",
                        )
                    )
                else:
                    seen_opt_ids.add(opt_id)

                opt_admin = opt.get("adminName", "")
                if not opt_admin or not QUESTION_NAME_RE.match(opt_admin):
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{opt_path}.adminName",
                            f"Option adminName '{opt_admin}' must match ^[a-z0-9_]+$.",
                        )
                    )
                elif opt_admin.startswith("object_object"):
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{opt_path}.adminName",
                            f"Option adminName '{opt_admin}' was serialized from an unflattened JS object ('[object Object]').",
                        )
                    )
                elif opt_admin.lower() in seen_opt_admins:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{opt_path}.adminName",
                            f"Multi-option question options must be unique: duplicate option adminName '{opt_admin}' in question '{q_name}'.",
                        )
                    )
                else:
                    seen_opt_admins.add(opt_admin.lower())

                opt_translations = opt.get("localizedOptionText", {}).get("translations", {})
                en_opt_text = opt_translations.get("en_US", "")
                if not en_opt_text:
                    issues.append(ValidationIssue("ERROR", file_label, f"{opt_path}.localizedOptionText", "Missing en_US option text."))
                for locale, l_text in opt_translations.items():
                    norm_text = str(l_text).strip()
                    if "[object Object]" in norm_text:
                        issues.append(
                            ValidationIssue(
                                "ERROR",
                                file_label,
                                f"{opt_path}.localizedOptionText.translations.{locale}",
                                f"Option text in '{q_name}' contains literal '[object Object]'. Options must be plain strings.",
                            )
                        )
                    locale_set = seen_opt_texts_by_locale.setdefault(locale, set())
                    if norm_text.lower() in locale_set:
                        issues.append(
                            ValidationIssue(
                                "ERROR",
                                file_label,
                                f"{opt_path}.localizedOptionText.translations.{locale}",
                                f"Multi-option question options must be unique: duplicate option text '{norm_text}' in question '{q_name}' ({locale}).",
                            )
                        )
                    elif norm_text:
                        locale_set.add(norm_text.lower())

    if not has_pai_applicant_name:
        issues.append(
            ValidationIssue(
                "WARNING",
                file_label,
                "questions",
                "No name question has universal=True and primaryApplicantInfoTags=['APPLICANT_NAME']. Guest submissions will display '<Unnamed User>' on the confirmation screen.",
            )
        )

    # 4. Validate Blocks
    blocks = program.get("blockDefinitions", [])
    if not blocks:
        issues.append(ValidationIssue("ERROR", file_label, "program.blockDefinitions", "Program has no blockDefinitions."))

    referenced_questions: Set[int] = set()
    seen_questions_prior_blocks: Set[int] = set()
    for b_idx, b in enumerate(blocks):
        b_path = f"program.blockDefinitions[{b_idx}]"
        b_id = b.get("id")
        if b_id is None or b_id < 1:
            issues.append(ValidationIssue("ERROR", file_label, f"{b_path}.id", f"Block id must be >= 1 (got {b_id})."))

        b_name = b.get("name", "")
        if not b_name:
            issues.append(ValidationIssue("ERROR", file_label, f"{b_path}.name", "Missing block name."))
        elif re.search(r"\b(Screen|Step)\s+\d+", b_name, re.IGNORECASE):
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{b_path}.name",
                    f"Block name '{b_name}' contains 'Screen/Step N' prefix (CiviForm adds 'Screen X of Y' automatically).",
                )
            )

        if "visibilityPredicate" in b and b["visibilityPredicate"] is not None:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{b_path}.visibilityPredicate",
                    "Use 'hidePredicate' instead of 'visibilityPredicate' (BlockDefinition Jackson property is 'hidePredicate').",
                )
            )

        loc_name = b.get("localizedName", {}).get("translations", {}).get("en_US", "")
        if not loc_name:
            issues.append(ValidationIssue("ERROR", file_label, f"{b_path}.localizedName", "Missing en_US localizedName."))
        elif re.search(r"\b(Screen|Step)\s+\d+", loc_name, re.IGNORECASE):
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{b_path}.localizedName",
                    f"Block localizedName '{loc_name}' contains 'Screen/Step N' prefix.",
                )
            )
        _check_applicant_copy(loc_name, file_label, f"{b_path}.localizedName", issues)

        loc_desc = b.get("localizedDescription", {}).get("translations", {}).get("en_US", "")
        if not loc_desc:
            issues.append(ValidationIssue("ERROR", file_label, f"{b_path}.localizedDescription", "Missing en_US localizedDescription."))
        _check_applicant_copy(loc_desc, file_label, f"{b_path}.localizedDescription", issues)

        q_defs = b.get("questionDefinitions", [])
        current_block_qids = {qd.get("id") for qd in q_defs if qd.get("id") is not None}

        # Validate hidePredicate if present (including block-order forward-reference check)
        hide_pred = b.get("hidePredicate")
        if isinstance(hide_pred, dict) and hide_pred.get("rootNode"):
            _validate_expression_tree(hide_pred["rootNode"], file_label, f"{b_path}.hidePredicate.rootNode", q_map, issues)
            for leaf in _extract_predicate_leaf_nodes(hide_pred["rootNode"]):
                ref_qid = leaf.get("questionId")
                if ref_qid in q_map and ref_qid not in seen_questions_prior_blocks:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{b_path}.hidePredicate",
                            f"Block '{b_name}' hidePredicate references questionId {ref_qid} which has not appeared on an earlier screen (same-screen or forward reference breaks CiviForm visibility logic).",
                        )
                    )

        # Validate eligibilityDefinition if present
        elig_def = b.get("eligibilityDefinition")
        if isinstance(elig_def, dict) and elig_def.get("predicate"):
            pred = elig_def["predicate"]
            root_node = pred.get("rootNode", {})
            _validate_expression_tree(root_node, file_label, f"{b_path}.eligibilityDefinition.predicate.rootNode", q_map, issues)
            root_type = root_node.get("type")
            if root_type and root_type != "LEAF_OPERATION":
                issues.append(
                    ValidationIssue(
                        "WARNING",
                        file_label,
                        f"{b_path}.eligibilityDefinition",
                        f"Eligibility predicate uses '{root_type}' instead of single-question 'LEAF_OPERATION'. CiviForm highlights every question in a multi-question predicate when ineligible.",
                    )
                )
            for leaf in _extract_predicate_leaf_nodes(root_node):
                ref_qid = leaf.get("questionId")
                if ref_qid in q_map and ref_qid not in current_block_qids:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            file_label,
                            f"{b_path}.eligibilityDefinition",
                            f"Block '{b_name}' eligibilityDefinition references questionId {ref_qid} which is not on this block (present: {sorted(current_block_qids)}).",
                        )
                    )

        # Validate questionDefinitions & fileupload isolation
        if not q_defs:
            issues.append(ValidationIssue("WARNING", file_label, f"{b_path}.questionDefinitions", "Block has no questions."))
        elif len(q_defs) > 8:
            issues.append(
                ValidationIssue(
                    "WARNING",
                    file_label,
                    f"{b_path}.questionDefinitions",
                    f"Block '{b_name}' has {len(q_defs)} questions (recommended <= 8 questions per screen for low cognitive load).",
                )
            )

        has_fileupload = False
        for qd_idx, qd in enumerate(q_defs):
            target_q_id = qd.get("id")
            if qd.get("addressCorrectionEnabled") is True:
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{b_path}.questionDefinitions[{qd_idx}].addressCorrectionEnabled",
                        "addressCorrectionEnabled=True throws InvalidEsriServiceAreaValidationConfigException unless ESRI GIS is configured.",
                    )
                )
            if target_q_id not in q_map:
                issues.append(
                    ValidationIssue(
                        "ERROR",
                        file_label,
                        f"{b_path}.questionDefinitions[{qd_idx}]",
                        f"Referenced question id {target_q_id} does not exist in top-level questions array.",
                    )
                )
            else:
                if q_map[target_q_id].get("type") == "fileupload":
                    has_fileupload = True
            referenced_questions.add(target_q_id)
            seen_questions_prior_blocks.add(target_q_id)

        if has_fileupload and len(q_defs) > 1:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    f"{b_path}.questionDefinitions",
                    f"Block '{b_name}' mixes a fileupload question with {len(q_defs) - 1} other question(s). File upload questions must be isolated on their own screen.",
                )
            )

    # 5. Check for orphan questions
    for q_id, q in q_map.items():
        if q_id not in referenced_questions:
            q_name = q.get("config", {}).get("name", "unknown")
            issues.append(
                ValidationIssue(
                    "WARNING",
                    file_label,
                    "questions",
                    f"Question id {q_id} ('{q_name}') is defined in questions array but never used in any block.",
                )
            )

    return issues


def validate_multi_program_suite(loaded_programs: List[Tuple[str, Dict[str, Any]]]) -> List[ValidationIssue]:
    """
    Cross-validates a suite of 2+ CiviForm programs that share questions:
    1. Ensures shared questions (by config.name or id) have identical id, name, and type across programs.
    2. Ensures all programs share the single canonical APPLICANT_NAME question (since CiviForm allows only 1 system-wide).
    3. Checks Cross-Program Shared Question Eligibility Safety: ensures no program mixes a shared question
       with program-specific eligibility questions/blocks (which causes false 'You may not qualify' badges).
    """
    issues: List[ValidationIssue] = []
    if len(loaded_programs) < 2:
        return issues

    # Track question definitions across files by config.name
    by_name: Dict[str, List[Tuple[str, int, str]]] = {}
    pai_name_questions: Set[str] = set()

    for file_label, data in loaded_programs:
        for q in data.get("questions", []):
            cfg = q.get("config", {})
            q_name = cfg.get("name", "")
            q_id = cfg.get("id", -1)
            q_type = q.get("type", "")
            by_name.setdefault(q_name, []).append((file_label, q_id, q_type))
            if "APPLICANT_NAME" in cfg.get("primaryApplicantInfoTags", []):
                pai_name_questions.add(q_name)

    if len(pai_name_questions) > 1:
        issues.append(
            ValidationIssue(
                "ERROR",
                "SUITE",
                "primaryApplicantInfoTags.APPLICANT_NAME",
                f"Multiple different questions claim APPLICANT_NAME across the suite: {sorted(pai_name_questions)}. CiviForm allows only ONE question in the system to hold APPLICANT_NAME.",
            )
        )

    shared_question_names: Set[str] = set()
    shared_question_ids: Set[int] = set()
    for q_name, occurrences in by_name.items():
        if len(occurrences) > 1:
            shared_question_names.add(q_name)
            first_file, first_id, first_type = occurrences[0]
            shared_question_ids.add(first_id)
            for other_file, other_id, other_type in occurrences[1:]:
                if other_id != first_id or other_type != first_type:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            "SUITE",
                            f"shared_question.{q_name}",
                            f"Shared question '{q_name}' has (id={first_id}, type={first_type}) in {first_file} but (id={other_id}, type={other_type}) in {other_file}.",
                        )
                    )

    # Check Cross-Program Shared Question Eligibility Safety
    for file_label, data in loaded_programs:
        blocks = data.get("program", {}).get("blockDefinitions", [])
        elig_blocks_qids: List[Set[int]] = []
        for b in blocks:
            elig_def = b.get("eligibilityDefinition")
            if isinstance(elig_def, dict) and elig_def.get("predicate"):
                leaves = _extract_predicate_leaf_nodes(elig_def["predicate"].get("rootNode", {}))
                qids = {leaf.get("questionId") for leaf in leaves if leaf.get("questionId") is not None}
                if qids:
                    elig_blocks_qids.append(qids)

        all_elig_qids = set().union(*elig_blocks_qids) if elig_blocks_qids else set()
        shared_in_elig = all_elig_qids & shared_question_ids
        unshared_in_elig = all_elig_qids - shared_question_ids
        if shared_in_elig and unshared_in_elig:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    file_label,
                    "program.blockDefinitions.eligibilityDefinition",
                    f"Program mixes shared eligibility question(s) {sorted(shared_in_elig)} with program-specific eligibility question(s) {sorted(unshared_in_elig)}. Answering the shared question in another program will immediately trigger a false 'You may not qualify' badge on this program.",
                )
            )

    return issues


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 validate_civiform_json.py <file1.json> [<file2.json> ...]")
        sys.exit(1)

    file_paths = sys.argv[1:]
    loaded_programs: List[Tuple[str, Dict[str, Any]]] = []
    all_issues: List[ValidationIssue] = []

    for path in file_paths:
        if not os.path.exists(path):
            print(f"FATAL: File '{path}' does not exist.")
            sys.exit(1)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"FATAL: Invalid JSON syntax in '{path}': {e}")
            sys.exit(1)

        label = os.path.basename(path)
        loaded_programs.append((label, data))
        file_issues = validate_single_program(data, label)
        all_issues.extend(file_issues)

        blocks_cnt = len(data.get("program", {}).get("blockDefinitions", []))
        questions_cnt = len(data.get("questions", []))
        err_cnt = sum(1 for i in file_issues if i.severity == "ERROR")
        warn_cnt = sum(1 for i in file_issues if i.severity == "WARNING")
        status_icon = "✅" if (err_cnt == 0 and warn_cnt == 0) else ("❌" if err_cnt > 0 else "⚠️")
        print(f"{status_icon} {label}: {blocks_cnt} screens, {questions_cnt} questions ({err_cnt} errors, {warn_cnt} warnings)")

    if len(loaded_programs) > 1:
        suite_issues = validate_multi_program_suite(loaded_programs)
        all_issues.extend(suite_issues)
        s_err = sum(1 for i in suite_issues if i.severity == "ERROR")
        s_warn = sum(1 for i in suite_issues if i.severity == "WARNING")
        s_icon = "✅" if (s_err == 0 and s_warn == 0) else ("❌" if s_err > 0 else "⚠️")
        print(f"{s_icon} Cross-Program Suite Check ({len(loaded_programs)} programs): {s_err} errors, {s_warn} warnings")

    total_errors = sum(1 for i in all_issues if i.severity == "ERROR")
    total_warnings = sum(1 for i in all_issues if i.severity == "WARNING")

    if all_issues:
        print("\nDetailed Findings:")
        for issue in all_issues:
            prefix = "❌" if issue.severity == "ERROR" else "⚠️"
            print(f"  {prefix} {issue}")

    print(f"\nSummary: {total_errors} Error(s), {total_warnings} Warning(s)")
    if total_errors > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
