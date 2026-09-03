# 10 — Frontoffice Specification (customer facade)

**Users**: customers and prospects (anonymous or authenticated), and branch/call-centre agents in a
dedicated **agent desk** mode. **Languages**: FR / AR (RTL) / EN. **Surfaces**: standalone web app,
embeddable widget on `albaraka.com.tn`, agent desk.

**Design intent**: an assistant that feels like a competent, discreet bank employee — fast, sourced,
never preachy, never salesy, and visibly honest about what it does not know.

## 1. Channels & surfaces

| Surface | Auth | Audience scope | Notes |
|---|---|---|---|
| Standalone web app (`assistant.albaraka.com.tn`) | optional (Keycloak) | `PUBLIC` | Full history, shareable links, SEO-indexable public KB search |
| Embeddable widget (bank website) | anonymous | `PUBLIC` | Shadow-DOM, lazy-loaded, consent-aware, ≤ 90 KB gzipped loader |
| Agent desk (backoffice route) | required (`branch-agent`) | `PUBLIC` + `INTERNAL` | See §7 |
| Mobile app WebView *(Phase 6)* | inherited | `PUBLIC` | Same API, native shell |

## 2. Personas & jobs to be done

| Persona | Job | Success looks like |
|---|---|---|
| **Prospect** (35, Tunis, salaried) | "Can this bank finance a car without interest, and what would it cost me?" | Understands Mourabaha vs a conventional loan *without* the assistant disparaging anything; sees the margin and the documents needed; books a branch visit |
| **Customer** (50, Sfax, merchant) | "What are my account fees this year? How do I request a financing increase?" | Exact, dated tariff figure with a citation; the procedure as a numbered list |
| **Corporate treasurer** | "How does Moucharaka work for a public contract advance?" | Accurate mechanism, eligibility, and a hand-off to the corporate desk |
| **Devout customer** | "Is this really Sharia-compliant? Who says so?" | Points to the committee, the AAOIFI standards, and the *published* basis — never a personal ruling |
| **Francophone expat** | "Explain your products in English" | Fluent EN answer using the EN glossary renderings |
| **Branch agent** | "Answer this customer's question in front of them, correctly, fast" | Agent desk with `INTERNAL` procedures and one-click copy |

## 3. Conversation UX

### 3.1 Desktop layout (LTR shown; mirrored for AR)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  🟢 Al Baraka · Al-Mouchir        [FR|AR|EN]      [A− A+]      [?]  [Sign in]         │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌── Assistant ────────────────────────────────────────────────────────┐            │
│   │ Bonjour 👋 Je suis Al-Mouchir, l'assistant d'Al Baraka Bank Tunisia. │            │
│   │ Je réponds à partir de la documentation approuvée de la banque.      │            │
│   └──────────────────────────────────────────────────────────────────────┘            │
│                                                                                      │
│   Suggestions:  [Conditions de la Mourabaha]  [Frais de tenue de compte]              │
│                 [Ouvrir un compte]  [Mourabaha ou Ijara ?]  [Agence à la Manouba]     │
│                                                                                      │
│                     ┌── Vous ──────────────────────────────┐                          │
│                     │ Quels documents pour une Mourabaha    │                          │
│                     │ auto ?                                │                          │
│                     └───────────────────────────────────────┘                          │
│   ┌── Assistant ────────────────────────────────────────────────────────┐             │
│   │ ⓘ Je cherche dans la documentation approuvée…                        │             │
│   │ ─────────────────────────────────────────────────────────────────── │             │
│   │ Pour un financement Mourabaha d'un véhicule, la banque demande       │             │
│   │ généralement :                                                       │             │
│   │  1. une copie de la pièce d'identité [S1] ;                          │             │
│   │  2. les trois dernières fiches de paie [S1] ;                        │             │
│   │  3. le devis ou la facture pro forma du véhicule [S2] ;              │             │
│   │  4. un justificatif de revenus pour les non-salariés [S1].           │             │
│   │ La durée est de 12 à 60 mois et la marge bénéficiaire est fixée      │             │
│   │ d'avance [S2].                                                       │             │
│   │                                                                      │             │
│   │ Sources  [S1] Mourabaha — particuliers, v3, valable jusqu'au 31/12   │             │
│   │          [S2] Conditions de banque 2026 — p.14                       │             │
│   │ ───────────────────────────────────────────────────────────────────  │             │
│   │ ⓘ Réponse indicative. Elle ne constitue ni une fatwa ni un avis      │             │
│   │   juridique. Les conditions définitives figurent au contrat signé.   │             │
│   │                                   👍 utile   👎 à améliorer   ⚑ signaler  ⧉ copier │
│   └──────────────────────────────────────────────────────────────────────┘             │
│                                                                                      │
│  ┌──────────────────────────────────────────────────────┐  [🎤]  [ Envoyer ➤ ]        │
│  │ Posez votre question…                                 │                            │
│  └──────────────────────────────────────────────────────┘                             │
│   ⚠ Ne communiquez jamais votre CIN, RIB, code ou mot de passe.    [Parler à un conseiller] │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Arabic (`dir="rtl"`): the whole layout mirrors, the assistant column moves to the right, suggestion
chips flow right-to-left, citation markers `[م1]` remain isolated LTR tokens so digits never reorder.

