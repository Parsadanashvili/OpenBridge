# OpenBridge Rulebook

Generated from `src/spec/rulebook.js`. **115 rules** extracted by reading the Georgian open-banking standards (and the Berlin Group base) - every rule cites section and printed page.

| Status | Count | Meaning |
|---|---|---|
| implemented | 102 | executed by the auditor against sandboxes/simulators |
| planned | 0 | testable, not built yet |
| manual | 13 | needs certificates/organiser evidence/human review |

Levels: MUST 97 · SHOULD 5 · MUST NOT 12 · MAY 1

Sources (full PDFs saved in `specs/standards/`, hashes in `specs/PROVENANCE.json`): GE XS2A Implementation Guide 0.8.RC3 · GE JWS Guide 0.5.RC1 · GE Identification/Authentication/Authorization Guide 0.8.RC1 · Berlin Group NextGenPSD2 1.3.9.

> The Georgian guides are written in Georgian; rules here are English paraphrases made by the team. Where wording is ambiguous the rule says so. This is a team-made catalogue, **not an official NBG artefact**.

## Transport & message security

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-SEC-TLS12` | MUST | **TLS 1.2 or higher.** The channel between TPP and ASPSP must use TLS 1.2 or higher. | GE XS2A 0.8.RC3 §5.2, p.11 | implemented |
| `GE-SEC-MTLS` | MUST | **Mutual TLS with X.509 certificates.** Both parties present X.509 certificates when the connection is established. | GE XS2A 0.8.RC3 §5.2, p.11 | implemented |
| `GE-SEC-CERT-QWAC` | MUST | **Certificate profile and identifier.** Certificates must satisfy qualified website-authentication certificate requirements, contain the PSDGE-NBG-<suffix> identifier and the PSD2 roles, and be issued by an issuer accepted for Georgian open banking. *(Needs the organiser-issued test certificates; inspect subject/organizationIdentifier.)* | GE XS2A 0.8.RC3 §5.1-5.2, p.10-11 | manual |
| `GE-SEC-CLIENTID` | MUST | **client_id equals the PSDGE-NBG identifier.** The OAuth2 client_id must strictly (case-sensitively) equal the provider identifier PSDGE-NBG-<suffix>. | GE XS2A 0.8.RC3 §5.1, §5.3, p.10-11 | manual |
| `GE-SEC-OCSP` | MUST | **Certificate status checked via OCSP.** Certificate validity must be checked using OCSP; supporting OCSP stapling is recommended and, once one side advertises it, the other must return the OCSP response. *(The probe reports stapling presence (SHOULD part); the MUST part is a behaviour of the verifier.)* | GE XS2A 0.8.RC3 §5.5, p.12 | implemented |
| `GE-SEC-SEAL` | MUST | **Electronic seal on requests AND responses.** Every request from the TPP and every response from the ASPSP carries an electronic seal (JWS profile). The XS2A-native seal form must NOT be used. | GE XS2A 0.8.RC3 §5.4, §7.4, p.11-14 | implemented |
| `GE-SEC-UTC` | MUST | **Clocks synchronised to UTC, 2 s tolerance.** Participants synchronise to UTC and must not process a message whose timestamp is more than 2 seconds ahead of the local clock. | GE XS2A 0.8.RC3 §7.4, p.14-15 | implemented |
| `GE-SEC-LINKS` | MUST | **Hyperlinks returned by the ASPSP must belong to the ASPSP.** The TPP must verify every hyperlink the ASPSP returns really points to that ASPSP (certificate CN/SAN comparison). | GE XS2A 0.8.RC3 §5.6, p.13 | implemented |
| `GE-SEC-NOCACHE` | SHOULD | **No caching of account data.** Best practice (not a GE clause): sensitive financial responses should be sent with Cache-Control: no-store. | BG NextGenPSD2 1.3.9 general, p.- | implemented |

## JWS signing profile

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-JWS-SIGN` | MUST | **Both HTTP headers and body are protected.** API requests and responses are JWS-signed; the signature protects the selected HTTP headers and the body (via Digest). | GE JWS 0.5.RC1 §5, p.5 | implemented |
| `GE-JWS-HEADER` | MUST | **x-jws-signature header carries the JWS.** The signature value is transported in the x-jws-signature HTTP header (detached form header..signature). | GE JWS 0.5.RC1 §7, §9.9, p.12, 19 | implemented |
| `GE-JWS-B64` | MUST | **b64 must be false.** The protected header contains "b64": false. | GE JWS 0.5.RC1 §6, p.8 | implemented |
| `GE-JWS-ALG` | MUST | **Allowed algorithms; never "none".** alg must be one of RS256, RS512, ES256, ES512, PS256, PS512; the value "none" must never be used. Participants must support all six plus SHA-256/SHA-512. | GE JWS 0.5.RC1 §5.1, p.7 | implemented |
| `GE-JWS-X5C` | MUST | **x5c contains exactly the signing certificate.** x5c is present (unless the parties agreed otherwise) and contains a single entry: the signing certificate. | GE JWS 0.5.RC1 §6, §8.1, p.10, 14 | implemented |
| `GE-JWS-NOX5T` | MUST NOT | **No x5c together with x5t#S256; no jwk; no x5t (SHA-1).** x5c and x5t#S256 must not be used together; jwk and x5t must never be used. | GE JWS 0.5.RC1 §5, §6, p.6, 9-10 | implemented |
| `GE-JWS-CRIT` | MUST | **crit lists the critical header fields.** crit is mandatory and must name the critical fields used (sigT, sigD, b64). | GE JWS 0.5.RC1 §6, p.11 | implemented |
| `GE-JWS-SIGT` | MUST | **sigT in UTC without fractional seconds.** sigT is mandatory, UTC, format YYYY-MM-DDThh:mm:ssZ, never with fractional seconds, and reflects the actual time of the transaction. The HTTP Date header must never be taken as the signing time. | GE JWS 0.5.RC1 §5, §6, p.6, 11 | implemented |
| `GE-JWS-SKEW` | MUST | **Reject messages with bad sigT skew.** A message must not be processed if sigT is more than 2 s ahead of the local clock or more than 60 s behind it. | GE JWS 0.5.RC1 §5, p.6 | implemented |
| `GE-JWS-MID` | MUST | **sigD.mId = ETSI HttpHeaders.** sigD.mId is http://uri.etsi.org/19182/HttpHeaders and sigD.pars lists the processed headers in hashing order. | GE JWS 0.5.RC1 §6, p.11 | implemented |
| `GE-JWS-PARS` | MUST | **Mandatory protected headers.** The signature covers Content-Type and Digest (and for responses the (response-status) pseudo-header; for requests (request-target) and Host), plus all PSU-* headers and X-Request-ID when present. Date is not recommended. | GE JWS 0.5.RC1 §7, p.12-13 | implemented |
| `GE-JWS-DIGEST` | MUST | **Digest equals the hash of the body.** The Digest header carries the SHA-256 (or SHA-512) hash of the HTTP body in the form SHA-256=<base64>. | GE JWS 0.5.RC1 §7, §9.4, p.12, 17 | implemented |
| `GE-JWS-VERIFY` | MUST | **Signature value verifies.** The JWS signature must verify over BASE64URL(header) "." header-lines using the certificate in x5c. | GE JWS 0.5.RC1 §9.5-9.8, p.18-19 | implemented |
| `GE-JWS-COMPACT` | MUST | **Protected header is single-line, unescaped JSON.** The protected header is generated as one line without line breaks, extra spaces or escape characters, using lowercase characters as specified. | GE JWS 0.5.RC1 §5, p.6-7 | implemented |
| `GE-JWS-TYP` | SHOULD | **typ not recommended.** The typ field is not recommended; if used, the value must be JOSE (upper case). | GE JWS 0.5.RC1 §6, p.10 | implemented |
| `GE-JWS-CHAIN` | MUST | **Certificate path and revocation of the signer.** Signing certificates issued by a subordinate CA need x5u with the chain; the receiver must check the certificate and all intermediates are not revoked or suspended. | GE JWS 0.5.RC1 §8.2-8.3, p.14-15 | manual |
| `GE-JWS-ENCODING` | MUST | **Content-Encoding handling.** Signatures are made over the un-encoded body; Content-Encoding is only listed in pars when the signer signs an already-encoded body. | GE JWS 0.5.RC1 §5.2, p.7-8 | implemented |

