// Synthetic, deterministic, behaviour-driven account data for the simulated banks.
// Everything here is FICTIONAL. People, IBANs (fake bank codes XA/XB) and balances are generated;
// merchant names are generic brand-style strings used only to look like real card statements.
// Money is handled in integer tetri (1/100 GEL) to avoid float drift.
const TODAY = '2026-10-25';                 // fixed reference date => reproducible demos
const DAYS = 365;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mk = (seed) => {
  const r = mulberry32(seed);
  const api = {
    r, int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    normal: () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()),
    logn: (median, sigma) => median * Math.exp(sigma * api.normal()),
    weighted: (pairs) => { const t = pairs.reduce((a, p) => a + p[1], 0); let x = r() * t; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[0][0]; },
  };
  return api;
};

// ---- dates (UTC, no TZ surprises) ----
const toDate = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const dow = (s) => toDate(s).getUTCDay();               // 0=Sun
const isBiz = (s) => ![0, 6].includes(dow(s));
const prevBiz = (s) => { while (!isBiz(s)) s = addDays(s, -1); return s; };
const nextBiz = (s) => { s = addDays(s, 1); while (!isBiz(s)) s = addDays(s, 1); return s; };
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---- IBAN (Georgian structure: GE + 2 check + 2 letters + 16 digits, valid mod-97) ----
function ibanCheck(bban) {
  const s = (bban + 'GE00').replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rem = 0; for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return String(98 - rem).padStart(2, '0');
}
const makeIban = (g, bankCode) => { const bban = bankCode + String(g.int(0, 9999999999999999)).padStart(16, '0'); return `GE${ibanCheck(bban)}${bban}`; };
const ibanValid = (iban) => { const s = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55); let rem = 0; for (const ch of s) rem = (rem * 10 + Number(ch)) % 97; return rem === 1; };

// ---- vocabulary ----
const FIRST_M = ['Giorgi', 'Nika', 'Davit', 'Luka', 'Levan', 'Irakli', 'Zurab', 'Tornike', 'Mikheil', 'Sandro', 'Beka', 'Gela', 'Vakhtang', 'Lasha'];
const FIRST_F = ['Nino', 'Mariam', 'Ana', 'Tamar', 'Salome', 'Natia', 'Eka', 'Lika', 'Nutsa', 'Mzia', 'Khatuna', 'Tea', 'Ketevan', 'Maka'];
const LAST = ['Beridze', 'Kapanadze', 'Gelashvili', 'Maisuradze', 'Lomidze', 'Chkheidze', 'Khutsishvili', 'Japaridze', 'Tsiklauri', 'Margvelashvili', 'Gogoladze', 'Dolidze', 'Meladze', 'Abashidze', 'Janelidze', 'Kobakhidze', 'Shengelia', 'Tabatadze'];
const KA = { Giorgi: 'გიორგი', Nika: 'ნიკა', Davit: 'დავით', Luka: 'ლუკა', Levan: 'ლევან', Irakli: 'ირაკლი', Zurab: 'ზურაბ', Tornike: 'თორნიკე', Mikheil: 'მიხეილ', Sandro: 'სანდრო', Beka: 'ბექა', Gela: 'გელა', Vakhtang: 'ვახტანგ', Lasha: 'ლაშა',
  Nino: 'ნინო', Mariam: 'მარიამ', Ana: 'ანა', Tamar: 'თამარ', Salome: 'სალომე', Natia: 'ნათია', Eka: 'ეკა', Lika: 'ლიკა', Nutsa: 'ნუცა', Mzia: 'მზია', Khatuna: 'ხათუნა', Tea: 'თეა', Ketevan: 'ქეთევან', Maka: 'მაკა',
  Beridze: 'ბერიძე', Kapanadze: 'კაპანაძე', Gelashvili: 'გელაშვილი', Maisuradze: 'მაისურაძე', Lomidze: 'ლომიძე', Chkheidze: 'ჩხეიძე', Khutsishvili: 'ხუციშვილი', Japaridze: 'ჯაფარიძე', Tsiklauri: 'წიკლაური', Margvelashvili: 'მარგველაშვილი', Gogoladze: 'გოგოლაძე', Dolidze: 'დოლიძე', Meladze: 'მელაძე', Abashidze: 'აბაშიძე', Janelidze: 'ჯანელიძე', Kobakhidze: 'კობახიძე', Shengelia: 'შენგელია', Tabatadze: 'ტაბატაძე' };