### 3.2 Message lifecycle in the UI

| Stage | UI |
|---|---|
| `accepted` | User bubble appears immediately; assistant placeholder with the bank's typing indicator |
| `status: RETRIEVING` | Localised status line: «Je cherche dans la documentation approuvée…» / «أبحث في الوثائق المعتمدة…» |
| `sources` | **Citation rail renders before the text** — the user sees provenance first |
| `token*` | Progressive markdown rendering (sanitised, bidi-isated); auto-scroll only if the user hasn't scrolled up |
| `answer` | Disclaimers appended, action row appears (👍 👎 ⚑ ⧉), confidence surfaced subtly (not a number: a wording/behaviour signal) |
| `refusal` | Distinct visual treatment (neutral card, no avatar "speaking"), template text, and the offered next step (committee request ref, hand-off, sources) |
| `error` | Retry button with the same `Idempotency-Key`; if degraded, a localised notice: « Service partiellement disponible — voici les documents les plus pertinents. » |

### 3.3 Answer states the UI must render

| State | Trigger | Presentation |
|---|---|---|
| **Answered** | normal | text + citations + disclaimers + feedback |
| **Answered with caveat** | `caveats[]` non-empty | inline notice, e.g. "tarifs valables au 01/01/2026" |
| **Honest ignorance** | REF-05 | "Je n'ai pas trouvé cette information dans la documentation approuvée." + the 3 closest sources + hand-off CTA. **Never** a made-up answer |
| **No-fatwa** | REF-03 | explanation + "Demander un avis au Comité" button → creates the request, shows the reference |
| **Out of scope** | REF-04/REF-06 | polite redirect (branch, phone, website section) |
| **Blocked** | REF-01/REF-02 | short, firm, non-judgemental; no lecture |
| **Needs human** | `needsHuman=true` | hand-off CTA with support hours |
| **Escalated** | conversation state `ESCALATED` | banner with ticket reference |

## 4. Suggested questions (per locale, admin-editable)

| FR | AR | EN |
|---|---|---|
| Quelles sont les conditions d'une Mourabaha ? | ما هي شروط المرابحة؟ | What are the Murabaha conditions? |
| Quelle différence entre Mourabaha et Ijara ? | ما الفرق بين المرابحة والإجارة؟ | How does Murabaha differ from Ijara? |
| Quels documents pour ouvrir un compte ? | ما الوثائق المطلوبة لفتح حساب؟ | Which documents to open an account? |
| Quels sont les frais de tenue de compte ? | ما هي معاليم مسك الحساب؟ | What are the account maintenance fees? |
| Comment fonctionne la Moudharaba ? | كيف تعمل المضاربة؟ | How does Mudaraba work? |
| Où se trouve l'agence la plus proche ? | أين توجد أقرب وكالة؟ | Where is the nearest branch? |
| La banque finance-t-elle les projets agricoles ? | هل يموّل البنك المشاريع الفلاحية؟ | Does the bank finance agricultural projects? |
| Qu'est-ce qui rend vos financements conformes ? | ما الذي يجعل تمويلاتكم مطابقة للشريعة؟ | What makes your financing Sharia-compliant? |

