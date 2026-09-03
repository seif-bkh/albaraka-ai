# Trilingual Glossary (FR / AR / EN)

Canonical terminology for Al-Mouchir. This file is the human-readable mirror of the `term_glossary`
table (doc 03 §2.7); the seed migration `specs/db/seed/V900__seed_glossary.sql` is generated from it.

Rules:
* The **French** column follows the bank's own published spelling (as used on `albaraka.com.tn`).
* The **English** column follows common academic/AAOIFI transliteration.
* **Arabic** is Modern Standard Arabic; Derja forms are handled by the Derja map, not here.
* Terms marked 🔒 are `sharia_sensitive`: changing them requires SHARIA_OFFICER approval (T3).
* *Forbidden renderings* are enforced by the output classifier — the assistant must never use them for
  the concept in that row.

## 1. Financing contracts & products

| Code | Français | العربية | English | Notes / forbidden renderings |
|---|---|---|---|---|
| `MOURABAHA` 🔒 | Mourabaha | مرابحة | Murabaha (cost-plus sale) | Sale at cost plus a disclosed, agreed margin. ✗ *prêt, crédit, loan, interest-bearing sale* |
| `MOUSSAWAMA` 🔒 | Moussawama | مساومة | Musawama | Sale at an agreed price without disclosing cost. ✗ *prêt personnel* |
| `MOUCHARAKA` 🔒 | Moucharaka | مشاركة | Musharaka (partnership) | Joint capital, shared profit and loss. ✗ *crédit participatif, joint loan* |
| `MOUCHARAKA_DEGRESSIVE` 🔒 | Moucharaka dégressive | مشاركة متناقصة | Diminishing Musharaka | Partner progressively buys out the bank's share |
| `MOUDHARABA` 🔒 | Moudharaba | مضاربة | Mudaraba | Bank provides capital, client provides expertise; profit shared, loss borne by capital. ✗ *placement à intérêt* |
| `IJARA` 🔒 | Ijara | إجارة | Ijara (lease) | Lease of an asset or service |
| `IJARA_ACQUISITION` 🔒 | Ijara assortie de l'option d'acquisition | إجارة منتهية بالتمليك | Ijara wa Iqtina (lease-to-own) | As named in loi 2016-48. ✗ *crédit-bail classique, leasing with interest* |
| `ISTISNAA` 🔒 | Istisna'a | استصناع | Istisna'a (manufacturing/construction contract) | Forward contract for something to be built or manufactured |
| `SALAM` 🔒 | Salam | سلم | Salam (forward sale with upfront payment) | Full payment at contract, deferred delivery of specified goods |
| `WAKALA` 🔒 | Wakala | وكالة | Wakala (agency) | Agency mandate; fee must not be a fixed return on capital |
| `WAKALA_INVEST` 🔒 | Wakala d'investissement | وكالة بالاستثمار | Investment Wakala | Used for placing client funds |
| `BAI_MOUAJJAL` 🔒 | Baï Mouajjal (vente à terme) | بيع مؤجل | Deferred-payment sale | |
| `QARD_HASSAN` 🔒 | Qard hassan | قرض حسن | Benevolent loan (interest-free) | Charity-type lending, no margin |
| `TAKAFUL` 🔒 | Takaful | تكافل | Takaful (cooperative insurance) | ✗ *assurance classique* when referring to the bank's cover |
| `SUKUK` 🔒 | Sukuk | صكوك | Sukuk (investment certificates) | ✗ *obligations* |

## 2. Sharia concepts & prohibitions