const EMPLOYERS = ['CAUCASUS SOFTWARE LLC', 'TBILISI LOGISTICS JSC', 'IBERIA RETAIL LLC', 'COLCHIS CONSULTING LLC', 'MTKVARI MEDIA LLC', 'ARAGVI ENGINEERING LLC', 'SAPERAVI TRADE LLC'];
const GE_REMIT = { salary: 'ხელფასი', rent: 'ბინის ქირა', utilities: 'კომუნალური გადასახადი', transfer: 'გადარიცხვა', gift: 'საჩუქარი', pension: 'პენსია', tax: 'გადასახადი', stipend: 'სტიპენდია', goods: 'საქონლის საფასური' };
const P2P_NOTES = ['for dinner', 'thanks!', 'taxi share', 'birthday gift', 'groceries', 'loan return', 'ქირა', 'გმადლობ', 'for the trip', 'concert tickets', 'lunch', ''];

// category => merchant list with MCC; amounts via lognormal (median, sigma) in GEL
const CAT = {
  grocery: { mcc: '5411', btc: 'PMNT-CCRD-POSD', m: ['CARREFOUR TBILISI', 'NIKORA', 'AGROHUB', 'SPAR GEORGIA', 'GOODWILL', 'FRESCO', 'LILO MARKET'], med: 38, sig: 0.7, hours: [[8, 1], [12, 2], [17, 4], [18, 5], [19, 5], [20, 3], [21, 1]] },
  bigGrocery: { mcc: '5411', btc: 'PMNT-CCRD-POSD', m: ['CARREFOUR TBILISI', 'GOODWILL', 'AGROHUB'], med: 140, sig: 0.45, hours: [[11, 2], [12, 3], [17, 3], [18, 3]] },
  coffee: { mcc: '5814', btc: 'PMNT-CCRD-POSD', m: ['ENTREE', 'COFFEELAB', 'CAFE LITERA', 'TBILISI COFFEE', 'DAILY BEAN'], med: 8.5, sig: 0.4, hours: [[8, 4], [9, 5], [10, 3], [13, 2], [16, 2]] },
  restaurant: { mcc: '5812', btc: 'PMNT-CCRD-POSD', m: ['KHINKLIS SAKHLI', 'KARTULI SUPRA', 'SHAVI LOMI', 'PURI & WINE', 'MAMA NINOS', 'FISH POINT', 'KFC TBILISI', 'MCDONALDS'], med: 45, sig: 0.6, hours: [[13, 3], [14, 2], [19, 4], [20, 5], [21, 3]] },
  delivery: { mcc: '5812', btc: 'PMNT-CCRD-POSD', m: ['WOLT', 'GLOVO', 'WOLT', 'GLOVO'], med: 32, sig: 0.5, hours: [[13, 2], [19, 4], [20, 5], [21, 5], [22, 3]] },
  taxi: { mcc: '4121', btc: 'PMNT-CCRD-POSD', m: ['BOLT', 'YANDEX GO', 'BOLT'], med: 7, sig: 0.55, hours: [[7, 2], [8, 4], [9, 2], [18, 3], [22, 4], [23, 3], [0, 1]] },
  transport: { mcc: '4111', btc: 'PMNT-CCRD-POSD', m: ['METROMONEY'], med: 10, sig: 0.3, hours: [[8, 3], [18, 3]] },
  fuel: { mcc: '5541', btc: 'PMNT-CCRD-POSD', m: ['WISSOL', 'SOCAR', 'GULF', 'PORTAL'], med: 75, sig: 0.4, hours: [[8, 2], [12, 2], [18, 4], [19, 2]] },
  pharmacy: { mcc: '5912', btc: 'PMNT-CCRD-POSD', m: ['GPC PHARMACY', 'PSP', 'AVERSI', 'PHARMADEPOT'], med: 22, sig: 0.7, hours: [[10, 3], [13, 2], [17, 3], [19, 2]] },
  clothes: { mcc: '5651', btc: 'PMNT-CCRD-POSD', m: ['ZARA TBILISI', 'LC WAIKIKI', 'KOTON', 'SPORT ZONE', 'EAST POINT MALL'], med: 85, sig: 0.7, hours: [[14, 3], [16, 4], [18, 3]] },
  electronics: { mcc: '5732', btc: 'PMNT-CCRD-POSD', m: ['ZOOMER', 'OPTIMA', 'ELIT ELECTRONICS'], med: 260, sig: 0.8, hours: [[13, 2], [17, 3]] },
  leisure: { mcc: '7832', btc: 'PMNT-CCRD-POSD', m: ['CINEMA CITY', 'TBILISI ZOO', 'FUN PARK', 'ILIAUNI SPORT CLUB', 'TICKET.GE'], med: 28, sig: 0.6, hours: [[16, 2], [19, 4], [20, 3]] },
  online: { mcc: '5999', btc: 'PMNT-CCRD-POSD', m: ['TEMU', 'AMAZON', 'ALIEXPRESS', 'EBAY'], med: 40, sig: 0.8, hours: [[11, 2], [15, 2], [21, 4], [22, 4], [23, 2]], fx: 'USD' },
  subscr: { mcc: '5968', btc: 'PMNT-CCRD-POSD', m: ['NETFLIX.COM', 'SPOTIFY', 'APPLE.COM/BILL', 'GOOGLE *YOUTUBE', 'ADOBE'], med: 12, sig: 0.3, hours: [[3, 2], [6, 2], [10, 1]], fx: 'USD' },
  atm: { mcc: '6011', btc: 'PMNT-CCRD-CWDL', m: ['ATM TBILISI', 'ATM RUSTAVI', 'ATM BATUMI', 'ATM KUTAISI'], med: 150, sig: 0.55, hours: [[10, 2], [13, 2], [17, 3], [19, 2]], round: 20 },
  school: { mcc: '8211', btc: 'PMNT-ICDT-STDO', m: ['PRIVATE SCHOOL TBILISI'], med: 650, sig: 0.1, hours: [[11, 1]] },
};
const BILLS = {
  electricity: { cp: 'ENERGO-PRO GEORGIA', med: 62, sig: 0.35, winterBoost: 1.5 },
  water: { cp: 'GEORGIAN WATER AND POWER', med: 14, sig: 0.15 },
  gas: { cp: 'TBILISI GAS SUPPLY', med: 38, sig: 0.5, winterBoost: 3 },
  mobile: { cp: 'MAGTICOM', med: 25, sig: 0.1 },
  internet: { cp: 'SILKNET', med: 35, sig: 0.02 },
  cleaning: { cp: 'TBILISI CLEANING SERVICE', med: 9, sig: 0.02 },
};