## API structure

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-API-URL` | MUST | **Resource URL layout.** Resources are https://{provider}/{version}/v1/{service}; version is the first two levels of the guide version (0.8); production and test environments are separated through the {provider} part. | GE XS2A 0.8.RC3 §7.1, p.13-14 | implemented |
| `GE-API-JSON` | MUST | **JSON requests and responses.** JSON must be supported for requests and responses; other formats are optional but must be documented. | GE XS2A 0.8.RC3 §7.2, p.14 | implemented |
| `GE-API-HTTPCODES` | MUST | **HTTP codes follow Berlin Group 4.12 and error info 4.13.2.** Status codes and extended error information follow the BG tables (see GE-ERR-* rules). | GE XS2A 0.8.RC3 §7.3, p.14 | implemented |
| `GE-API-REQID` | MUST | **X-Request-ID is a UUID on every request.** Every request carries an X-Request-ID UUID header; it lets the ASPSP detect repeated requests (idempotency). | GE XS2A 0.8.RC3 §7.7, p.17 | implemented |
| `GE-API-REQID-ECHO` | MUST | **X-Request-ID is returned on responses.** The response (including error responses where functional processing happened) returns the X-Request-ID of the request. | BG NextGenPSD2 1.3.9 §4.13.1 / operation response headers, p.39 | implemented |
| `GE-API-LANG` | SHOULD | **Language handling.** ASPSP honours Accept-Language; if unknown it assumes Georgian/Georgia; Content-Language should be returned. | GE XS2A 0.8.RC3 §7.5, p.15 | implemented |
| `GE-API-PARTYID` | MUST | **PartyIdentification layout.** Legal persons: organisationId.others[].identification e.g. NTRGE-123456789; natural persons: privateId.others[].identification e.g. PNOGE-01234567890 (same values as PSU-ID / PSU-Corporate-ID). | GE XS2A 0.8.RC3 §7.6.1, p.15-16 | implemented |

## Errors

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-ERR-MAP` | MUST | **Message code <-> HTTP status mapping.** Error bodies carry a code from BG 14.11 and the HTTP status matches the table: FORMAT_ERROR 400; PERIOD_INVALID 400; PARAMETER_NOT_CONSISTENT 400; CONSENT_UNKNOWN 403 (if in path) / 400 (if in header); CONSENT_INVALID 401; CONSENT_EXPIRED 401; TOKEN_UNKNOWN/INVALID/EXPIRED 401; SIGNATURE_MISSING/INVALID 401; CERTIFICATE_* 401; RESOURCE_UNKNOWN 404 (account-id in path); SERVICE_INVALID 400/405. | BG NextGenPSD2 1.3.9 §14.11.1, p.284-286 | implemented |
| `GE-ERR-FORMAT` | MUST | **Error body style.** Additional error information uses either the NextGenPSD2 tppMessages structure ({category:"ERROR", code, text}) or RFC 7807 problem+json with the BG code; both are allowed, but a body without a BG message code is not. | BG NextGenPSD2 1.3.9 §4.13.3, p.39-40 | implemented |
| `GE-ERR-404` | MUST | **Unknown account-id returns 404 RESOURCE_UNKNOWN.** An account-id in the path that the TPP cannot reference returns 404 (not 403) with RESOURCE_UNKNOWN. | BG NextGenPSD2 1.3.9 §4.12, §14.11.1, p.38, 286 | implemented |
| `GE-ERR-INSUFFICIENT-SCOPE` | MUST | **Insufficient consent scope gives CONSENT_INVALID, not a reduced document.** If the consent does not cover the request (e.g. withBalance=true without balance consent), the call must fail with CONSENT_INVALID instead of silently returning less data. | GE XS2A 0.8.RC3 §9.3.1, p.56 | implemented |

