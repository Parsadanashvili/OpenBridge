// Pinned reference profile used by the deterministic tests.
// IMPORTANT: this is an EXTRACTED TEACHING AID built from the Georgian XS2A guide 0.8.RC3
// (Berlin Group NextGenPSD2 1.3.9 based), NOT an official NBG OpenAPI document.
// Replace/extend with the organiser-confirmed package when it arrives. Rules marked
// refVerified:false still need a page/section check against the PDF before the demo.
const SPEC = {
  id: 'GE-XS2A-0.8.RC3',
  upstream: 'Berlin Group NextGenPSD2 XS2A 1.3.9',
  basePath: '/0.8/v1',
  status: 'extracted-teaching-aid',
};

const amountSchema = {
  type: 'object',
  required: ['currency', 'amount'],
  properties: { currency: { type: 'string', format: 'currency' }, amount: { type: 'string', format: 'amount' } },
};

const balance = {
  type: 'object',
  required: ['balanceType', 'balanceAmount'],
  properties: {
    balanceType: { type: 'string' },
    balanceAmount: amountSchema,
    lastChangeDateTime: { type: 'string', format: 'date-time' },
  },
};

const accountBase = {
  type: 'object',
  properties: {
    resourceId: { type: 'string' },
    iban: { type: 'string', format: 'iban' },
    currency: { type: 'string', format: 'currency' },
    name: { type: 'string' },
    product: { type: 'string' },
    cashAccountType: { type: 'string' },
    bic: { type: 'string', format: 'bic' },
    balances: { type: 'array', items: balance },
  },
};

const withRequired = (s, required) => ({ ...s, required });

const transaction = {
  type: 'object',
  required: ['transactionAmount', 'bookingDate'],
  properties: {
    transactionId: { type: 'string' },
    bookingDate: { type: 'string', format: 'date' },
    valueDate: { type: 'string', format: 'date' },
    transactionAmount: amountSchema,
    remittanceInformationUnstructured: { type: 'string' },
  },
};

// Consent REQUEST body: both BOG and TBC list these five as required (workshop slides 46, 56).
const CONSENT_REQUEST = {
  type: 'object', required: ['access', 'recurringIndicator', 'validUntil', 'frequencyPerDay', 'combinedServiceIndicator'],
  properties: { access: { type: 'object' }, recurringIndicator: { type: 'boolean' }, validUntil: { type: 'string', format: 'date' }, frequencyPerDay: { type: 'integer' }, combinedServiceIndicator: { type: 'boolean' } },
};
const GE_PAGE_SIZE = 50;

// operation catalogue: success schema + rule references
const OPERATIONS = {
  consents: {
    id: 'consents', method: 'POST', path: '/consents', status: 201,
    schema: {
      type: 'object',
      required: ['consentStatus', 'consentId'],
      properties: {
        consentStatus: { type: 'string', enum: ['received', 'rejected', 'valid', 'revokedByPsu', 'expired', 'terminatedByTpp'] },
        consentId: { type: 'string' },
        _links: { type: 'object' },
      },
    },
    ref: 'GE 0.8.RC3 §9.1.1/§9.2.1 pp.41–55; BG 1.3.9 §6.3.1 pp.133–143',
    refVerified: true,
  },
  accountList: {
    id: 'accountList', method: 'GET', path: '/accounts?withBalance=true', status: 200,
    schema: {
      type: 'object', required: ['accounts'],
      properties: { accounts: { type: 'array', items: withRequired(accountBase, ['iban', 'currency', 'cashAccountType', 'bic']) } },
    },
    ref: 'GE 0.8.RC3 §9.3.3 pp.57–61; BG 1.3.9 §6.5.1 pp.158–159', refVerified: true,
  },
  accountDetails: {
    id: 'accountDetails', method: 'GET', path: '/accounts/{id}?withBalance=true', status: 200,
    schema: {
      type: 'object', required: ['account'],
      properties: { account: withRequired(accountBase, ['resourceId', 'iban', 'currency', 'cashAccountType', 'bic', 'product']) },
    },
    ref: 'GE 0.8.RC3 §9.3.4 pp.61–65; BG 1.3.9 §6.5.2 pp.162–163', refVerified: true,
  },
  balances: {
    id: 'balances', method: 'GET', path: '/accounts/{id}/balances', status: 200,
    schema: { type: 'object', required: ['balances'], properties: { account: { type: 'object' }, balances: { type: 'array', items: balance } } },
    requiredBalanceTypes: ['closingBooked', 'interimAvailable'],
    ref: 'GE 0.8.RC3 §9.3.5 p.65; BG 1.3.9 §6.5.3 pp.164–166', refVerified: true,
  },
  transactions: {
    id: 'transactions', method: 'GET', path: '/accounts/{id}/transactions?bookingStatus=booked', status: 200,
    schema: {
      type: 'object', required: ['transactions'],
      properties: {
        account: { type: 'object' },
        transactions: { type: 'object', required: ['booked'], properties: { booked: { type: 'array', items: transaction } } },
      },
    },
    ref: 'GE 0.8.RC3 §9.3.6 pp.66–79 (50 records/page unless agreed); BG 1.3.9 §6.5.4 pp.168–173', refVerified: true,
  },
};

const ERROR_SCHEMA = {
  type: 'object', required: ['tppMessages'],
  properties: { tppMessages: { type: 'array', items: { type: 'object', required: ['category', 'code'], properties: { category: { type: 'string' }, code: { type: 'string' }, text: { type: 'string' } } } } },
};

module.exports = { SPEC, OPERATIONS, ERROR_SCHEMA, CONSENT_REQUEST, GE_PAGE_SIZE };