// ---- personas: what a person's month looks like ----
// daily: [category, expected events/day on weekday, weekend multiplier]
const PERSONAS = {
  employee: { label: 'Salaried employee', income: { kind: 'salary', day: 10, med: 2900, sig: 0.05 }, rent: [0.28, 0.35], bills: ['electricity', 'water', 'gas', 'mobile', 'internet'], daily: [['grocery', 0.45, 1.5], ['coffee', 0.5, 0.8], ['restaurant', 0.15, 2.2], ['delivery', 0.12, 2], ['taxi', 0.18, 1.6], ['fuel', 0.06, 1], ['pharmacy', 0.05, 1], ['clothes', 0.03, 2.5], ['online', 0.04, 1.5], ['leisure', 0.05, 2.5]], monthly: [['subscr', 2], ['atm', 1.2]], savings: 0.1, p2p: 0.12, accounts: ['GEL', 'USD'] },
  student: { label: 'Student', income: { kind: 'stipend', day: 5, med: 450, sig: 0.1 }, extra: [{ kind: 'parents', days: [1, 16], med: 250, sig: 0.4 }, { kind: 'parttime', day: 20, med: 600, sig: 0.35 }], rent: [0.3, 0.2], bills: ['mobile', 'internet'], daily: [['coffee', 0.7, 0.7], ['delivery', 0.2, 2], ['grocery', 0.35, 1.3], ['transport', 0.45, 0.5], ['taxi', 0.1, 2.5], ['leisure', 0.08, 2], ['online', 0.05, 1], ['restaurant', 0.1, 2]], monthly: [['subscr', 2], ['atm', 0.6]], savings: 0, p2p: 0.3, accounts: ['GEL'] },
  freelancer: { label: 'Freelancer (USD inflows)', income: { kind: 'foreign', perMonth: [2, 4], med: 1100, sig: 0.6, cur: 'USD' }, rent: [0.4, 0.3], bills: ['electricity', 'water', 'gas', 'mobile', 'internet'], daily: [['coffee', 0.7, 0.9], ['grocery', 0.4, 1.4], ['delivery', 0.2, 1.6], ['taxi', 0.15, 1.5], ['restaurant', 0.15, 2], ['online', 0.08, 1.2], ['electronics', 0.01, 1], ['leisure', 0.05, 2]], monthly: [['subscr', 4], ['atm', 0.7]], savings: 0.15, p2p: 0.1, accounts: ['USD', 'GEL'], convertFx: true },
  owner: { label: 'Small business owner', income: { kind: 'sales', perDay: 0.9, med: 420, sig: 0.8 }, payroll: { day: 25, staff: 4, med: 1100 }, rent: [0.2, 0.3], bills: ['electricity', 'water', 'mobile', 'internet', 'cleaning'], tax: true, daily: [['fuel', 0.12, 0.6], ['coffee', 0.4, 0.4], ['grocery', 0.15, 1.2], ['restaurant', 0.12, 1.5], ['taxi', 0.08, 1]], supplier: 0.35, monthly: [['subscr', 3], ['atm', 2]], savings: 0.05, p2p: 0.05, accounts: ['GEL', 'USD'] },
  pensioner: { label: 'Pensioner', income: { kind: 'pension', day: 5, med: 420, sig: 0.01 }, extra: [{ kind: 'family', days: [18], med: 150, sig: 0.4, chance: 0.7 }], rent: null, bills: ['electricity', 'water', 'gas', 'mobile'], daily: [['grocery', 0.4, 1], ['pharmacy', 0.18, 0.9], ['transport', 0.15, 0.3], ['coffee', 0.05, 1]], monthly: [['atm', 3]], savings: 0, p2p: 0.03, accounts: ['GEL'] },
  family: { label: 'Dual-income family', income: { kind: 'salary', day: 25, med: 3600, sig: 0.06 }, extra: [{ kind: 'spouse-salary', days: [10], med: 2200, sig: 0.05 }], rent: [0.25, 0.4], mortgage: 1250, bills: ['electricity', 'water', 'gas', 'mobile', 'internet', 'cleaning'], school: true, daily: [['grocery', 0.6, 1.6], ['bigGrocery', 0.08, 2.5], ['fuel', 0.14, 1], ['pharmacy', 0.1, 1], ['restaurant', 0.18, 2.4], ['delivery', 0.12, 1.8], ['leisure', 0.08, 3], ['clothes', 0.06, 2.2], ['coffee', 0.3, 0.7], ['online', 0.07, 1.4], ['electronics', 0.01, 1]], monthly: [['subscr', 3], ['atm', 1]], savings: 0.08, p2p: 0.08, accounts: ['GEL', 'USD'] },
};