## Consent

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-CNS-FIELDS` | MUST | **Consent request has five required fields.** access, frequencyPerDay, recurringIndicator, validUntil and combinedServiceIndicator form the consent request document. | GE XS2A 0.8.RC3 §9.1.1; BOG/TBC schemas, p.41 | implemented |
| `GE-CNS-ONCE` | MUST | **One-off consent has frequencyPerDay = 1.** If recurringIndicator is false, frequencyPerDay must equal 1; otherwise the ASPSP must not register the consent and returns an error. | GE XS2A 0.8.RC3 §9.1.1.3, p.45 | implemented |
| `GE-CNS-90D` | MUST | **validUntil more than 90 days ahead -> PERIOD_INVALID.** A validUntil more than 90 days after the request is answered with PERIOD_INVALID (HTTP 400). Exception: 9999-12-31 is accepted and reduced to the maximum (<=90 days), the changed date being returned by the consent details service. NOTE: the TBC portal text says the date is silently reduced; the guide says reject - applicability must be confirmed. | GE XS2A 0.8.RC3 §9.1.1.10, p.49 | implemented |
| `GE-CNS-ALLPSD2` | MUST NOT | **Global consent allPsd2 unsupported.** allPsd2 must not be used by TPPs; an ASPSP receiving it must return an error. | GE XS2A 0.8.RC3 §9.1.1.1, p.43 | implemented |
| `GE-CNS-EMPTYARR` | MUST | **Empty arrays require PSU selection with SCA.** accounts/balances/transactions = [] means the PSU selects accounts in the bank; the ASPSP must require strong authentication and must not make the combined consent mandatory. | GE XS2A 0.8.RC3 §9.1.1.1, §9.2.1, p.42, 54 | implemented |
| `GE-CNS-NOTVALID` | MUST NOT | **No consentStatus=valid without authentication.** The ASPSP may answer valid immediately only when a valid OAuth2 token is presented and regulation allows it; otherwise it must NOT return valid and must request PSU authentication. | GE XS2A 0.8.RC3 §9.2.1.1, p.54 | implemented |
| `GE-CNS-OAUTH-REDIRECT` | MUST | **Redirect authorisation is OAuth2.** Redirect-type authorisation must be OAuth2 (scaOAuth link); the ASPSP must not require non-OAuth redirect authorisation (BG scaRedirect without OAuth2). | GE IAA 0.8.RC1 §6.5, §6.7, p.11, 14 | implemented |
| `GE-CNS-LINKS` | MUST | **Only the four permitted startAuthorisation* links.** When authorisation resources are created explicitly the ASPSP returns one of startAuthorisation, startAuthorisationWithPsuIdentification, ...WithAuthenticationMethodSelection, ...WithTransactionAuthorisation and no other startAuthorisation* links. | GE IAA 0.8.RC1 §6.4, p.10 | implemented |
| `GE-CNS-STATUS` | MUST | **Consent status service.** GET /v1/consents/{id}/status is supported and returns consentStatus; after revocation it returns revokedByPsu. | GE XS2A 0.8.RC3 §9.2.2, §9.1.3.1, p.53, 55 | implemented |
| `GE-CNS-DETAILS` | MUST | **Consent details return the submitted document.** GET /v1/consents/{id} returns the document that was registered; only validUntil may differ (per the 90-day rule). Card numbers are always masked. | GE XS2A 0.8.RC3 §9.2.3, p.55-56 | implemented |
| `GE-CNS-NOTOKEN` | MUST | **Consent registration works without an Authorization header.** The ASPSP must support consent registration when the TPP sends no Authorization header (the first operation of a new customer has no token yet). If a token is sent it must come from a PSU authentication. | GE XS2A 0.8.RC3 §9.2.1; IAA §6.1, p.53; 8 | implemented |
| `GE-CNS-DELETE` | MUST | **Consent can be revoked (DELETE -> 204).** DELETE /v1/consents/{id} is supported; afterwards API calls on that consent fail with CONSENT_INVALID and status becomes revokedByPsu. | GE XS2A 0.8.RC3 §9.2.4, §9.1.3.1, p.53, 56 | implemented |
| `GE-CNS-UNKNOWN` | MUST | **Unknown Consent-ID header -> 400 CONSENT_UNKNOWN.** A Consent-ID header that cannot be matched returns CONSENT_UNKNOWN with HTTP 400 (403 only if the id is in the path). | BG NextGenPSD2 1.3.9 §14.11.1, p.285 | implemented |
| `GE-CNS-EXPIRED` | MUST | **Expired consent -> CONSENT_EXPIRED even if the range fits.** If the consent is no longer valid the ASPSP returns no data and fails with CONSENT_EXPIRED, regardless of whether the requested range lies inside the consent period. | GE XS2A 0.8.RC3 §9.3.6, p.67 | implemented |
| `GE-CNS-HEADERS` | MUST | **Authorization + Consent-ID on every AIS call.** All account services receive Authorization and Consent-ID; the bearer token is the one used when the consent was confirmed (or its refreshed successor). | GE XS2A 0.8.RC3 §9.3.1, p.56 | implemented |
| `GE-CNS-FREQ` | MUST | **frequencyPerDay is a 24-hour window and only limits TPP-initiated access.** frequencyPerDay counts requests in any 24-hour window; it applies only to TPP-initiated requests, never to PSU-active ones. PSU-IP-Address is sent if and only if the PSU is actively requesting. | GE XS2A 0.8.RC3 §9.1.1.6, p.46-47 | implemented |
| `GE-CNS-PSUIP` | MUST | **PSU-IP-Address on consent creation.** The consent-registration call must carry PSU-IP-Address. | GE XS2A 0.8.RC3 §9.1.1.6 note, p.46 | implemented |
| `GE-CNS-REDIRECT-URI` | MUST | **TPP-Redirect-URI is always supplied for redirect flows.** For redirect authentication the TPP always passes TPP-Redirect-URI (even where the BG spec marks it optional); the ASPSP checks it against the TPP certificate CN/SAN. | GE IAA 0.8.RC1 §5.6, p.7 | implemented |

## Accounts

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-ACC-SUPPORTED` | MUST | **List, details, balances and transactions are mandatory services.** GET /v1/accounts, /accounts/{id}, /balances and /transactions must be supported. | GE XS2A 0.8.RC3 §9.3.3-9.3.6, p.57-66 | implemented |
| `GE-ACC-RESID-TOKEN` | MUST | **resourceId is a one-way token.** ResourceID values must be tokenised unique one-way tokens so account numbers do not leak into URIs; UUID is recommended. | GE XS2A 0.8.RC3 §9.3.2, p.57 | implemented |
| `GE-ACC-RESID-UNIQUE` | MUST | **resourceId unique and stable.** resourceId is unique per record (multicurrency aggregated "XXX" and each sub-account differ) and stays unchanged at least for the consent lifetime. | GE XS2A 0.8.RC3 §9.3.3, p.57-58 | implemented |
| `GE-ACC-LIST-IBAN` | MUST | **List: iban, currency, cashAccountType, bic mandatory.** Mandatory in each list item: iban, currency, cashAccountType, bic. product is optional in the list; name/displayName conditional. | GE XS2A 0.8.RC3 §9.3.3, Table 9, p.58-59 | implemented |
| `GE-ACC-DET-FIELDS` | MUST | **Details: resourceId, iban, currency, product, cashAccountType, bic mandatory.** Account details require resourceId, iban, currency, product, cashAccountType and bic. | GE XS2A 0.8.RC3 §9.3.4, Table 8, p.62-64 | implemented |
| `GE-ACC-BBAN-NEVER` | MUST NOT | **bban and linkedAccounts are never returned.** bban and linkedAccounts must never be returned. | GE XS2A 0.8.RC3 §9.3.3, §9.3.4, p.58-59, 62-64 | implemented |
| `GE-ACC-CUR-XXX` | MUST | **Multicurrency accounts use currency XXX.** Multicurrency accounts return currency XXX (aggregated record) in addition to each currency sub-account; balances at the XXX level are returned per currency. | GE XS2A 0.8.RC3 §9.3.3, §9.3.4, §9.1.1.9, p.58, 61-65, 48 | implemented |
| `GE-ACC-MULTI-SCOPE` | MUST NOT | **Aggregated record only when consent covers the whole account.** If consent covers only one currency of a multicurrency account, the aggregated (XXX) record must not be returned. | GE XS2A 0.8.RC3 §9.3.3 item 5, p.61 | implemented |
| `GE-ACC-OWNER` | MUST NOT | **ownerName only with explicit consent.** ownerName (and ownerIdentification) is returned only when consent for it was explicitly given (e.g. allAccountsWithOwnerName / additionalInformation.ownerName); otherwise it must never be returned. | GE XS2A 0.8.RC3 §9.3.3, §9.3.4, §9.1.1.8, p.58, 62-63, 47-48 | implemented |
| `GE-ACC-NAME` | MUST | **name when displayName empty.** name must be returned when displayName is empty; displayName is returned if the PSU defined one (internet/mobile bank name preferred). | GE XS2A 0.8.RC3 §9.3.3, p.58 | implemented |
| `GE-ACC-CATYPE` | SHOULD | **cashAccountType limited to CACC and CARD.** For this version it is preferable to use only the values CACC and CARD (the schema allows others). | GE XS2A 0.8.RC3 §9.3.3, p.59 | implemented |
| `GE-ACC-CARD` | MUST | **CARD returned for accounts with a linked card.** cashAccountType must be CARD if a payment card is, or ever was, linked to the open-banking account. *(Needs knowledge of card linkage on the test customer.)* | GE XS2A 0.8.RC3 §9.3.3, §9.3.4, p.59, 63 | manual |
| `GE-ACC-STATUS` | MUST | **status values blocked / deleted.** status = blocked if use is restricted (e.g. seizure); closed accounts that other channels still show are returned as deleted; otherwise optional. | GE XS2A 0.8.RC3 §9.3.3, p.59 | implemented |
| `GE-ACC-USAGE` | MUST | **usage only PRIV or ORGA, and only when certain.** usage is PRIV or ORGA when the ASPSP can determine it with certainty; otherwise it must not be returned. | GE XS2A 0.8.RC3 §9.3.3, p.59 | implemented |
| `GE-ACC-DETAILS-FIELD` | MUST NOT | **details field only for blocked accounts (list).** In the account list the details field is returned only when status = blocked (to state the reason); otherwise it must not be returned. | GE XS2A 0.8.RC3 §9.3.3, Table 9, p.59-60 | implemented |
| `GE-ACC-BAL-FLAG` | MUST | **balances element follows withBalance.** With withBalance=true and matching consent balances must be returned; with withBalance=false or absent the balances element must never be returned. | GE XS2A 0.8.RC3 §9.3.3, Table 9, p.60 | implemented |
| `GE-ACC-BAL-LIST` | MUST | **List balances contain at least one interim balance.** When the list returns balances, at least one interim-type balance is present; interimAvailable preferred. | GE XS2A 0.8.RC3 §9.3.3, Table 9, p.60 | implemented |
| `GE-ACC-BAL-DETAILS` | MUST | **Details balances: interimAvailable and interimBooked.** For accounts whose balance can change through electronic channels, account details include balances (when consented) with at least interimAvailable and interimBooked. | GE XS2A 0.8.RC3 §9.3.4, p.62 | implemented |
| `GE-ACC-LINKS-SCOPE` | MUST | **balances/transactions links follow consent.** balances/transactions hyperlinks must not be returned when the consent does not cover them and must be returned when it does; links never reveal account/card numbers and stay constant during the consent. | GE XS2A 0.8.RC3 §9.3.3, §9.3.4, p.60-62 | implemented |
| `GE-ACC-NO-OVERSHARE` | MUST NOT | **Never return what the consent did not grant.** No details beyond the consent may be returned: no balances for availableAccounts consents, no transactions on available accounts, no owner name without consent. | GE XS2A 0.8.RC3 §9.3.3 items 1-3, p.61 | implemented |

