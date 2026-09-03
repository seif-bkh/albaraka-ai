"""Guardrails — REF-01 injection, REF-03 fatwa routing, REF-04 personal data, REF-05 fallback.

Deterministic lexicons first (fast, auditable); the live mode additionally uses the Groq guard
models (`llama-guard-4-12b`, `llama-prompt-guard-2-86m`) before any egress.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

INJECTION = re.compile(
    r"(ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|consignes|prompt|orders)|"
    r"ignore\s+(les\s+)?consignes|révèle\s+ton\s+prompt|"
    r"disregard\s+(all\s+)?(previous|prior)\s+instructions|"
    r"révèle\s+(tes|vos)\s+(instructions|consignes|prompts)|"
    r"أهمل\s+التعليمات|تجاهل\s+(كل\s+)?التعليمات|"
    r"system\s*prompt|jailbreak|préviens\s+et\s+révèle)",
    re.IGNORECASE,
)

FATWA = re.compile(
    r"(fatwa|فتوى|halal|haram|حلال|حرام|zakat|زكاة|زكاة الفطر|zakah|"
    r"istifta|استفتاء|riba|ربا|hukm|حكم شرعي|sharia\s+ruling|avis\s+religieux|"
    r"est[- ]ce\s+que\s+c['’]est\s+permis|religious\s+ruling)",
    re.IGNORECASE,
)

PII = re.compile(
    r"(\b\d{8}\b|\b\d{2}\s*\d{3}\s*\d{3}\b|"          # CIN patterns
    r"\b(?:TN)?\d{2}\s?\d{4}\s?\d{4}\b|"              # RIB-ish
    r"(?:\+216|\b0)\s?[2579]\d\s?\d{2}\s?\d{2}\s?\d{2}\b|"  # phone
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})",  # email
    re.IGNORECASE,
)

ACCOUNT = re.compile(
    r"(solde\s+de\s+mon\s+compte|mon\s+compte\s+bancaire|mon\s+crédit\s+en\s+cours|"
    r"رصيدي|حسابي\s+البنكي|my\s+account\s+balance|my\s+iban|mon\s+rib\s+est|"
    r"numero\s+de\s+compte|رقم\s+الحساب)",
    re.IGNORECASE,
)

TARIFF = re.compile(r"(grille\s+tarifaire|tarif(s|aire)?s?\s+\d{4}|barème|جدول\s+الأسعار|fee\s+schedule\s+20)", re.IGNORECASE)


def classify(text: str) -> dict[str, Any]:
    """Returns {refusalCode | None, reason, evidence, fatwa_request_ref | None}."""
    if INJECTION.search(text):
        return {"refusalCode": "REF-01", "reason": "prompt injection", "evidence": INJECTION.pattern, "fatwa_request_ref": None}
    if FATWA.search(text):
        ref = "FR-" + hashlib.sha1(text.encode("utf-8")).hexdigest()[:8].upper()
        return {"refusalCode": "REF-03", "reason": "religious ruling request", "evidence": FATWA.pattern, "fatwa_request_ref": ref}
    if PII.search(text) or ACCOUNT.search(text):
        return {"refusalCode": "REF-04", "reason": "personal/account data", "evidence": PII.pattern, "fatwa_request_ref": None}
    if TARIFF.search(text):
        return {"refusalCode": "REF-05", "reason": "tariff corpus not approved (demo)", "evidence": TARIFF.pattern, "fatwa_request_ref": None}
    return {"refusalCode": None, "reason": None, "evidence": None, "fatwa_request_ref": None}