function rateTable(g) { // synthetic GEL per 1 unit, daily random walk
  const out = {}; let usd = 2.70, eur = 3.12;
  for (let i = -DAYS - 5; i <= 1; i++) { usd = Math.min(2.95, Math.max(2.55, usd + g.normal() * 0.004)); eur = usd * 1.155 + g.normal() * 0.003; out[addDays(TODAY, i)] = { USD: usd, EUR: eur, GEL: 1 }; }
  return out;
}

const tet = (gel) => Math.round(gel * 100);
const money = (t) => { const s = t < 0 ? '-' : ''; const a = Math.abs(t); return `${s}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`; };

function hourPick(g, hours) { return g.weighted(hours); }
function stamp(date, g, hours) { const h = hourPick(g, hours), m = g.int(0, 59), s = g.int(0, 59); return `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }

function buildCustomer(seed, personaKey, bank) {
  const g = mk(seed), P = PERSONAS[personaKey], rates = rateTable(g);
  const female = g.chance(0.5), first = g.pick(female ? FIRST_F : FIRST_M), last = g.pick(LAST) + (female ? '' : '');
  const name = `${first} ${last}`, nameKa = `${KA[first]} ${KA[last]}`;
  const employer = g.pick(EMPLOYERS);
  const employerReg = g.int(100000000, 999999999);
  const start = addDays(TODAY, -DAYS);
  const dates = Array.from({ length: DAYS + 1 }, (_, i) => addDays(start, i));
  const accts = P.accounts.map((cur, i) => ({
    resourceId: bank.idStyle === 'uuid' ? `${g.int(0x10000000, 0xffffffff).toString(16)}-${g.int(0x1000, 0xffff).toString(16)}-${g.int(0x1000, 0xffff).toString(16)}-${g.int(0x100000000000, 0xffffffffffff).toString(16)}` : String(g.int(100000000, 999999999)),
    iban: makeIban(g, bank.ibanBank), currency: cur,
    name: i === 0 ? 'Current account' : cur === 'USD' && personaKey !== 'freelancer' ? 'USD savings' : `${cur} account`,
    product: i === 0 ? 'Current Account' : 'Savings Account', cashAccountType: 'CACC', bic: bank.bic, ownerName: nameKa, displayName: i === 0 ? 'ძირითადი ანგარიში' : 'დანაზოგი', ev: [],
  }));
  const main = accts[0];
  const fxRate = (cur, d) => (rates[d] || rates[TODAY])[cur];
  let txn = 0;
  const rentDay = g.int(1, 3), rentT = tet(Math.round((P.rent ? P.rent[0] * 3000 + 300 : 0) / 10) * 10 * (1 + 0.1 * g.normal() * 0) );
  const push = (acct, d, ts, amt, o) => { acct.ev.push({ d, ts, amt, cur: acct.currency, ...o }); txn++; };
  const iban = () => makeIban(g, g.pick(['XA', 'XB']));
  const counterparty = () => { const f = g.chance(0.5) ? g.pick(FIRST_F) : g.pick(FIRST_M); return `${f} ${g.pick(LAST)}`.toUpperCase(); };

  for (const d of dates) {
    const [Y, M, D] = d.split('-').map(Number), wk = dow(d), wkend = wk === 0 || wk === 6, mlen = dim(Y, M), winter = [11, 12, 1, 2, 3].includes(M);
    const payDate = (day) => prevBiz(`${Y}-${String(M).padStart(2, '0')}-${String(Math.min(day, mlen)).padStart(2, '0')}`) === d;

    // income
    const inc = P.income;
    if (inc.kind === 'salary' || inc.kind === 'pension' || inc.kind === 'stipend') {
      if (payDate(inc.day)) push(main, d, stamp(d, g, [[9, 3], [10, 3], [11, 2]]), tet(inc.med * (1 + inc.sig * g.normal())), { type: 'in', cp: inc.kind === 'salary' ? employer : inc.kind === 'pension' ? 'SOCIAL SERVICE AGENCY' : 'MINISTRY OF EDUCATION', remit: `${GE_REMIT[inc.kind === 'salary' ? 'salary' : inc.kind === 'pension' ? 'pension' : 'stipend']} ${Y}-${String(M).padStart(2, '0')}`, btc: 'PMNT-RCDT-SALA', cpIban: iban(), party: { org: true, id: `NTRGE-${String(employerReg).padStart(9, '0')}` } });
    }
    for (const x of P.extra || []) if ((x.days || []).some((dd) => payDate(dd)) && g.chance(x.chance ?? 1)) push(main, d, stamp(d, g, [[10, 2], [14, 2], [20, 1]]), tet(Math.max(30, x.med * (1 + x.sig * g.normal()))), { type: 'in', cp: x.kind === 'parents' || x.kind === 'family' ? counterparty() : x.kind === 'parttime' ? 'COFFEE HOUSE LLC' : employer + ' (SPOUSE)', remit: GE_REMIT.transfer, btc: 'PMNT-RCDT-ESCT', cpIban: iban() });
    if (inc.kind === 'foreign' && isBiz(d) && g.chance((g.int(inc.perMonth[0], inc.perMonth[1])) / 21)) {
      const usd = accts.find((a) => a.currency === 'USD') || main;
      push(usd, d, stamp(d, g, [[11, 2], [15, 3], [16, 2]]), Math.round(tet(Math.max(150, g.logn(inc.med, inc.sig)))), { type: 'in', cp: g.pick(['WISE EUROPE SA', 'PAYONEER INC', 'UPWORK ESCROW', 'STRIPE PAYMENTS EUROPE']), remit: `INV-${g.int(1000, 9999)} payment`, btc: 'PMNT-RCDT-XBCT', cpIban: 'BE' + g.int(10, 99) + g.int(100000000000, 999999999999) });
    }
    if (inc.kind === 'sales' && isBiz(d) || (inc.kind === 'sales' && wkend && g.chance(0.4))) {
      const n = Math.max(0, Math.round(inc.perDay * (wkend ? 0.6 : 1) + g.normal() * 0.7)); // customer payments + POS settlement
      for (let k = 0; k < n; k++) push(main, d, stamp(d, g, [[10, 2], [12, 3], [15, 3], [17, 2]]), tet(Math.max(40, g.logn(inc.med, inc.sig))), { type: 'in', cp: g.chance(0.6) ? `${g.pick(['ALFA', 'MERKURI', 'NOVA', 'ORBITA'])} ${g.pick(['TRADE', 'GROUP', 'LLC'])}` : counterparty(), remit: `${GE_REMIT.goods} #${g.int(100, 999)}`, btc: 'PMNT-RCDT-ESCT', cpIban: iban() });
      if (wkend === false && g.chance(0.5)) push(main, d, stamp(d, g, [[8, 1]]), tet(Math.max(60, g.logn(300, 0.7))), { type: 'in', cp: 'POS SETTLEMENT', remit: 'Card acquiring settlement', btc: 'PMNT-RCDT-ESCT', cpIban: iban() });
    }
    if (P.payroll && payDate(P.payroll.day)) for (let k = 0; k < P.payroll.staff; k++) push(main, d, stamp(d, g, [[11, 3], [12, 2]]), -tet(P.payroll.med * (0.7 + g.r() * 0.7)), { type: 'out', cp: counterparty(), remit: `${GE_REMIT.salary} ${Y}-${String(M).padStart(2, '0')}`, btc: 'PMNT-ICDT-SALA', cpIban: iban() });
    if (P.tax && D === 15) push(main, d, stamp(d, g, [[10, 2]]), -tet(g.logn(480, 0.4)), { type: 'out', cp: 'REVENUE SERVICE', remit: GE_REMIT.tax, btc: 'PMNT-ICDT-TAXS', cpIban: 'GE' + g.int(10, 99) + 'TR0000000000000001' });
    if (P.supplier && isBiz(d) && g.chance(P.supplier)) push(main, d, stamp(d, g, [[10, 2], [14, 2]]), -tet(g.logn(900, 0.9)), { type: 'out', cp: `${g.pick(['KAVKASIA', 'IMERETI', 'KAKHETI', 'SAMTREDIA'])} SUPPLIES LLC`, remit: `${GE_REMIT.goods} INV-${g.int(1000, 9999)}`, btc: 'PMNT-ICDT-ESCT', cpIban: iban() });

    // fixed outflows
    if (P.rent && D === rentDay) push(main, d, stamp(d, g, [[9, 2], [20, 3]]), -rentT, { type: 'out', cp: counterparty(), remit: GE_REMIT.rent, btc: 'PMNT-ICDT-ESCT', cpIban: iban() });
    if (P.mortgage && D === 12) push(main, d, stamp(d, g, [[8, 1]]), -tet(P.mortgage), { type: 'out', cp: 'MORTGAGE LOAN REPAYMENT', remit: 'Loan installment', btc: 'PMNT-ICDT-STDO', cpIban: iban() });
    if (P.school && D === 3 && ![7, 8].includes(M)) push(main, d, stamp(d, g, [[11, 1]]), -tet(g.logn(650, 0.03)), { type: 'out', cp: 'PRIVATE SCHOOL TBILISI', remit: 'Tuition fee', btc: 'PMNT-ICDT-STDO', cpIban: iban() });
    P.bills.forEach((b, i) => {
      const cfg = BILLS[b], billDay = 14 + i * 2;
      if (D === billDay) push(main, d, stamp(d, g, [[10, 2], [14, 2], [21, 2]]), -tet(Math.max(3, g.logn(cfg.med * (winter && cfg.winterBoost ? cfg.winterBoost : 1), cfg.sig))), { type: 'out', cp: cfg.cp, remit: `${GE_REMIT.utilities}`, btc: 'PMNT-ICDT-STDO', mcc: '4900', cpIban: iban() });
    });
    // savings sweep (own transfer GEL -> USD savings, converted at day's rate)
    if (P.savings && D === 27 && accts[1]) {
      const gel = tet(g.logn(P.savings * 2800, 0.3)), usd = Math.round(gel / fxRate('USD', d));
      push(main, d, stamp(d, g, [[10, 2]]), -gel, { type: 'out', cp: 'OWN ACCOUNT', remit: 'Transfer to savings', btc: 'PMNT-ICDT-ESCT', cpIban: accts[1].iban, own: true });
      push(accts[1], d, stamp(d, g, [[10, 2]]), usd, { type: 'in', cp: 'OWN ACCOUNT', remit: 'Transfer from current', btc: 'PMNT-RCDT-ESCT', cpIban: main.iban, own: true, fx: { from: 'GEL', to: accts[1].currency, rate: fxRate('USD', d) } });
    }
    if (P.convertFx && D === 6 && accts[1]) { // freelancer converts part of USD to GEL
      const usdAcc = accts[0], gelAcc = accts[1], usd = tet(g.logn(1900, 0.3)), rate = fxRate('USD', d) - 0.01;
      push(usdAcc, d, stamp(d, g, [[11, 2]]), -usd, { type: 'out', cp: 'OWN ACCOUNT', remit: 'Currency conversion USD/GEL', btc: 'PMNT-ICDT-XBCT', cpIban: gelAcc.iban, own: true, fx: { from: 'USD', to: 'GEL', rate } });
      push(gelAcc, d, stamp(d, g, [[11, 2]]), Math.round(usd * rate), { type: 'in', cp: 'OWN ACCOUNT', remit: 'Currency conversion USD/GEL', btc: 'PMNT-RCDT-XBCT', cpIban: usdAcc.iban, own: true, fx: { from: 'USD', to: 'GEL', rate } });
    }
    // card spending: Poisson-ish daily draws
    const spendAcct = personaKey === 'freelancer' ? accts[1] : main;
    for (const [cat, perDay, wm] of P.daily) {
      const lam = perDay * (wkend ? wm : 1) * (cat === 'coffee' && wkend ? 1 : 1);
      let n = 0, l = Math.exp(-lam), p = 1; do { n++; p *= g.r(); } while (p > l && n < 6); n--;
      for (let k = 0; k < n; k++) cardSpend(spendAcct, d, cat);
    }
    for (const [cat, perMonth] of P.monthly || []) if (g.chance(perMonth / mlen)) cardSpend(spendAcct, d, cat);
    // p2p
    if (g.chance((P.p2p || 0) * (wkend ? 1.4 : 1))) {
      const out = g.chance(0.65), amt = tet(Math.max(5, Math.round(g.logn(40, 0.9))));
      push(main, d, stamp(d, g, [[12, 2], [18, 3], [21, 3]]), out ? -amt : amt, { type: out ? 'out' : 'in', cp: counterparty(), remit: g.pick(P2P_NOTES) || GE_REMIT.transfer, btc: out ? 'PMNT-ICDT-ESCT' : 'PMNT-RCDT-ESCT', cpIban: iban(), party: { org: false, id: `PNOGE-${String(g.int(10000000000, 99999999999))}` } });
    }
  }

  function cardSpend(acct, d, cat) {
    const c = CAT[cat]; let gel = Math.max(1.5, g.logn(c.med, c.sig));
    if (c.round) gel = Math.max(20, Math.round(gel / c.round) * c.round);
    const merchant = g.pick(c.m), ts = stamp(d, g, c.hours);
    if (c.fx && acct.currency === 'GEL') {  // foreign-currency card payment converted by the bank
      const usd = Math.round(gel / 2.7 * 100) / 100, rate = fxRate('USD', d) * 1.015;
      push(acct, d, ts, -Math.round(usd * rate * 100), { type: 'card', cp: merchant, mcc: c.mcc, btc: c.btc, remit: `${merchant} ${usd.toFixed(2)} USD`, fx: { from: 'USD', to: 'GEL', rate, instructed: tet(usd) } });
    } else {
      const amt = acct.currency === 'GEL' ? tet(gel) : Math.round(tet(gel) / fxRate(acct.currency, d));
      push(acct, d, ts, -amt, { type: 'card', cp: merchant, mcc: c.mcc, btc: c.btc, remit: merchant, card: true });
    }
  }

  // QA fixture: one same-day incoming transfer with a >140 char purpose on every main account (tests GE-TX-TODAY / GE-TX-DETAILS)
  const LONG = 'გადახდა სერვისებისთვის - ინვოისი INV-2026-1025 / Payment for consulting services rendered in October 2026, including travel and accommodation costs, as agreed in contract no. 77/2026 between the parties; thank you for the cooperation';
  push(main, TODAY, `${TODAY}T08:15:00`, tet(25), { type: 'in', cp: 'SAME DAY SENDER LLC', remit: LONG, btc: 'PMNT-RCDT-ESCT', cpIban: makeIban(g, 'XB'), party: { org: true, id: 'NTRGE-123456789' } });

  // finalize: ids, booking vs pending, running balances
  const today = TODAY;
  for (const [ai, a] of accts.entries()) {
    a.ev = a.ev.filter((e) => e.ts <= TODAY + 'T09:30:00'); // nothing from the future
    a.ev.sort((x, y) => (x.ts < y.ts ? -1 : 1));
    a.tx = a.ev.map((e, i) => {
      const cardLag = e.type === 'card' ? (g.chance(0.85) ? 1 : 2) : 0;
      let book = e.d; for (let k = 0; k < cardLag; k++) book = nextBiz(book);
      const status = e.type === 'card' ? (book > today ? 'pending' : 'booked') : (e.d > today ? 'pending' : 'booked');
      const id = `${bank.txPrefix}${e.d.replace(/-/g, '')}${String(i).padStart(5, '0')}`;
      return { transactionId: id, entryReference: `${bank.txPrefix}${ai}${String(i).padStart(7, '0')}`, party: e.party, ts: e.ts, bookingDate: status === 'pending' ? undefined : (e.type === 'card' ? book : e.d), valueDate: e.d, status, amountT: e.amt, currency: a.currency, type: e.type, cp: e.cp, cpIban: e.cpIban, remit: e.remit, btc: e.btc, mcc: e.mcc, fx: e.fx, own: e.own };
    });
    let cum = 0, min = 0; for (const t of a.tx) { cum += t.amountT; if (t.status === 'booked') min = Math.min(min, cum); }
    // opening balance chosen so booked balance never dips below a small cushion (no accidental overdraft)
    a.openingT = Math.max(0, -min) + tet(g.int(60, 400));
    let run = a.openingT; for (const t of a.tx) { if (t.status === 'booked') run += t.amountT; t.runT = t.status === 'booked' ? run : undefined; }
    a.closingBookedT = run; a.interimAvailableT = run + a.tx.filter((t) => t.status === 'pending').reduce((s, t) => s + t.amountT, 0);
    a.lastBookedTs = [...a.tx].reverse().find((t) => t.status === 'booked')?.ts;
    delete a.ev;
  }
  return { psuId: `PSU-${seed}`, name, nameKa, persona: personaKey, personaLabel: P.label, accounts: accts, txnCount: txn };
}

function buildBankData(bank) {
  const keys = Object.keys(PERSONAS);
  return keys.map((k, i) => buildCustomer(bank.seed + i * 101, k, bank));
}

function summarize(customers) {
  return customers.map((c) => ({ customer: c.name, persona: c.persona, accounts: c.accounts.map((a) => ({ iban: a.iban, cur: a.currency, tx: a.tx.length, closing: money(a.closingBookedT) })) }));
}

module.exports = { mk, makeIban, buildBankData, buildCustomer, summarize, ibanValid, money, addDays, TODAY, PERSONAS };