## Balances

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-BAL-TYPES` | MUST | **Balances endpoint returns closingBooked and interimAvailable.** GET .../balances returns at least closingBooked and interimAvailable; for multicurrency each currency is returned separately. | GE XS2A 0.8.RC3 §9.3.5, p.65 | implemented |
| `GE-BAL-DATES` | MUST | **referenceDate on *Booked, lastChangeDateTime on Interim*.** Every *Booked balance carries referenceDate (the banking day); every Interim* balance carries lastChangeDateTime (UTC date-time with offset). | GE XS2A 0.8.RC3 §9.3.6.2, p.69-70 | implemented |
| `GE-BAL-ACCOUNT` | SHOULD | **account attribute present.** The account attribute should be returned to support later versions. | GE XS2A 0.8.RC3 §9.3.5, p.65 | implemented |
| `GE-BAL-AMOUNT` | MUST | **Amounts are decimal strings; negative with minus.** Amounts are strings with a dot as decimal separator, negative values prefixed with minus (BOG schema: up to 14 integer digits and 3 decimals). | BG NextGenPSD2 1.3.9 §14.3; BOG schema, p.- | implemented |

## Transactions

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-TX-DATES` | MUST | **dateFrom and dateTo supported; dateTo optional (=now).** dateFrom and dateTo must be supported; dateTo is optional and defaults to the moment of the call; dateFrom-only is recommended. | GE XS2A 0.8.RC3 §9.3.6, p.66 | implemented |
| `GE-TX-ENTRYREFFROM` | MUST | **entryReferenceFrom supported (exclusive).** Calling without dateFrom but with entryReferenceFrom returns the transactions after the one with that entryReference; the referenced one is never included. The TPP never invents the value. | GE XS2A 0.8.RC3 §9.3.6, §9.3.6.1, p.66, 68 | implemented |
| `GE-TX-STATUS` | MUST | **bookingStatus booked, pending and both supported.** booked, pending and both must be supported; information is optional. | GE XS2A 0.8.RC3 §9.3.6, p.66 | implemented |
| `GE-TX-PAGE50` | MUST | **At most 50 records per portion.** If more than 50 transactions match, the response is split; each portion contains at most 50 (unless agreed bilaterally). | GE XS2A 0.8.RC3 §9.3.6.1, p.67 | implemented |
| `GE-TX-LINKS` | MUST | **first/next link semantics.** First and middle portions carry first and next; the last portion carries only first; first always equals the address used for the call; next should use entryReferenceFrom. | GE XS2A 0.8.RC3 §9.3.6.1, p.67 | implemented |
| `GE-TX-ONCE` | MUST | **No record repeated across portions.** Each transaction appears exactly once across all portions of one retrieval. | GE XS2A 0.8.RC3 §9.3.6.1, §9.3.6.6, p.67, 72 | implemented |
| `GE-TX-SORT` | MUST | **Booked transactions sorted by bookingDate.** Booked transactions are sorted ascending or descending by bookingDate (consistently). | GE XS2A 0.8.RC3 §9.3.6.2, p.68 | implemented |
| `GE-TX-HISTORY` | MUST NOT | **History not limited to the consent date.** While the consent is valid the ASPSP must not restrict the retrieval of historical transactions to the consent date; only law limits history. | GE XS2A 0.8.RC3 §9.3.6, p.67 | implemented |
| `GE-TX-BALANCES` | MUST | **balances section with transactions.** If the consent covers balances and bookingStatus is not information, the transaction response contains a balances section built per tables 9.3.6.2-9.3.6.4 (openingBooked for the start date; closingBooked/interimBooked/interimAvailable for the end date). | GE XS2A 0.8.RC3 §9.3.6, §9.3.6.2-9.3.6.4, p.67-71 | implemented |
| `GE-TX-ENTRYREF` | MUST | **entryReference mandatory and unique within the consent.** Every transaction carries entryReference (Max35Text) unique at least within the consent regardless of booked/pending; unchanged except in the cancellation case. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.71-72 | implemented |
| `GE-TX-AMOUNT` | MUST | **transactionAmount sign convention.** Debits are negative, credits positive, formatted per BG 14.3. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.72 | implemented |
| `GE-TX-VALUEDATE` | MUST | **valueDate mandatory.** valueDate is mandatory on each transaction. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.72 | implemented |
| `GE-TX-BOOKINGDATE` | MUST | **bookingDate on booked entries.** bookingDate is mandatory in the booked list. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.72-73 | implemented |
| `GE-TX-CURRENCYEXCH` | MUST | **currencyExchange when booked in another currency.** currencyExchange is mandatory if the transaction was booked in a different currency. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.73 | implemented |
| `GE-TX-REMITTANCE` | MUST | **Payment purpose returned unchanged.** One of remittanceInformationUnstructured / ...Array is returned when it exists in the bank system, byte-for-byte unchanged (Unicode/Georgian text preserved). The Array form is preferred; the short form requires the full text via transaction details. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.73-74 | implemented |
| `GE-TX-TXID` | MUST NOT | **transactionId only when a details service exists.** transactionId is returned only if the transaction details service (additional info by separate call) is implemented; then it must equal entryReference unless the ASPSP guarantees stable entryReference. | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.74-75 | implemented |
| `GE-TX-COUNTERPARTY-ACCT` | MUST | **Counterparty account by direction.** For credits debtorAccount is mandatory; for debits creditorAccount is mandatory (agent BIC where identifiable; Treasury code per 7.6.2). | GE XS2A 0.8.RC3 §9.3.6.6, Table 10, p.76-77 | implemented |
| `GE-TX-COUNTERPARTY-NAME` | MUST | **Counterparty name only with OwnerName consent.** debtorName/creditorName are returned when OwnerName-type consent was given; the general rule that data beyond the consent is never returned applies otherwise. (Card merchant names: applicability to be confirmed.) *(Ambiguous for merchant/card counterparties.)* | GE XS2A 0.8.RC3 §9.3.6.6, Table 10; §9.3.3, p.76-77, 61 | manual |
| `GE-TX-DETAILS` | MUST | **Transaction details service when the list is incomplete.** GET /v1/accounts/{id}/transactions/{transactionId} is optional only if the list already returns the full information of 9.3.6.6 (e.g. the full payment purpose). If the list truncates it (remittanceInformationUnstructured > 140 chars without the Array form), the details service is mandatory. | GE XS2A 0.8.RC3 §9.3.7, p.79 | implemented |
| `GE-TX-INFOONLY` | MAY | **bookingStatus=information optional.** Standing-order information via bookingStatus=information is not mandatory in this version. | GE XS2A 0.8.RC3 §9.3.6.5, p.71 | manual |
| `GE-TX-TODAY` | MUST | **Today's certain bookings appear in booked.** When the range includes the current banking day, booked also returns items known to be booked during that day. | GE XS2A 0.8.RC3 §9.3.6, p.66-67 | implemented |
| `GE-TX-CONSISTENT` | MUST | **PARAMETER_NOT_CONSISTENT for cancelled entryReferenceFrom.** If the booked entry referenced by entryReferenceFrom (or its predecessor) was cancelled, return PARAMETER_NOT_CONSISTENT and never repeat identifiers; for a cancelled pending entry never return an error. | GE XS2A 0.8.RC3 §9.3.6.1, p.68 | implemented |