Suggested questions are `assistant_config` rows (T1) — the marketing team can refresh them weekly
without a release, and the backoffice shows their click-through rate.

## 5. Widget embedding

```html
<script src="https://assistant.albaraka.com.tn/widget/albaraka-assistant.js"
        data-locale="fr" data-theme="light" data-position="bottom-right"
        data-channel="WIDGET" async defer></script>
```

| Requirement | Implementation |
|---|---|
| Isolation | Custom element + **Shadow DOM**; styles cannot leak in or out; no global CSS reset |
| Size | Loader ≤ 90 KB gz; the app bundle is fetched only after the first click (idle prefetch optional) |
| Consent | No cookie, no storage before interaction; anonymous `device_id` created lazily in `sessionStorage`; no third-party scripts, no trackers |
| CSP-friendly | No `unsafe-inline` requirement: styles injected as `adoptedStyleSheets`; nonce support via `data-csp-nonce` |
| Cross-origin | Host page ↔ widget via `postMessage` with an explicit origin allowlist (`open`, `resize`, `locale`, `context`) — the host may pass the current page URL as conversation context |
| API | `window.AlBarakaAssistant.open() / close() / setLocale('ar') / ask(question)` |
| A11y | Launcher is a real `<button>` with `aria-label`; the panel traps focus and closes on `Esc`; `aria-live` on streaming answers |
| Mobile | Full-screen sheet under 640 px; keyboard-aware insets; no horizontal overflow in RTL |
| Fallback | If JS is blocked, a `<noscript>` link to the standalone app |

## 6. Public KB search (transparency page)

A non-chat surface: search the published knowledge base directly, browse by collection/product, read
documents with validity dates and version history. Rationale: customers and the regulator can verify
that the assistant only says what the bank publishes. Also excellent for SEO. Route: `/kb`.

## 7. Agent desk mode (internal)

Same chat component, different affordances:

| Feature | Purpose |
|---|---|
| `INTERNAL` audience | Agents see internal procedures and eligibility criteria customers cannot |
| Customer context pane | Optional, typed manually (never auto-loaded from core banking in v1) and redacted before egress |
| Copy answer | One click copies a formatted, source-attributed answer for email/chat |
| Insert canned response | Approved templates in FR/AR/EN |
| Escalate | To a supervisor or the Sharia committee (creates a `fatwa_request`) |
| Flag for QA | Sends the exchange to the QA queue with the agent's comment |
| Answer-in-customer-language toggle | Agent writes in French, customer sees Arabic (translate the *answer*, keep sources) |

## 8. Accessibility & RTL (concrete requirements)

* `lang` and `dir` set on `<html>` and **per mixed segment** (`<bdi>`), verified by an automated test.
* Keyboard: full conversation navigable; `Esc` closes panels; `Ctrl/⌘+Enter` sends; focus returns to
  the composer after an answer completes.
* Screen readers: streaming answers announced once per sentence group (debounced `aria-live="polite"`),
  citations as labelled buttons, disclaimers as a labelled region, refusals announced with their type.
* Contrast AA on the brand palette; a high-contrast theme; text-size control (A− / A+) persisted.
* Motion reduced for the typing indicator and RTL flip when `prefers-reduced-motion` is set.
* Touch targets ≥ 44 px; the composer grows to 6 lines then scrolls.
* Arabic legibility: base 17 px, line-height 1.9, Noto Naskh Arabic (self-hosted, subsetted).

## 9. Performance budgets

| Metric | Budget |
|---|---|
| Widget loader | ≤ 90 KB gz |
| Standalone app initial bundle | ≤ 250 KB gz |
| LCP | ≤ 2.0 s on 4G mid-range |
| INP | ≤ 200 ms |
| Time to interactive after clicking the launcher | ≤ 1.2 s (bundle prefetched on hover/idle) |
| Perceived answer latency | first token ≤ 1.2 s, complete ≤ 3 s |
| Locale switch (incl. RTL flip) | ≤ 150 ms, no reload |

