# What the real bank documentation says (and what we have NOT read)

Read on 2026-10-25 via the links in the GITA workshop deck. These are documentation facts, NOT observed bank behaviour.

## Sources read
- BOG OpenAPI (YAML, 472k chars, read in full via 100k-char chunks): https://api.bog.ge/docs/en/redocusaurus/plugin-redoc-0.yaml — server `https://xs2a-sandbox.bog.ge/0.8`
- TBC portal operation pages: aisreadaccountlist, aisreadaccountdetails, aisreadaccountbalance, aisreadaccounttransactionlist, aiscreateconsent, aisoauthtoken (https://developers.tbcbank.ge/reference/...) — server `https://test-openbanking.tbcbank.ge/0.8`
- openfinance.ge/standards (index only)

## Standards documents (read 2026-10-25, saved in `specs/standards/`, hashes in PROVENANCE.json)
- Georgian XS2A Implementation Guide 0.8.RC3 (Georgian language): read §2 (schedule), §4-7 (terms, security, API structure, headers) and §9.1-9.3 (consent, account list/details/balances/transactions) in full. NOT read: §8 payment initiation, §9.4 card accounts, §10 consent screens, §11.
- Georgian JWS Implementation Guide 0.5.RC1: read in full (§1-9).
- Georgian Identification/Authentication/Authorization Guide 0.8.RC1: read §5-8 (certificates, OAuth2, authorisation types, embedded/decoupled rules). Skimmed the usage scenarios.
- Berlin Group NextGenPSD2 1.3.9: read only the HTTP code table (§4.12), error handling (§4.13), message-code table (§14.11) and balance definitions (§14.21-14.22). The rest of its 327 pages is unread.
- Result: `docs/RULEBOOK.md` (113 rules, each with section + printed page). The team made the English paraphrases; the Georgian originals remain authoritative.

## Still NOT read
- TBC: certificate instructions, OAuth authorization, AIS overview. BOG: OAuth/onboarding.
- NBG pages, SharePoint "current package" (needs Microsoft sign-in; organisers must confirm the baseline edition - several rules above may differ in a newer edition).

## Real differences (all documentation-level)
| Topic | BOG | TBC |
|---|---|---|
| Error body | both styles documented: BG `tppMessages[{category,code,text,path}]` (`Error*_NG_AIS`) and problem+json (`type`,`code` required) | `ApiProblemDetails` problem+json (`type,title,status,detail,instance,traceId,code`); 404 is plain `application/json` |
| Response schema strictness | `accountList` requires `accounts`; `accountDetails` requires `currency`; `balance` requires `balanceAmount`+`balanceType`; `transactions` requires `transactionAmount`; `accountReport` requires `_links`; extensions allowed | every field nullable, **nothing required**, `additionalProperties:false` (so the published example with `_links`/`ownerIdentification` violates its own schema) |
| Links | `_links` | schema says `links`, examples say `_links` |
| Amount | string, regex `-?[0-9]{1,14}(\.[0-9]{1,3})?` (max 3 decimals) | string, up to 14 significant digits |
| bookingStatus | **required**: information, booked, pending, both, all | not flagged required: booked, pending, both |
| dateFrom/dateTo | format `date` | typed `date-time` (example uses date) |
| Signature headers | Digest, `x-jws-signature` not required in schema; PSU-IP-Address ipv4 optional on AIS, **mandatory on create-consent** | Digest, X-JWS-Signature, PSU-IP-Address all flagged required (descriptions say conditional); create-consent also requires TPP-Redirect-URI |
| Consent request | 5 required: access, recurringIndicator, validUntil, frequencyPerDay, combinedServiceIndicator (boolean) | same 5; validUntil max 90 days (reduced silently), frequencyPerDay 1..4; example uses capitalised keys / timestamp (inconsistent with schema) |
| consentStatus enum | + `partiallyAuthorised` | received, rejected, valid, revokedByPsu, expired, terminatedByTpp |
| Extra consent ops | GET consent, GET status, DELETE (204), authorisations (SCA) | not in the pages read |
| Token | not read | `POST /0.8/openbanking/oauth/token`, form-encoded, grants authorization_code / refresh_token / client_credentials (decoupled), `client_id` required |
| Multicurrency | — | example account `currency: "XXX"` with balances in GEL/USD/EUR |
| Timestamps | — | example balance `lastChangeDateTime: 2025-03-26T00:00:00` (no offset; RFC 3339 trap) |
| Account `product`, ownerName | example has ownerName/product/cashAccountType | example has Georgian-script `ownerName`/`displayName`, `status: enabled`, `usage: PRIV` |

## How this changed OpenBridge
- Auditor now accepts **either** documented error style and records the style as an observation (a bank using TBC-style problem+json must not be flagged).
- Amount format tightened to the BOG regex (<= 3 decimals).
- New simulator behaviours copied from the docs: problem+json errors, `XXX` multicurrency account, Georgian-script owner names, consent GET/status/DELETE, frequencyPerDay <= 4, no-TZ timestamps.
- New tests: consent request validation, string-boolean consent, X-Request-ID required/echo, pagination via `_links.next`, dateFrom filter, revoked-consent enforcement, multicurrency handling, IBAN checksum, balance-currency consistency.

## Offline documentation audit (built)
`npm run docaudit` validates every published example against its own schema, compares BOG vs TBC schemas/parameters/errors, and checks the GE profile rules against each schema. Reproduces the workshop's saved result exactly: 30 examples, 22 pass, 8 fail (5 root causes). Findings are classed as documentation inconsistency / schema coverage / applicability question / contract difference, each with source file + sha256 and an explicit limitation. Claims stay documentary: nothing here says a bank server behaves a given way.

## Ideas this unlocks (not built)
1. Capture the real bank OpenAPI/examples into `specs/` with retrieval date + hash (provenance, slide 31).