| Code | Français | العربية | English | Notes |
|---|---|---|---|---|
| `CHARIA` 🔒 | Charia / normes bancaires islamiques | الشريعة / المعايير المصرفية الإسلامية | Sharia / Islamic banking standards | Loi 2016-48 speaks of *normes bancaires islamiques* |
| `RIBA` 🔒 | riba (proscription de l'intérêt) | ربا | riba (prohibition of interest) | Concept, never a product |
| `GHARAR` 🔒 | gharar (incertitude excessive) | غرر | gharar (excessive uncertainty) | |
| `MAYSIR` 🔒 | maysir (hasard / spéculation) | ميسر | maysir (gambling/speculation) | |
| `HALAL` 🔒 | licite (halal) | حلال | permissible (halal) | The assistant never *declares* something halal |
| `HARAM` 🔒 | illicite (haram) | حرام | prohibited (haram) | Same rule |
| `FATWA` 🔒 | avis religieux (fatwa) | فتوى | religious ruling (fatwa) | Reserved to the committee |
| `MARGE_BENEF` 🔒 | marge bénéficiaire | هامش ربح | profit margin | ✗ *taux d'intérêt, intérêt, نسبة فائدة, rate of interest* |
| `PROFIT_SHARE` 🔒 | participation aux bénéfices | توزيع الأرباح | profit sharing | |
| `NAFAA_AL_AM` 🔒 | compte de bienfaisance (Nafaa al Am) | حساب النفع العام | charity account | Where non-conforming income is allocated |
| `ZAKAT` 🔒 | zakat | زكاة | zakat | Informational only; never a computed ruling |
| `AAOIFI` 🔒 | normes AAOIFI | معايير هيئة المحاسبة والمراجعة للمؤسسات المالية الإسلامية | AAOIFI standards | Cite the standard number when available |

## 3. Accounts, deposits & banking operations

| Code | Français | العربية | English | Notes |
|---|---|---|---|---|
| `COMPTE_COURANT` | compte courant | حساب جار | current account | |
| `DEPOT_INVEST` 🔒 | dépôt d'investissement | حساب استثمار | investment account (IAH) | ✗ *compte à terme rémunéré* |
| `DEPOT_INVEST_NON_AFFECTE` 🔒 | dépôt participatif non affecté | وديعة استثمارية غير مخصصة | unrestricted investment deposit | Profits shared per the agreed key |
| `DEPOT_AFFECTE` 🔒 | dépôt d'investissement affecté | وديعة استثمارية مخصصة | restricted investment deposit | Tied to a specific operation |
| `FINANCEMENT` | financement | تمويل | financing | ✗ *crédit, prêt, loan* when referring to the bank's products |
| `ENCOURS` | encours de financements | الرصيد الجاري للتمويلات | outstanding financing | |
| `APPORT_PERSONNEL` | apport personnel | المساهمة الذاتية | own contribution / down payment | |
| `DUREE_FINANCEMENT` | durée du financement | مدة التمويل | financing term | |
| `ECHEANCE` | échéance / mensualité | قسط | instalment | |
| `DIFFERE` | différé de paiement | فترة إمهال | grace period | |
| `GARANTIE` | garantie / sûreté | ضمان / ضمانات | collateral / guarantee | |
| `PLAFOND` | plafond | السقف / الحد الأقصى | ceiling / limit | |
| `DEVIS` | devis / facture pro forma | فاتورة تقديرية | quotation / pro forma invoice | |
| `PIECES_JUSTIF` | pièces justificatives | المؤيدات / الوثائق المطلوبة | supporting documents | |
| `CONDITIONS_BANQUE` | conditions de banque | التعرفة البنكية / شروط البنك | bank tariff / standard terms | Always quoted with its validity date |
| `FRAIS_TENUE` | frais de tenue de compte | معاليم مسك الحساب | account maintenance fees | |
| `COMMISSION` | commission | عمولة | commission / fee | ✗ *intérêt* |
| `AGENCE` | agence | وكالة | branch / agency | |
| `HARIF` 🔵 | client | حريف | customer | Tunisian banking usage; plural *حرفاء* |
| `CONSEILLER` | conseiller | مستشار | advisor | |
| `RECLAMATION` | réclamation | شكوى / تظلم | complaint | |
| `CONTRAT` | contrat | عقد | contract | |
| `COMITE_CREDIT` | comité de crédit | لجنة التمويل | financing committee | Internal body |

## 4. Governance & regulation (Tunisia)

| Code | Français | العربية | English | Notes |
|---|---|---|---|---|
| `BCT` | Banque Centrale de Tunisie | البنك المركزي التونسي | Central Bank of Tunisia | Controls conformity of Islamic banking operations with international standards |
| `LOI_2016_48` | Loi n° 2016-48 du 11 juillet 2016 | القانون عدد 48 لسنة 2016 المؤرخ في 11 جويلية 2016 | Law No. 2016-48 of 11 July 2016 | Banks and financial institutions |
| `CIRC_BCT_2021_05` | Circulaire BCT n° 2021-05 du 19 août 2021 | منشور البنك المركزي عدد 2021-05 المؤرخ في 19 أوت 2021 | BCT Circular No. 2021-05 | Governance, incl. Islamic banking operations |
| `COMITE_CHARIA` 🔒 | Comité de contrôle de conformité des normes bancaires islamiques | لجنة مراقبة مطابقة المعايير المصرفية الإسلامية | Islamic Banking Standards Compliance Committee | Loi 2016-48 art. 53–54 |
| `AUDITEUR_ISLAMIQUE` 🔒 | auditeur des opérations bancaires islamiques | مدقق العمليات المصرفية الإسلامية | Islamic banking operations auditor | Circulaire BCT 2021-05 |
| `JORT` | Journal Officiel de la République Tunisienne | الرائد الرسمي للجمهورية التونسية | Official Gazette | |
| `INPDP` | Instance Nationale de Protection des Données Personnelles | الهيئة الوطنية لحماية المعطيات الشخصية | National Authority for Personal Data Protection | Loi organique 2004-63 |
| `AAOIFI_ORG` 🔒 | AAOIFI | هيئة المحاسبة والمراجعة للمؤسسات المالية الإسلامية | Accounting and Auditing Organization for Islamic Financial Institutions | |
| `CIBAFI` | CIBAFI | المجلس العام للبنوك والمؤسسات المالية الإسلامية | General Council for Islamic Banks and Financial Institutions | |
| `ABG` | Al Baraka Banking Group | مجموعة البركة المصرفية | Al Baraka Banking Group | Parent group |

## 5. Assistant, RAG & platform terms (backoffice UI)

| Code | Français | العربية | English |
|---|---|---|---|
| `KB` | base de connaissances | قاعدة المعرفة | knowledge base |
| `DOCUMENT` | document | وثيقة | document |
| `CHUNK` | extrait / segment | مقطع | chunk |
| `EMBEDDING` | vecteur de représentation | متجه تمثيل نصي | embedding |
| `RETRIEVAL` | recherche / récupération | استرجاع | retrieval |
| `RAG` | génération augmentée par retrieval | التوليد المعزَّز بالاسترجاع | retrieval-augmented generation |
| `PROMPT` | consigne / invite | موجِّه | prompt |
| `PROMPT_VERSION` | version de consigne | إصدار الموجِّه | prompt version |
| `GUARDRAIL` | garde-fou | حاجز أمان | guardrail |
| `REFUSAL` | refus / non-réponse | امتناع عن الإجابة | refusal |
| `CITATION` | source citée | المصدر المستشهد به | citation |
| `DISCLAIMER` | avertissement | تنبيه / إخلاء مسؤولية | disclaimer |
| `HALLUCINATION` | réponse non fondée | جواب غير مؤصَّل | ungrounded answer | Prefer "ungrounded" over "hallucination" in user-facing text |
| `FEEDBACK` | retour / évaluation | تقييم | feedback |
| `REVIEW` | revue / révision | مراجعة | review |
| `APPROVAL` | approbation / visa | اعتماد / موافقة | approval |
| `TWO_EYES` | double validation | الرقابة المزدوجة | four-eyes / two-eyes approval |
| `DRAFT` | brouillon | مسودة | draft |
| `IN_REVIEW` | en revue | قيد المراجعة | in review |
| `SHARIA_APPROVED` | validé charia | معتمد شرعيا | Sharia-approved |
| `PUBLISHED` | publié | منشور | published |
| `WITHDRAWN` | retiré | مسحوب | withdrawn |
| `DEPRECATED` | déprécié | متروك | deprecated |
| `AUDIT_TRAIL` | piste d'audit | مسار التدقيق | audit trail |
| `EVIDENCE_PACK` | dossier probatoire | ملف الإثباتات | evidence pack |
| `GOLDEN_SET` | jeu de référence | مجموعة الاختبار المرجعية | golden set |
| `EVAL_RUN` | exécution d'évaluation | دورة تقييم | evaluation run |
| `CANARY` | diffusion canari | نشر تجريبي محدود | canary release |
| `KILL_SWITCH` | arrêt d'urgence | الإيقاف العاجل | kill switch |
| `COVERAGE_GAP` | lacune de couverture | نقص في التغطية | coverage gap |
| `TERMINOLOGY` | terminologie | المصطلحات | terminology |
| `FORBIDDEN_RENDERING` | traduction interdite | ترجمة ممنوعة | forbidden rendering |
| `DERJA` | dialecte tunisien | العامية التونسية | Tunisian dialect |
| `MSA` | arabe littéral | العربية الفصحى | Modern Standard Arabic |
| `RTL` | écriture de droite à gauche | الكتابة من اليمين إلى اليسار | right-to-left |
| `HANDOFF` | transfert vers un conseiller | التحويل إلى مستشار | handoff |
| `FATWA_REQUEST` | demande d'avis au comité | طلب رأي من اللجنة | committee opinion request |

## 6. Forbidden-rendering register (excerpts)

Pairs the assistant must never produce. Enforced deterministically at output.

| Concept | Never say (FR) | Never say (AR) | Never say (EN) | Say instead |
|---|---|---|---|---|
| Product financing | prêt, crédit, emprunt | قرض بفائدة، سلفة | loan, credit, borrowing | financement, operation de Mourabaha / تمويل |
| Cost of financing | taux d'intérêt, intérêt, agios | نسبة فائدة، فائدة بنكية | interest rate, APR | marge bénéficiaire / هامش ربح / profit margin |
| Deposit remuneration | compte rémunéré à X % | حساب بفائدة X٪ | account yielding X % interest | participation aux bénéfices selon la clé convenue |
| Insurance | assurance classique | تأمين تجاري | conventional insurance | Takaful / تكافل |
| Religious verdict | c'est halal, c'est interdit, je vous autorise | هذا حلال، هذا حرام، أفتيك بأن | this is halal, this is haram, I rule that | la documentation approuvée prévoit… / pour un avis, saisissez le Comité |
| Penalty interest | pénalités de retard (intérêts) | غرامات تأخير بفائدة | late-payment interest | indemnité versée au compte de bienfaisance (Nafaa al Am), le cas échéant |

## 7. Derja → MSA seed mappings (input normalisation)

| Derja (AR script) | Derja (latin/arabizi) | MSA | EN gloss |
|---|---|---|---|
| شنيا / شنية | chnowa, chniya | ما هو / ما هي | what is |
| قداش | 9addéch, gedech | كم | how much |
| نحب | nheb | أريد | I want |
| باش | bach, bch | من أجل / لكي | in order to |
| برشة | barcha | كثيرا | a lot |
| فلوس | flous | أموال | money |
| كرهبة | karhba | سيارة | car |
| دار | dar | منزل / عقار | house / property |
| شهرية | chahria | قسط شهري | monthly instalment |
| وين | win, wina | أين | where |
| شكون | chkoun | من | who |
| علاش | 3lach | لماذا | why |
| حاجات | hajet | أمور / عناصر | things |
| خدمة | khedma | عمل / نشاط | work / business |
| مشروع | machrou3 | مشروع | project (same in MSA) |
| سلفني | slefni | موّلني | finance me |
| معاليم | m3alim | معاليم | fees (same) |
| بنك | bank | بنك | bank |
| حلال ولا لا | halal wala la | هل هو جائز شرعا | is it permissible (→ triggers the no-fatwa rule) |

The full table (~350 entries) lives in `specs/i18n/derja-msa.json` and is shared by the frontend and
the backend; administrators extend it from the backoffice (**Governance → Derja map**) based on real
mis-retrieved queries.