## 10. Client-side security

* No secrets in the bundle; no API keys; Keycloak public client + PKCE only.
* Tokens kept in memory (not `localStorage`) with a silent-refresh iframe; on the widget, an
  ephemeral session only.
* Markdown rendered through a sanitiser with the allowlist from [doc 07 §5](07-security-iam-compliance.md);
  links restricted to bank domains and `rel="noopener noreferrer nofollow"`.
* CSP: `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`
  (inline styles only for the Shadow-DOM widget), `frame-ancestors` limited to bank properties.
* Input length enforced client-side (4 000 chars) and server-side; paste of > 2 000 chars triggers a
  "this looks like personal data — please don't share it" hint.
* No third-party analytics; telemetry is first-party only (§11).

## 11. Telemetry (privacy-safe, first-party)

Events (no personal data, no free text): `conversation_started`, `suggestion_clicked(id)`,
`message_sent(chars_bucket, lang)`, `answer_rendered(latency_bucket, refusal_code, sources_count)`,
`feedback_given(rating, reason_code)`, `source_opened(id)`, `handoff_requested`, `fatwa_requested`,
`locale_changed(from,to)`, `widget_opened(host_origin_hash)`. Server-side metrics come from
`message`/`retrieval_trace` anyway — client telemetry exists mainly for UX funnel and widget behaviour.
All of it is aggregatable and deletable; retention 13 months.

## 12. Edge cases (must be handled, tested)

| Case | Behaviour |
|---|---|
| User switches language mid-conversation | History stays in its original language; new answers in the new language; a notice explains it |
| User pastes a RIB/CIN | Detected → redacted before egress → gentle warning bubble, message not sent to the provider |
| Very long message (> 4 000 chars) | Client-side limit with a helpful message and a link to the branch contact |
| Repeated identical question | Served from the semantic cache, marked transparently ("réponse mise en cache") only if > 24 h old |
| Network drops mid-stream | The message is persisted server-side; on reconnect the answer is fetched from the conversation endpoint |
| Double submit (double-click) | `Idempotency-Key` deduplicates; button disabled during the request |
| User scrolls up during streaming | Auto-scroll stops; a "↓ nouvelle réponse" pill appears |
| Service disabled (kill switch) | Static trilingual notice with branch phone numbers and opening hours; widget launcher hidden if configured so |
| Rate limited | Countdown message + the public KB search as an alternative |
| Degraded (retrieval-only) | Shows the 3 most relevant sources with an explicit "je ne peux pas formuler de réponse complète pour le moment" |
| Offensive input | REF-01, no lecturing, strike recorded; three strikes → temporary session block |

## 13. E2E test scenarios (Playwright)

1. FR question → FR answer with ≥ 1 citation, disclaimer present, LTR layout.
2. AR question (MSA) → AR answer, RTL layout, `dir="rtl"` on `<html>`, citation markers isolated.
3. AR question in **Derja** → normalised retrieval succeeds, answer in MSA.
4. EN question about a document that exists only in FR → EN answer citing the FR source.
5. Mixed FR/AR sentence → answer in the dominant language, both terms canonical.
6. Religious ruling request → REF-03 + a `fatwa_request` reference is displayed.
7. Interest-rate question → no rate invented, margin terminology used.
8. Unknown topic → REF-05 with the three closest sources, no hallucinated content.
9. PII pasted → warning shown, no provider call (asserted via a mock provider spy).
10. Language switch mid-conversation → chrome flips, RTL applies, history preserved.
11. Widget on a third-party test page → Shadow DOM isolation, no style leak, `postMessage` contract.
12. Keyboard-only full conversation + axe scan with zero violations.
13. Kill switch on → static notice rendered in the current locale.
14. Reconnect after a mid-stream network cut → the answer is recovered from the conversation endpoint.
15. Amounts and dates formatted per locale (TND, three decimals).
