# OpenBridge — 24h plan

## Idea in one paragraph
Banks all "implement" the same Georgian XS2A profile (Berlin Group 1.3.9 → GE 0.8.RC3) yet differ in fields, types, dates, status codes, error bodies, latency. OpenBridge runs the same deterministic tests against every bank, produces evidence (expected vs actual, JSON path, rule id, request/response), measures latency/reliability, checks safe security controls, then uses AI only to *explain and recommend fixes* from that evidence. One bonus: translate Bank B's account data into a canonical model and Bank A's format, flagging missing mandatory fields instead of inventing them.

## Why simulators are legitimate here
Slides 27–28: a runtime benchmark needs approved sandbox + certs + consent state; we have none on a weekend. So: 2 clearly-labelled simulated banks with realistic divergences + config-driven connectors so a real sandbox is a config change. Never claim real-bank compliance.

## Simulated divergences
See the flags in `src/banks/profiles.js` (each one commented with the rulebook rule it breaks) and `docs/RULEBOOK.md`. Alpha follows the rules and has two planted defects; Beta deviates in ~50 documented ways. `npm test` asserts every one is caught under the right rule.

## Status
Done: rulebook (115 rules: 102 implemented, 13 manual -> NBG evidence checklist), rulebook-driven auditor (99 rules evaluated per run), Flow Studio thin slice (canvas, engine, 3 templates, per-tenant published endpoints), transaction details + authorisation resources + decoupled flow, JWS seal signing/verification, TLS probe, consent lifecycle, scoped-consent tests, paging/filter/entryReference tests, latency/reliability, realistic simulators, offline documentation audit, reports, AI layer w/ fallback, canonical transform, 4-screen UI, 87 automated checks.
Not done: card-account services (mandatory in GE §9.4 - not built), payment initiation (§8), real-bank runs, real authentication/multi-tenancy, Studio node library beyond the 9 basic types, flow versioning/rollback.

## Next, by owner
- **Backend:** (1) build the 12 *planned* rules (see `docs/RULEBOOK.md`, status column); (2) get the organiser-confirmed standards edition and diff it against the rulebook; (3) first real-sandbox run once certificates/tokens exist (everything is wired: mTLS, JWS seal, TLS probe) - expect surprises, nothing has touched a real bank; (4) run history + drift: store runs by timestamp, diff two runs ("API change detection"); (5) read the unread parts: BG 1.3.9 full, GE XS2A §8/§9.4/§10.
- **Frontend:** React migration, node inspection and persistent Studio execution history/comparison are implemented under `frontend/` (see `docs/FRONTEND.md`). Next: audit run history + drift view; print-friendly report page (PDF via browser print).
- **AI/data:** prompt-tune `src/ai/explain.js` (output a corrected JSON snippet); add 2nd transform direction; add TBC-style vs BOG-style mapping variants if time.
- **QA/lead:** run `npm test` after every change; incognito-test downloads; check no secrets in `out/`.
- **Pitch:** script below.

## Cut order if late
polish → AI → transform → (never) reports, runner, latency, security.

## Demo script (2:45)
0:00 problem (banks differ, TPP writes per-bank code) · 0:20 two simulated banks + pinned spec, banner visible · 0:50 click Run (uncut, progress log) · 1:20 Auditor tab: Beta's missing `bic`, amount type, date format · 1:45 AI Findings: verified output vs explanation tag, fix snippet · 2:05 Regulatory tab: cross-bank matrix, security `not assessed` rows, transformation w/ missing fields · 2:30 download both reports · 2:45 close: "verify, diagnose, translate".

## Open questions for organisers (ask Monday/now in chat)
1. Which exact package/version is the baseline (SharePoint folder needed sign-in)? 2. Will sandbox credentials/certs arrive? 3. Is a simulator acceptable if labelled? 4. Allowed request rate for load sampling?
