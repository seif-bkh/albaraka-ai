"""Trilingual refusal payloads (contract REF-01…REF-06; source: specs/prompts/templates.refusals.yaml)."""
from __future__ import annotations

from typing import Any

TEMPLATES: dict[str, dict[str, dict[str, str]]] = {
    "REF-01": {
        "fr-FR": {
            "title": "Je ne peux pas répondre à cette demande.",
            "body": "Ce message semble tenter de modifier mes instructions. Je reste un assistant "
                    "informatif et je réponds uniquement à partir de la documentation approuvée.",
        },
        "ar-TN": {
            "title": "لا أستطيع الإجابة على هذا الطلب.",
            "body": "يبدو أن هذه الرسالة تحاول تغيير تعليماتي. أنا مساعد إعلامي وأجيب فقط من الوثائق المعتمدة.",
        },
        "en-GB": {
            "title": "I cannot answer this request.",
            "body": "This message seems to attempt changing my instructions. I am an informational "
                    "assistant and answer only from approved documentation.",
        },
    },
    "REF-03": {
        "fr-FR": {
            "title": "Votre question relève de la fatwa.",
            "body": "Je ne donne pas d'avis religieux. Votre question sera transmise au comité Sharia "
                    "qui vous répondra officiellement.",
        },
        "ar-TN": {
            "title": "سؤالك يتعلق بالفتوى.",
            "body": "لا أقدم آراء شرعية. سيُحوَّل سؤالك إلى لجنة الشريعة التي سترد عليك رسميا.",
        },
        "en-GB": {
            "title": "Your question concerns a fatwa.",
            "body": "I do not give religious rulings. Your question will be routed to the Sharia "
                    "committee for an official answer.",
        },
    },
    "REF-04": {
        "fr-FR": {
            "title": "Je ne peux pas traiter vos données personnelles.",
            "body": "Je n'ai pas accès à votre compte. Connectez-vous à BANECTI ou rendez-vous en agence "
                    "pour toute opération sur vos données.",
        },
        "ar-TN": {
            "title": "لا أستطيع معالجة بياناتك الشخصية.",
            "body": "ليس لديّ وصول إلى حسابك. سجّل الدخول إلى بنكتي أو توجه إلى الوكالة لأي عملية تخص بياناتك.",
        },
        "en-GB": {
            "title": "I cannot process your personal data.",
            "body": "I have no access to your account. Sign in to BANECTI or visit a branch for any "
                    "operation on your data.",
        },
    },
    "REF-05": {
        "fr-FR": {
            "title": "Je ne trouve pas de réponse approuvée.",
            "body": "Je préfère ne rien inventer. Voici les documents les plus proches ; votre agence "
                    "peut vous répondre précisément.",
        },
        "ar-TN": {
            "title": "لم أجد إجابة معتمدة.",
            "body": "أفضل ألا أختلق إجابة. هذه أقرب الوثائق؛ ويمكن لوكالتك الإجابة بدقة.",
        },
        "en-GB": {
            "title": "I found no approved answer.",
            "body": "I prefer not to make anything up. Here are the closest documents; your branch can "
                    "answer precisely.",
        },
    },
    "REF-06": {
        "fr-FR": {"title": "Service indisponible.", "body": "Réessayez dans quelques instants."},
        "ar-TN": {"title": "الخدمة غير متاحة.", "body": "حاول مجددا بعد قليل."},
        "en-GB": {"title": "Service unavailable.", "body": "Please try again shortly."},
    },
}

DISCLAIMERS: dict[str, list[str]] = {
    "fr-FR": [
        "Réponse générée à partir de la documentation approuvée — contenu de démonstration.",
        "Vérifiez les conditions en vigueur auprès de votre agence.",
    ],
    "ar-TN": [
        "إجابة مولّدة من الوثائق المعتمدة — محتوى تجريبي.",
        "تحقق من الشروط السارية لدى وكالتك.",
    ],
    "en-GB": ["Answer generated from approved documentation — demo content.", "Check current terms with your branch."],
}

CAVEATS = {
    "fr-FR": ["Démonstration : contenu synthétique — la documentation approuvée du groupe remplace ce corpus."],
    "ar-TN": ["تجريبي: محتوى مبسّط — وثائق المجموعة المعتمدة تحل محله."],
    "en-GB": ["Demo: synthetic content — the group's approved documentation supersedes this corpus."],
}


def refusal_payload(message_id: str, code: str, locale: str, *, sources: list[Any] | None = None,
                    fatwa_request_ref: str | None = None) -> dict[str, Any]:
    t = TEMPLATES.get(code, TEMPLATES["REF-06"])[locale]
    return {
        "messageId": message_id,
        "refusalCode": code,
        "title": t["title"],
        "body": t["body"],
        "locale": locale,
        "sources": sources or [],
        "fatwaRequestRef": fatwa_request_ref,
        "handoffAvailable": True,
    }


def disclaimers_for(locale: str) -> list[str]:
    return list(DISCLAIMERS.get(locale, DISCLAIMERS["fr-FR"]))


def caveats_for(locale: str) -> list[str]:
    return list(CAVEATS.get(locale, CAVEATS["fr-FR"]))
