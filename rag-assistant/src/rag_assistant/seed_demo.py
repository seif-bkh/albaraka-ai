"""Demo knowledge base — 3 trilingual, Sharia-approved sample documents.

Mirrors the synthetic corpus used by the golden gate (specs/eval/kb-manifest.jsonl).
"""
from __future__ import annotations

DEMO_KB: list[dict] = [
    {
        "id": "10000000-0000-4000-8000-000000000001",
        "title": {"fr-FR": "Ouverture d'un compte courant", "ar-TN": "فتح حساب جارٍ", "en-GB": "Opening a current account"},
        "collection": "PRODUCTS",
        "valid_from": None,
        "valid_until": None,
        "chunks": [
            {
                "id": "20000000-0000-4000-8000-000000000001",
                "lang": "fr-FR",
                "path": ["Compte courant", "Conditions"],
                "content": "L'ouverture d'un compte courant en dinars se fait en agence pour les particuliers "
                           "majeurs résidents. La remise du dossier complet (pièce d'identité, extrait de "
                           "naissance, justificatif de domicile de moins de trois mois) est suivie d'une "
                           "activation sous deux jours ouvrés.",
            },
            {
                "id": "20000000-0000-4000-8000-000000000002",
                "lang": "ar-TN",
                "path": ["حساب جارٍ", "الشروط"],
                "content": "يُفتح الحساب الجاري بالدينار في الوكالة للأفراد البالغين المقيمين. يُفعَّل الحساب "
                           "خلال يومي عمل بعد إيداع الملف الكامل (بطاقة هوية، شهادة ميلاد، وثيقة سكن حديثة).",
            },
            {
                "id": "20000000-0000-4000-8000-000000000003",
                "lang": "en-GB",
                "path": ["Current account", "Conditions"],
                "content": "A dinar current account is opened in branch for resident adults. A complete file "
                           "(ID card, birth certificate extract, proof of address under three months) leads "
                           "to activation within two business days.",
            },
            {
                "id": "20000000-0000-4000-8000-000000000004",
                "lang": "fr-FR",
                "path": ["Compte courant", "Services"],
                "content": "La carte bancaire et l'application de banque en ligne sont activées à la signature "
                           "de la convention de compte. Les services comprennent le virement, le relevé en ligne "
                           "et le paiement de factures. Aucun montant minimal d'ouverture n'est exigé.",
            },
        ],
    },
    {
        "id": "10000000-0000-4000-8000-000000000002",
        "title": {"fr-FR": "Rachat de crédit et regroupement", "ar-TN": "تجميع القروض", "en-GB": "Debt consolidation"},
        "collection": "PRODUCTS",
        "chunks": [
            {
                "id": "20000000-0000-4000-8000-000000000005",
                "lang": "fr-FR",
                "path": ["Financement", "Regroupement"],
                "content": "Le rachat de crédit regroupe plusieurs financements en cours (immobilier, véhicule, "
                           "consommation) dans une seule facilité selon la murabaha. L'étude du dossier est "
                           "gratuite et sans engagement ; le montant, la durée et la marge sont fixés à la conclusion.",
            },
            {
                "id": "20000000-0000-4000-8000-000000000006",
                "lang": "ar-TN",
                "path": ["تمويل", "تجميع"],
                "content": "يجمع تجميع القروض عدة تمويلات جارية (عقار، سيارة، استهلاك) في تسهيل واحد وفق المرابحة. "
                           "دراسة الملف مجانية وغير ملزمة ويُحدَّد المبلغ والمدة والهامش عند الإبرام.",
            },
            {
                "id": "20000000-0000-4000-8000-000000000007",
                "lang": "en-GB",
                "path": ["Financing", "Consolidation"],
                "content": "Debt consolidation groups several running loans (mortgage, vehicle, consumer) into "
                           "one facility under murabaha. The file assessment is free and non-binding; amount, "
                           "term and margin are set at conclusion.",
            },
        ],
    },
    {
        "id": "10000000-0000-4000-8000-000000000003",
        "title": {"fr-FR": "Murabaha ou ijarah — quelle différence ?", "ar-TN": "المرابحة والإجارة", "en-GB": "Murabaha vs ijarah"},
        "collection": "PRODUCTS",
        "chunks": [
            {
                "id": "20000000-0000-4000-8000-000000000008",
                "lang": "fr-FR",
                "path": ["Principes", "Comparaison"],
                "content": "La murabaha est une vente avec marge convenue : la banque achète le bien puis le "
                           "revend au client en plusieurs échéances. L'ijarah est une location avec option "
                           "d'acquisition à terme ; la banque reste propriétaire pendant la durée du contrat.",
            },
            {
                "id": "20000000-0000-4000-8000-000000000009",
                "lang": "ar-TN",
                "path": ["مبادئ", "مقارنة"],
                "content": "المرابحة بيع بهامش متفق عليه: يشتري البنك السلعة ثم يبيعها للعميل على أقساط. "
                           "الإجارة عقد إيجار مع خيار التملك؛ يظل البنك مالكا طوال مدة العقد.",
            },
            {
                "id": "20000000-0000-4000-8000-000000000010",
                "lang": "en-GB",
                "path": ["Principles", "Comparison"],
                "content": "Murabaha is a sale with an agreed margin: the bank buys the asset then resells it "
                           "to the client in instalments. Ijarah is a lease with a purchase option; the bank "
                           "remains owner for the contract term.",
            },
        ],
    },
]