## Authentication / OAuth2

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-AUTH-OAUTH` | MUST | **OAuth2 bearer tokens on API calls.** Business API calls use OAuth2 access tokens in Authorization: Bearer; tokens are issued by the ASPSP. | GE IAA 0.8.RC1 §6.1, §6.5, p.8-9, 12 | implemented |
| `GE-AUTH-NOANON` | MUST | **Requests without a valid token are rejected with 401.** Calls without or with an invalid token fail with 401 TOKEN_*. | BG NextGenPSD2 1.3.9 §14.11.1, p.285-286 | implemented |
| `GE-AUTH-CODEGRANT` | MUST | **Authorization Code Grant for strong authentication.** Strong customer authentication with redirect uses the OAuth2 Authorization Code Grant. | GE IAA 0.8.RC1 §6.7, p.14 | manual |
| `GE-AUTH-NOCONFIRM` | MUST NOT | **No confirmation link for redirect.** With OAuth2 redirect the ASPSP must not return a confirmation hyperlink or demand token-receipt confirmation. | GE IAA 0.8.RC1 §6.7, p.14 | implemented |
| `GE-AUTH-CLIENTCRED` | MUST | **Client-credentials tokens after embedded/decoupled authentication.** The OAuth2 service can issue a Client Credentials Grant token after embedded or decoupled authentication; status endpoint then returns the OAuth2 metadata link (ofge:psuPreOAuth or scaOAuth). | GE IAA 0.8.RC1 §6.8, §8.2, p.14, 24 | manual |
| `GE-AUTH-CURIES` | MUST | **Hyperlink prefix ofge declared.** When returning ofge:* relations the _links section declares the curie ofge -> https://openfinance.ge/relations/{rel}. | GE IAA 0.8.RC1 §8.1, p.23 | implemented |
| `GE-AUTH-EMBEDDED` | MUST | **Embedded authentication: single dynamic factor, <=5 min.** Embedded authentication uses only dynamically generated data (OTP) valid at most 5 minutes; no static password/PIN or static biometrics; challenge >= 6 characters for SMS/e-mail/push OTP; OTP bound to one authorisation resource. | GE IAA 0.8.RC1 §6.5, §6.12, p.11, 18-19 | manual |
| `GE-AUTH-RESOURCES` | MUST | **Authorisation resources can be started, polled and updated.** When the ASPSP returns a startAuthorisation* link, POST /consents/{id}/authorisations creates the resource (201, authorisationId, scaStatus), GET .../authorisations/{id} returns scaStatus, PUT updates it, and the consent becomes valid only after the authorisation is finalised. | GE IAA 0.8.RC1 §6.4, p.10-11 | implemented |
| `GE-AUTH-DECOUPLED` | MUST | **Decoupled authorisation honoured.** If the TPP sends TPP-Redirect-Preferred=false and TPP-Decoupled-Preferred=true, the ASPSP must run decoupled authorisation (mandatory since 2022-06-01). | GE XS2A 0.8.RC3 §2.1.3, p.6 | implemented |
| `GE-AUTH-MAXAUTH` | MUST NOT | **No third authorisation resource.** At most two authorisation resources per entity; a third must never be created. | GE IAA 0.8.RC1 §6.6, p.13 | implemented |
| `GE-AUTH-CORPID` | MUST | **CORPORATE_ID_INVALID when profile is ambiguous.** If only PSU-ID is given and personal vs corporate profile cannot be determined, return CORPORATE_ID_INVALID with a psuMessage. | GE IAA 0.8.RC1 §6.10, p.16 | manual |
| `GE-AUTH-PSUID` | MUST | **PSU-ID prefixes.** PSU-ID: PASGE-, IDCGE-, PNOGE- + identifier; PSU-Corporate-ID: NTRGE- + registration code. | GE IAA 0.8.RC1 §6.10, Tables 3-4, p.16 | manual |

## Compliance schedule

| ID | Level | Rule | Source | Status |
|---|---|---|---|---|
| `GE-SCHED-VERSION` | MUST | **Minimum implemented version.** From 2021-10-01 the ASPSP must have implemented guide version 0.8.RC1 or newer (older versions may run in parallel). | GE XS2A 0.8.RC3 §2.1.1, p.6 | manual |
| `GE-SCHED-CARDS` | MUST | **Card account information sharing.** After 2022-03-28 card account and card information sharing is mandatory (before: recommended). *(Out of hackathon scope.)* | GE XS2A 0.8.RC3 §2.1.6, p.7 | manual |
