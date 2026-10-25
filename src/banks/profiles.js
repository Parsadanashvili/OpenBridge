// SIMULATED banks. Fictional names, synthetic data (see datagen.js). Behaviour follows the Georgian XS2A rules by default;
// each flag below is a deliberate, realistic DEVIATION for the auditor to find (rule IDs from src/spec/rulebook.js in comments).
// Add a flag => add a matching assertion in scripts/selftest.js.
const PROFILES = {
  alpha: {
    key: 'alpha', port: 4101, name: 'Alpha Bank (simulated)', seed: 4101, ibanBank: 'XA', bic: 'ALPHGE22', idStyle: 'uuid', txPrefix: 'A',
    pageSize: 50, latency: [25, 70], failRate: 0,
    quirks: {
      // behaviour switches (compliant style)
      requireSignedRequests: true, echoRequestId: true, enforceRequestId: true, strictConsentBody: true,
      errorShape: 'problem',          // TBC-documented ApiProblemDetails (valid)
      multicurrencyAccount: true,     // XXX aggregated account
      signResponses: true,
      // the only planted defects:
      detailsMissingProduct: true,    // GE-ACC-DET-FIELDS
      balanceTimestampNoTz: true,     // RFC 3339 trap, schema format date-time
    },
  },
  beta: {
    key: 'beta', port: 4102, name: 'Beta Bank (simulated)', seed: 4102, ibanBank: 'XB', bic: 'BETAGE22', idStyle: 'numeric', txPrefix: 'B',
    pageSize: 25, latency: [90, 380], failRate: 0.06,
    quirks: {
      listMissingBicAndType: true,      // GE-ACC-LIST-IBAN
      amountAsNumber: true,             // GE-BAL-AMOUNT
      bookingDateFormat: 'DD.MM.YYYY',  // GE-TX-BOOKINGDATE format
      balancesOnlyClosing: true,        // GE-BAL-TYPES / GE-ACC-BAL-LIST / GE-ACC-BAL-DETAILS
      noBalanceDates: true,             // GE-BAL-DATES
      noBalanceAccount: true,           // GE-BAL-ACCOUNT
      consentStatusUpper: true,         // enum case
      errorShape: 'flat',               // GE-ERR-FORMAT
      unauthStatus: 403,                // GE-AUTH-NOANON
      consentUnknown401: true,          // GE-CNS-UNKNOWN (401 instead of 400)
      leakServerHeader: true, noCacheControl: true, // GE-SEC-NOCACHE
      lenientConsentBody: true,         // GE-CNS-FIELDS / ONCE / 90D / ALLPSD2
      consentNeedsToken: true,          // GE-CNS-NOTOKEN
      consentValidImmediately: true,    // GE-CNS-NOTVALID
      consentLinksRedirect: true,       // GE-CNS-OAUTH-REDIRECT / GE-AUTH-NOCONFIRM / GE-AUTH-CURIES / GE-SEC-LINKS
      consentDetailsAltered: true,      // GE-CNS-DETAILS
      ignoresRevocation: true,          // GE-CNS-DELETE
      overshare: true,                  // GE-ERR-INSUFFICIENT-SCOPE / GE-ACC-NO-OVERSHARE / GE-ACC-LINKS-SCOPE
      ownerAlways: true,                // GE-ACC-OWNER
      alwaysBalances: true,             // GE-ACC-BAL-FLAG
      leakBban: true,                   // GE-ACC-BBAN-NEVER
      detailsFieldInList: true,         // GE-ACC-DETAILS-FIELD
      leakIbanInResourceId: true,       // GE-ACC-RESID-TOKEN
      noName: true,                     // GE-ACC-NAME
      savingsCashType: 'SVGS',          // GE-ACC-CATYPE
      ignoresDateFilter: true,          // GE-TX-DATES
      pageOverlap: true,                // GE-TX-ONCE
      noFirstLink: true,                // GE-TX-LINKS
      noEntryRefFrom: true,             // GE-TX-ENTRYREFFROM
      bothUnsupported: true,            // GE-TX-STATUS
      sortByValueDate: true,            // GE-TX-SORT
      limitHistory: true,               // GE-TX-HISTORY
      noTxBalances: true,               // GE-TX-BALANCES
      noCounterpartyAcct: true,         // GE-TX-COUNTERPARTY-ACCT
      mangleGeorgian: true,             // GE-TX-REMITTANCE
      noRequestIdEcho: true,            // GE-API-REQID-ECHO
      multicurrencyAccount: true, aggregatedAlways: true, // GE-ACC-MULTI-SCOPE (XXX returned although consent is for one currency)
      noTokenBinding: true,             // GE-CNS-HEADERS
      noFrequencyLimit: true,           // GE-CNS-FREQ
      acceptsAnyRedirectUri: true,      // GE-CNS-REDIRECT-URI
      acceptsMixedArrays: true,         // GE-CNS-EMPTYARR
      noDecoupled: true,                // GE-AUTH-DECOUPLED
      unlimitedAuthorisations: true,    // GE-AUTH-MAXAUTH
      noDetailsService: true,           // GE-TX-DETAILS / GE-TX-TXID (transactionId returned but service absent)
      cancelledRefIgnored: true,        // GE-TX-CONSISTENT
      todayTransfersPending: true,      // GE-TX-TODAY
      dropFx: true,                     // GE-TX-CURRENCYEXCH
      partyIdFlat: true,                // GE-API-PARTYID
      noContentLanguage: true,          // GE-API-LANG
      ignoresEncodingRules: true,       // GE-JWS-ENCODING
      signResponses: true, jwsDefects: { fractionalSigT: true, lowercaseTyp: true, wrongDigest: true }, // GE-JWS-SIGT/TYP/DIGEST
    },
  },
};
module.exports = { PROFILES };
