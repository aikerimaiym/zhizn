'use strict';
/* Жизнь — раздел «Финансы», MVP (этап 1).
   Данные хранятся на устройстве (IndexedDB). Каждая операция — запись с уникальным id и временем изменения,
   поэтому позже их можно безопасно объединять между устройствами через OneDrive. */

// ---------- Типы операций ----------
const TYPES = [
  { t: 'Расход', sign: -1, grp: 'exp', person: false, to: false, hint: 'Трата — идёт в бюджет' },
  { t: 'Доход', sign: 1, grp: 'inc', person: false, to: false, hint: 'Свой доход: стипендия, зарплата, проекты' },
  { t: 'Помощь', sign: 1, grp: '', person: true, to: false, hint: 'Деньги от людей — не свой доход' },
  { t: 'Перевод между счетами', sign: -1, grp: '', person: false, to: true, hint: 'Между своими счетами в одной валюте. Общий баланс не меняется' },
  { t: 'Обмен валюты', sign: -1, grp: '', person: false, to: true, fx: true, hint: 'Покупка или продажа валюты или золота: укажи, сколько отдала и сколько получила' },
  { t: 'Заём получен', sign: 1, grp: '', person: true, to: false, hint: 'Мне дали в долг: деньги приходят на счёт, долг появится в «Бюджет → Капитал»' },
  { t: 'Заём выдан', sign: -1, grp: '', person: true, to: false, hint: 'Я дала в долг: деньги уходят со счёта, долг появится в «Бюджет → Капитал → Мне должны»' },
  { t: 'Мне вернули долг', sign: 1, grp: '', person: true, to: false, hint: 'Мне вернули деньги, которые я давала в долг — долг уменьшится' },
  { t: 'Я вернула долг', sign: -1, grp: '', person: true, to: false, hint: 'В том числе платёж по рассрочке' },
  { t: 'Корректировка +', sign: 1, grp: '', person: false, to: false, hint: 'Сверка: в банке больше' },
  { t: 'Корректировка −', sign: -1, grp: '', person: false, to: false, hint: 'Сверка: в банке меньше' },
];
const TYPE = Object.fromEntries(TYPES.map(x => [x.t, x]));
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DEVICE = (() => { try { let d = localStorage.getItem('zhizn-device'); if (!d) { d = uid(); localStorage.setItem('zhizn-device', d); } return d; } catch (e) { return 'dev'; } })();

function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// ---------- Валюты ----------
// code — код ISO (для металлов XAU/XAG), sym — значок, metal — счёт в граммах.
const CURRENCIES = [
  { code: 'KZT', sym: '₸', name: 'Тенге' }, { code: 'USD', sym: '$', name: 'Доллар США' }, { code: 'EUR', sym: '€', name: 'Евро' },
  { code: 'RUB', sym: '₽', name: 'Рубль' }, { code: 'CNY', sym: '¥', name: 'Юань' }, { code: 'KGS', sym: 'сом', name: 'Кыргызский сом' },
  { code: 'UZS', sym: 'сум', name: 'Узбекский сум' }, { code: 'TRY', sym: '₺', name: 'Турецкая лира' }, { code: 'GBP', sym: '£', name: 'Фунт' },
  { code: 'AED', sym: 'AED', name: 'Дирхам ОАЭ' }, { code: 'KRW', sym: '₩', name: 'Вона' }, { code: 'JPY', sym: 'JP¥', name: 'Иена' },
  { code: 'XAU', sym: 'г', name: 'Золото (граммы)', metal: true }, { code: 'XAG', sym: 'г', name: 'Серебро (граммы)', metal: true },
];
const CUR = Object.fromEntries(CURRENCIES.map(c => [c.code, c]));
const baseCur = () => (S.cfg && S.cfg.base) || 'KZT';
const accCur = a => (a && a.cur) || baseCur();                       // старые счета без валюты — в основной валюте
const accByName = n => S.cfg.accounts.find(a => a.name === n);
const openAccs = () => S.cfg.accounts.filter(a => !a.closed);
const curOf = name => accCur(accByName(name));
const isMetal = code => !!(CUR[code] && CUR[code].metal);
// Деньги: до 2 знаков после запятой (тиыны), целые — без «,00»
const r2 = n => Math.round((+n || 0) * 100) / 100;
function fmt(n, code) {
  const v = r2(n), c = CUR[code] || { sym: code };
  const s = v.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return c.metal ? `${s} г ${code === 'XAU' ? 'золота' : 'серебра'}` : `${s} ${c.sym}`;
}
const money = n => fmt(n, baseCur());                                   // суммы в основной валюте
// Ввод чисел: понимает пробелы и запятую («1 234,56»)
const num = s => { const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? r2(v) : 0; };
const pct = x => (x === null || !isFinite(x)) ? '–' : Math.round(x * 100) + '%';
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const mkey = date => (date || '').slice(0, 7);
const mlabel = k => { const [y, m] = k.split('-'); return MONTHS[+m - 1] + ' ' + y; };
const mshift = (k, d) => { let [y, m] = k.split('-').map(Number); m += d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + String(m).padStart(2, '0'); };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 3200); }

// ---------- Хранилище (IndexedDB) ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('zhizn', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('ops', { keyPath: 'id' }); d.createObjectStore('kv'); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
  },
  all() { return new Promise((res, rej) => { const r = this.db.transaction('ops').objectStore('ops').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  put(op) { return this.tx('ops', 'readwrite', s => s.put(op)); },
  get(k) { return new Promise((res, rej) => { const r = this.db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  set(k, v) { return this.tx('kv', 'readwrite', s => s.put(v, k)); },
};

// ---------- Состояние ----------
const S = { ops: [], cfg: null, life: null, month: '2026-12', tab: 'today', edit: null, draft: null, q: '' };
function defaultCfg() {
  return {
    version: 1, updatedAt: 0, // 0 = стартовые настройки: при синхронизации их заменят настоящие с другого устройства
    accounts: [
      { name: 'Kaspi Gold', type: 'Карта', savings: false, start: 0, fact: null },
      { name: 'Kaspi Депозит', type: 'Депозит', savings: true, start: 0, fact: null },
      { name: 'Наличные', type: 'Наличные', savings: false, start: 0, fact: null },
      { name: 'Другой банк', type: 'Карта', savings: false, start: 0, fact: null },
    ],
    startDate: '2026-12-01',
    exp: JSON.parse(JSON.stringify(DEFAULT_EXP)),
    inc: JSON.parse(JSON.stringify(DEFAULT_INC)),
    people: [{ name: 'Мама', role: 'Семья' }, { name: 'Папа', role: 'Семья' }, { name: 'Kaspi рассрочка', role: 'Банк' }],
    plans: [], // { month:'2026-12', cat, sub, amount } — особый план на месяц
    lastAccount: 'Kaspi Gold',
  };
}
async function saveCfg() { S.cfg.updatedAt = Date.now(); await DB.set('cfg', S.cfg); Sync.soon(); }
// Последний выбранный счёт помним только на этом устройстве (чтобы не «перебивать» настройки других устройств)
const lastAcc = { get() { try { return localStorage.getItem('zhizn-last-account'); } catch (e) { return null; } }, set(v) { try { localStorage.setItem('zhizn-last-account', v); } catch (e) {} } };
const live = () => S.ops.filter(o => !o.deleted);

// ---------- Курсы ----------
// Курс = сколько основной валюты стоит 1 единица (1 $, 1 € … или 1 грамм металла).
// Источник: Currency API (fawazahmed0, через jsDelivr), запасной — ExchangeRate-API (только валюты).
// Ручной курс (cfg.rateManual) важнее автоматического. Автокурсы хранятся только на устройстве.
const Rates = {
  data: null, // { base, fetchedAt, date, src, values: { USD: 455.5, XAU: 53072, ... } }
  async load() { this.data = (await DB.get('rates')) || null; },
  auto(code) { return this.data && this.data.base === baseCur() ? this.data.values[code] : undefined; },
  manual(code) { const m = (S.cfg.rateManual || {})[code]; return m && +m.v > 0 ? +m.v : undefined; },
  get(code) { if (code === baseCur()) return 1; return this.manual(code) ?? this.auto(code); },
  used() { return [...new Set(S.cfg.accounts.map(accCur))].filter(c => c !== baseCur()); },
  stale() { return !this.data || this.data.base !== baseCur() || Date.now() - this.data.fetchedAt > 12 * 3600e3; },
  async refresh() {
    const b = baseCur().toLowerCase(), values = {};
    let src = '', date = '';
    try {
      const urls = [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${b}.json`, `https://latest.currency-api.pages.dev/v1/currencies/${b}.json`];
      let j = null;
      for (const u of urls) { try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) { j = await r.json(); break; } } catch (e) {} }
      if (!j) throw new Error('нет ответа');
      const per = j[b]; date = j.date; src = 'Currency API';
      for (const c of CURRENCIES) {
        const x = per[c.code.toLowerCase()]; if (!(x > 0) || c.code === baseCur()) continue;
        values[c.code] = c.metal ? (1 / x) / 31.1034768 : 1 / x;   // металлы: цена за тройскую унцию → за грамм
      }
    } catch (e) {
      const r = await fetch(`https://open.er-api.com/v6/latest/${baseCur()}`);   // запасной источник (без металлов)
      if (!r.ok) throw new Error('курсы недоступны');
      const j = await r.json(); src = 'ExchangeRate-API'; date = (j.time_last_update_utc || '').slice(5, 16);
      for (const c of CURRENCIES) { const x = j.rates && j.rates[c.code]; if (x > 0 && !c.metal && c.code !== baseCur()) values[c.code] = 1 / x; }
    }
    this.data = { base: baseCur(), fetchedAt: Date.now(), date, src, values };
    await DB.set('rates', this.data);
    return this.data;
  },
};
// Сумма операции в основной валюте (для бюджета и итогов). Курс запоминается в операции при сохранении.
function opBase(o) { const c = curOf(o.account); return c === baseCur() ? o.amount : o.amount * (o.rate || Rates.get(c) || 0); }
// Остаток счёта (в его валюте) → в основной валюте по текущему курсу
function toBase(v, code) { const r = Rates.get(code); return code === baseCur() ? v : (r ? v * r : 0); }

// ---------- Проверка операции ----------
function validate(o) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) return 'Укажи дату';
  if (isPocketOp(o)) {   // перекладка между карманами (деньги не двигаются, меняется только назначение)
    const names = [...pockets().map(p => p.name), ...goals().map(gKey)];
    if (!(o.amount > 0) || o.from === o.to || (o.from && !names.includes(o.from)) || (o.to && !names.includes(o.to))) return 'Неверная перекладка';
    return '';
  }
  if (o.date < S.cfg.startDate) return 'Дата раньше начала учёта (' + S.cfg.startDate.split('-').reverse().join('.') + ')';
  const T = TYPE[o.type]; if (!T) return 'Выбери тип';
  if (!(o.amount > 0)) return 'Сумма должна быть больше нуля';
  if (!S.cfg.accounts.some(a => a.name === o.account)) return 'Выбери счёт';
  if (T.grp === 'exp' && !S.cfg.exp.some(c => c.cat === o.cat && c.subs.some(s => s.name === o.sub))) return 'Выбери категорию и подкатегорию';
  if (T.grp === 'inc' && !S.cfg.inc.some(c => c.cat === o.cat && c.subs.includes(o.sub))) return 'Выбери категорию дохода';
  if (T.person && !o.person) return 'Выбери человека';
  if (T.to && (!S.cfg.accounts.some(a => a.name === o.to) || o.to === o.account)) return 'Выбери другой счёт-получатель';
  if (T.to && !T.fx && curOf(o.account) !== curOf(o.to)) return 'Счета в разных валютах — используй «Обмен валюты»';
  if (T.fx && !(o.amountTo > 0)) return 'Укажи, сколько получила';
  return '';
}

// ---------- Расчёты ----------
function balances(uptoMonth) {
  const b = Object.fromEntries(S.cfg.accounts.map(a => [a.name, +a.start || 0]));
  for (const o of live()) {
    if (isPocketOp(o) || validate(o)) continue;
    if (uptoMonth && mkey(o.date) > uptoMonth) continue;
    const T = TYPE[o.type];
    if (b[o.account] !== undefined) b[o.account] += T.sign * o.amount;
    if (T.to && b[o.to] !== undefined) b[o.to] += T.fx ? o.amountTo : o.amount;
  }
  return b;   // остатки в валюте каждого счёта
}
// Итоги по всем счетам в основной валюте: всего, накопления (включая металлы), свободно
function totals(b) {
  let total = 0, sav = 0, missing = [];
  for (const a of S.cfg.accounts) {
    const c = accCur(a), v = toBase(b[a.name], c);
    if (c !== baseCur() && !Rates.get(c) && b[a.name]) missing.push(c);
    total += v; if (a.savings || isMetal(c)) sav += v;
  }
  return { total, sav, free: total - sav, missing: [...new Set(missing)] };
}
function sumType(type, month) { return live().filter(o => o.type === type && mkey(o.date) === month && !validate(o)).reduce((s, o) => s + opBase(o), 0); }
function planFor(month, cat, sub) {
  const p = S.cfg.plans.filter(x => x.month === month && x.cat === cat && x.sub === sub);
  if (p.length) return p.reduce((s, x) => s + (+x.amount || 0), 0);
  const c = S.cfg.exp.find(c => c.cat === cat); const s = c && c.subs.find(s => s.name === sub);
  return s ? (+s.base || 0) : 0;
}
function budget(month) {
  const fact = {};
  for (const o of live()) if (o.type === 'Расход' && mkey(o.date) === month && !validate(o)) { const k = o.cat + '|' + o.sub; fact[k] = (fact[k] || 0) + opBase(o); }
  const cats = S.cfg.exp.map(c => {
    const subs = c.subs.map(s => { const plan = planFor(month, c.cat, s.name), f = fact[c.cat + '|' + s.name] || 0; return { name: s.name, oblig: s.oblig, plan, fact: f, diff: plan - f }; });
    const plan = subs.reduce((a, s) => a + s.plan, 0), f = subs.reduce((a, s) => a + s.fact, 0);
    return { cat: c.cat, pocket: c.pocket, subs, plan, fact: f, diff: plan - f };
  });
  const plan = cats.reduce((a, c) => a + c.plan, 0), f = cats.reduce((a, c) => a + c.fact, 0);
  return { cats, plan, fact: f, diff: plan - f };
}

// ---------- Карманы ----------
// Карман — деньги с назначением. Деньги физически не двигаются: карман — это «пометка» внутри реальных денег.
// «Свободно» = деньги на обычных счетах − сумма карманов. Подушка = накопительные счета (депозит, металлы).
// Перекладки хранятся как операции type '_pocket' {from, to, amount} ('' = «Свободно»).
// Гибкие карманы: остаток прошлых месяцев возвращается в «Свободно» (учитывается только текущий месяц).
const POCKET_KINDS = {
  mandatory: { l: 'Обязательный', i: '🔒', d: 'остаток остаётся; на перерасход не берётся' },
  saving: { l: 'Накопительный', i: '📦', d: 'остаток копится (годовые и сезонные траты); на перерасход — только вручную' },
  flexible: { l: 'Гибкий', i: '🌿', d: 'остаток в конце месяца возвращается в «Свободно»; экономия может покрыть перерасход' },
  buffer: { l: 'Буфер', i: '🛟', d: 'до 10% месячного плана; покрывает перерасход последним' },
  protected: { l: 'Защищённый', i: '🛡', d: 'никогда не берётся автоматически' },
  goal: { l: 'Цель', i: '🎯', d: 'копится на цель (раздел «Цели»); на перерасход не берётся' },
};
// ---------- Цели и накопления ----------
// cfg.goals: [{ id, name, target, deadline, priority 1–5 (1 — главный), linkSavings, archived }]
// Цель — карман типа 'goal' с именем 'goal:<id>'. Цель с linkSavings: накоплено = накопительные счета (подушка на депозите).
const goals = () => S.cfg.goals || [];
const gKey = g => 'goal:' + g.id;
const pLabel = name => { if (!name) return 'Свободно'; if (name.startsWith('goal:')) { const g = goals().find(x => gKey(x) === name); return '🎯 ' + (g ? g.name : 'цель'); } return name; };
function goalInfo(g, ps) {
  const t = today(), saved = r2(g.linkSavings ? ps.savings : ((ps.st[gKey(g)] || {}).bal || 0)), target = +g.target || 0, rest = r2(Math.max(0, target - saved));
  const months = g.deadline ? Math.max(1, Math.ceil(dDiff(g.deadline, t) / 30.44)) : 0;
  const need = !g.deadline ? 0 : g.deadline <= t ? rest : r2(rest / months);
  // Темп: сколько в среднем поступало в цель за последние 3 месяца
  const since = dAdd(t, -91); let inflow = 0;
  if (g.linkSavings) {   // для подушки на депозите — по переводам на накопительные счета и процентам
    const savNames = S.cfg.accounts.filter(a => a.savings).map(a => a.name);
    for (const o of live()) if (!isPocketOp(o) && !validate(o) && o.date >= since) {
      const T = TYPE[o.type]; if (!T) continue;
      if (savNames.includes(o.account)) inflow += T.sign * opBase(o);
      if (T.to && savNames.includes(o.to) && !T.fx) inflow += opBase(o);
    }
  } else for (const o of live()) if (isPocketOp(o) && !validate(o) && o.date >= since) { if (o.to === gKey(g)) inflow += o.amount; if (o.from === gKey(g)) inflow -= o.amount; }
  // темп делим на число месяцев с создания цели (1–3), чтобы новая цель не выглядела «отстающей»
  const ageM = g.createdAt ? Math.min(3, Math.max(1, Math.ceil(dDiff(t, g.createdAt.slice(0, 10)) / 30.44))) : 3;
  const pace = r2(Math.max(0, inflow) / ageM);
  const eta = rest <= 0 ? t : pace > 0 ? addMonthsIso(t, Math.ceil(rest / pace)) : '';
  const fresh = !!g.createdAt && mkey(g.createdAt.slice(0, 10)) === mkey(t) && pace === 0;   // создана в этом месяце, взносов ещё не было
  const onTrack = rest <= 0 || !g.deadline || fresh || (!!eta && eta <= g.deadline) || (pace >= need * 0.99 && need > 0);
  return { g, saved, target, rest, pct: target ? Math.min(1, saved / target) : 0, months, need, pace, eta, onTrack, fresh, done: target > 0 && saved >= target, late: !!g.deadline && g.deadline < t && rest > 0 };
}
// Сводка: сколько нужно откладывать на все цели со сроком и хватает ли текущего остатка месяца
function goalsSummary(ps) {
  const infos = goals().filter(g => !g.archived).map(g => goalInfo(g, ps));
  const needAll = r2(infos.filter(i => !i.done && i.g.deadline).reduce((s, i) => s + i.need, 0));
  const cur = mkey(today()), months = [];
  // только полные месяцы учёта (первый месяц считается, если учёт начат 1-го числа)
  for (let k = 1; k <= 3; k++) { const m = mshift(cur, -k); if (m > mkey(S.cfg.startDate) || (m === mkey(S.cfg.startDate) && S.cfg.startDate.endsWith('-01'))) months.push(m); }
  const cap = months.length ? r2(months.reduce((s, m) => s + sumType('Доход', m) + sumType('Помощь', m) - sumType('Расход', m), 0) / months.length) : null;
  return { infos, needAll, cap, extra: cap === null ? null : r2(Math.max(0, needAll - cap)), monthsUsed: months.length };
}
const DEFAULT_POCKET_KIND = { 'Обязательные платежи': 'mandatory', 'Повседневные расходы': 'flexible', 'Красота и уход': 'flexible', 'Блог': 'flexible', 'Спорт': 'saving', 'Автомобиль': 'saving', 'Здоровье': 'saving', 'Сезонные расходы': 'saving', 'Образование': 'saving', 'Путешествия': 'saving', 'Подарки и праздники': 'saving' };
const isPocketOp = o => o.type === '_pocket';
function pockets() {
  if (S.cfg.pockets) return S.cfg.pockets;
  const ord = ['mandatory', 'saving', 'flexible'];
  const list = [...new Set(S.cfg.exp.map(c => c.pocket).filter(Boolean))].map(n => ({ name: n, kind: DEFAULT_POCKET_KIND[n] || 'flexible' }));
  list.sort((a, b) => ord.indexOf(a.kind) - ord.indexOf(b.kind));
  return [...list, { name: 'Буфер', kind: 'buffer' }, { name: 'Подушка', kind: 'protected', linkSavings: true }];
}
const pocketOfCat = cat => {
  const c = S.cfg.exp.find(x => x.cat === cat), p = c && c.pocket, ps = pockets();
  return ps.some(x => x.name === p && !x.linkSavings) ? p : ((ps.find(x => x.kind === 'flexible') || ps[0] || {}).name);
};
function pocketMonthPlan(name, M) { let s = 0; for (const c of S.cfg.exp) if (pocketOfCat(c.cat) === name) for (const sb of c.subs) s += planFor(M, c.cat, sb.name); return s; }
function pocketState(M) {
  const list = [...pockets(), ...goals().filter(g => !g.linkSavings && !g.archived).map(g => ({ name: gKey(g), label: g.name, kind: 'goal', prio: +g.priority || 3, deadline: g.deadline || '' }))];
  const st = Object.fromEntries(list.map(p => [p.name, { ...p, bal: 0, inM: 0, spentM: 0, plan: p.linkSavings || p.kind === 'buffer' ? 0 : pocketMonthPlan(p.name, M) }]));
  const old = (n, o) => st[n] && st[n].kind === 'flexible' && mkey(o.date) !== M;   // старые месяцы гибких карманов не считаются
  for (const o of live()) {
    if (o.date < S.cfg.startDate || mkey(o.date) > M || validate(o)) continue;
    if (isPocketOp(o)) {
      const cur = mkey(o.date) === M;
      if (o.to && st[o.to] && !st[o.to].linkSavings && !old(o.to, o)) { st[o.to].bal += o.amount; if (cur) st[o.to].inM += o.amount; }
      if (o.from && st[o.from] && !st[o.from].linkSavings && !old(o.from, o)) { st[o.from].bal -= o.amount; if (cur) st[o.from].inM -= o.amount; }
    } else if (o.type === 'Расход') {
      const p = st[pocketOfCat(o.cat)]; if (!p || p.linkSavings || old(p.name, o)) continue;
      const v = opBase(o); p.bal -= v; if (mkey(o.date) === M) p.spentM += v;
    }
  }
  const t = totals(balances(M));
  for (const p of Object.values(st)) if (p.linkSavings) p.bal = t.sav;
  for (const p of Object.values(st)) p.bal = r2(p.bal);
  const sumIn = () => r2(Object.values(st).filter(p => !p.linkSavings).reduce((s, p) => s + p.bal, 0));
  // Авто-покрытие: если трата больше кармана, разница сама берётся из «Свободно» (у свободных денег нет назначения).
  // Ошибка остаётся, только если свободных денег не хватило.
  let free = r2(t.free - Object.values(st).filter(p => !p.linkSavings).reduce((s, p) => s + Math.max(0, p.bal), 0));   // по-настоящему свободные: минус карманов их не увеличивает
  const ordK = ['mandatory', 'saving', 'flexible', 'buffer'];
  for (const p of Object.values(st).filter(p => !p.linkSavings && p.kind !== 'goal' && p.bal < 0).sort((a, b) => ordK.indexOf(a.kind) - ordK.indexOf(b.kind))) {
    if (free <= 0) break;
    const c = r2(Math.min(free, -p.bal)); p.bal = r2(p.bal + c); p.auto = c; free = r2(free - c);
  }
  const inPockets = r2(Object.values(st).filter(p => !p.linkSavings).reduce((s, p) => s + Math.max(0, p.bal), 0)); void sumIn;
  return { st, list: list.map(p => st[p.name]), free, total: t.total, inPockets, savings: t.sav, planTotal: list.reduce((s, p) => s + st[p.name].plan, 0) };
}
// Предложение распределения по правилу: обязательные → накопительные → гибкие → буфер до 10% плана. Остаток — в «Свободно» (цели — следующий этап).
function suggestDistribution(M, avail) {
  const ps = pocketState(M), items = [];
  let left = r2(Math.max(0, avail ?? ps.free));
  const take = (p, need) => { const v = r2(Math.min(left, Math.max(0, need))); if (v > 0) { items.push({ to: p.name, amount: v }); left = r2(left - v); } };
  for (const kind of ['mandatory', 'saving', 'flexible']) for (const p of ps.list.filter(p => p.kind === kind)) take(p, Math.max(p.plan - p.inM, -p.bal));
  for (const p of ps.list.filter(p => p.kind === 'buffer')) take(p, 0.1 * ps.planTotal - p.bal);
  // 4) цели: по приоритету, потом по ближайшему сроку — взнос этого месяца
  const gs = ps.list.filter(p => p.kind === 'goal').sort((a, b) => (a.prio - b.prio) || (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  for (const p of gs) { const g = goals().find(x => gKey(x) === p.name); if (!g) continue; const inf = goalInfo(g, ps); if (!inf.done) take(p, inf.need - Math.max(0, p.inM)); }
  return { items, left };
}
// Покрытие перерасхода кармана: свободные деньги → экономия гибких карманов → буфер. Обязательные, накопительные и Подушку не трогаем.
function coverPlan(M, name) {
  const ps = pocketState(M), p = ps.st[name], moves = [];
  let d = r2(-p.bal); if (d <= 0) return { moves, left: 0 };
  const add = (from, v) => { v = r2(Math.min(d, v)); if (v > 0) { moves.push({ from, to: name, amount: v }); d = r2(d - v); } };
  if (ps.free > 0) add('', ps.free);
  for (const q of ps.list.filter(q => q.kind === 'flexible' && q.name !== name)) { if (d <= 0) break; add(q.name, q.bal - Math.max(0, q.plan - q.spentM)); }
  for (const q of ps.list.filter(q => q.kind === 'buffer' && q.name !== name)) { if (d <= 0) break; add(q.name, q.bal); }
  return { moves, left: d };
}
async function addPocketMoves(moves, comment) {
  const now = Date.now();
  for (const m of moves) {
    const op = { id: uid(), type: '_pocket', date: today(), from: m.from, to: m.to, amount: r2(m.amount), account: '', cat: '', sub: '', person: '', comment: comment || '', createdAt: now, updatedAt: now, device: DEVICE, deleted: false };
    S.ops.push(op); await DB.put(op);
  }
  Sync.soon();
}

// ---------- Проценты по депозиту ----------
// Номинальная ставка — «на бумаге», по ней считается начисление (ставка / 12 в месяц).
// Эффективная (ГЭСВ) — с учётом капитализации: (1 + ном/12)^12 − 1. Если указана одна — вторая рассчитывается.
// Приблизительно: банки считают по-разному (по дням, минимальному остатку) — точная сумма та, что пришла.
const capOn = a => a.capitalize !== false;
function nominalRate(a) {
  if (+a.rate > 0) return +a.rate;
  if (+a.rateEff > 0) return capOn(a) ? 12 * (Math.pow(1 + a.rateEff / 100, 1 / 12) - 1) * 100 : +a.rateEff;
  return 0;
}
function effectiveRate(a) {
  if (+a.rateEff > 0) return +a.rateEff;
  const n = nominalRate(a); return n ? (capOn(a) ? (Math.pow(1 + n / 1200, 12) - 1) * 100 : n) : 0;
}
const fmtPct = x => (+x.toFixed(2)).toLocaleString('ru-RU') + '%';
function addMonthsIso(s, m) { const d = dParse(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + m); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return dIso(d); }
// Срок: число + единица (месяцы/дни). Дата окончания по договору (endDate) главнее расчёта — банки считают по-своему.
const termN = a => +(a.termN ?? a.termMonths) || 0;
const termUnit = a => a.termUnit || 'm';
const termFrom = (a, start) => termN(a) ? (termUnit(a) === 'd' ? dAdd(start, termN(a)) : addMonthsIso(start, termN(a))) : '';
const depEnd = a => a.endDate || (a.openDate ? termFrom(a, a.openDate) : '');
const termLabel = a => termN(a) ? termN(a) + (termUnit(a) === 'd' ? ' дн.' : ' мес.') : 'бессрочный';
const interestMonthly = (a, bal) => { const n = nominalRate(a); return (n > 0 && bal > 0) ? r2(bal * n / 100 / 12) : 0; };
function projectDeposit(a, bal, months) {
  const r = nominalRate(a) / 100 / 12; if (!(bal > 0) || !r || !(months > 0)) return r2(bal || 0);
  return r2(capOn(a) ? bal * Math.pow(1 + r, months) : bal + bal * r * months);
}
// Блок настроек депозита у накопительного счёта
function depositBlock(a, i, bal) {
  const c = accCur(a), n = nominalRate(a), e = effectiveRate(a), end = depEnd(a), t = today();
  const derived = [];
  if (!(+a.rate > 0) && n) derived.push(`номинальная ≈ ${fmtPct(n)} (рассчитана)`);
  if (!(+a.rateEff > 0) && e) derived.push(`эффективная ≈ ${fmtPct(e)} (рассчитана${capOn(a) ? ' при ежемесячной капитализации' : ''})`);
  const check = +a.rate > 0 && +a.rateEff > 0 && capOn(a) ? Math.abs((Math.pow(1 + a.rate / 1200, 12) - 1) * 100 - a.rateEff) : 0;
  const left = end ? Math.max(0, dDiff(end, t)) : 0, monthsLeft = end ? Math.max(0, Math.round(dDiff(end, t) / 30.44)) : 0;
  return `<div style="background:var(--green);border-radius:12px;padding:8px 10px;margin-top:6px">
    <b style="font-size:13px">Депозит</b>
    <div class="grid2"><div><label class="f">Пополнять</label><select class="in" data-acc="${i}" data-k="topUp">${[['yes', 'можно'], ['no', 'нельзя']].map(([v, l]) => `<option value="${v}" ${(a.topUp || 'yes') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label class="f">Снимать</label><select class="in" data-acc="${i}" data-k="withdraw">${Object.entries(WITHDRAW).map(([v, l]) => `<option value="${v}" ${(a.withdraw || 'free') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${a.withdraw === 'partial' ? `<label class="f">Неснижаемый остаток</label><input class="in" data-acc="${i}" data-k="minBal" inputmode="decimal" value="${a.minBal || ''}" placeholder="сколько должно оставаться">` : ''}
    <div class="muted" style="margin-top:4px">${esc(depRulesText(a))}</div>
    <label class="f">День начисления процентов</label><input class="in" data-acc="${i}" data-k="payDay" inputmode="numeric" value="${a.payDay || ''}" placeholder="1–31">
    <div class="grid2"><div><label class="f">Номинальная ставка, %</label><input class="in" data-acc="${i}" data-k="rate" inputmode="decimal" value="${a.rate || ''}" placeholder="например, 14"></div>
      <div><label class="f">Эффективная (ГЭСВ), %</label><input class="in" data-acc="${i}" data-k="rateEff" inputmode="decimal" value="${a.rateEff || ''}" placeholder="например, 14,93"></div></div>
    <div class="grid2"><div><label class="f">Дата открытия</label><input class="in" type="date" data-acc="${i}" data-k="openDate" value="${a.openDate || ''}"></div>
      <div><label class="f">Срок</label><div class="grid2" style="gap:6px"><input class="in" data-acc="${i}" data-k="termN" inputmode="numeric" value="${termN(a) || ''}" placeholder="пусто = без срока"><select class="in" data-acc="${i}" data-k="termUnit"><option value="m" ${termUnit(a) === 'm' ? 'selected' : ''}>мес.</option><option value="d" ${termUnit(a) === 'd' ? 'selected' : ''}>дн.</option></select></div></div></div>
    <label class="f">Дата окончания по договору <span class="muted">(если отличается от расчёта — она главнее)</span></label><input class="in" type="date" data-acc="${i}" data-k="endDate" value="${a.endDate || ''}">
    <label class="f"><input type="checkbox" data-acc="${i}" data-k="autoRenew" ${a.autoRenew ? 'checked' : ''}> автоматическое продление (пролонгация)</label>
    <label class="f"><input type="checkbox" data-acc="${i}" data-k="capitalize" ${capOn(a) ? 'checked' : ''}> проценты прибавляются к вкладу (капитализация)</label>
    ${derived.length ? `<div class="muted">${derived.join(' · ')}</div>` : ''}
    ${check > 0.3 ? `<div class="err">Ставки не сходятся: при номинальной ${fmtPct(+a.rate)} и ежемесячной капитализации эффективная ≈ ${fmtPct((Math.pow(1 + a.rate / 1200, 12) - 1) * 100)}. Проверь в договоре или в Kaspi.</div>` : ''}
    ${end ? `<div class="muted">Окончание: <b>${end.split('-').reverse().join('.')}</b>${a.endDate ? ' (по договору)' : ''}${end >= t ? ` · осталось ${left} дн.` : ' · срок закончился'}${a.autoRenew ? ' · продлится автоматически' : ''}${a.openDate && end ? ` · ${dDiff(end, a.openDate)} дн. от открытия` : ''}</div>` : (a.openDate ? '<div class="muted">Без срока</div>' : '')}
    ${n > 0 ? `<div class="muted">≈ +${fmt(interestMonthly(a, bal), c)} в месяц${end && end >= t && monthsLeft ? ` · к окончанию срока ≈ ${fmt(projectDeposit(a, bal, monthsLeft), c)}` : ''}${end && monthsLeft < 12 ? ' · дальше — по условиям продления' : ` · через 12 мес ≈ ${fmt(projectDeposit(a, bal, 12), c)}`} (без пополнений, приблизительно)</div>` : ''}
    <details><summary class="muted" style="font-weight:600">Номинальная и эффективная — в чём разница?</summary><div class="muted">
      <p style="margin:4px 0"><b>Номинальная</b> — ставка «на бумаге». По ней банк начисляет проценты: в месяц ≈ остаток × ставка / 12.</p>
      <p style="margin:4px 0"><b>Эффективная (ГЭСВ)</b> — реальная доходность за год с учётом того, что проценты прибавляются к вкладу и тоже приносят проценты. Поэтому она чуть выше номинальной.</p>
      <p style="margin:4px 0">Обе ставки есть в договоре и в приложении банка. Впиши хотя бы одну — вторую приложение рассчитает. Ставки меняются — сверяй время от времени.</p>
    </div></details>
    <details><summary class="muted" style="font-weight:600">Пополнять и снимать — зачем это?</summary><div class="muted">
      <p style="margin:4px 0">У депозитов разные правила: в одни можно и класть, и снимать в любой момент; в другие можно только класть до конца срока; в третьи нельзя ни то, ни другое. Обычно банки называют их «несрочный», «срочный» и «сберегательный», но точные правила — в твоём договоре.</p>
      <p style="margin:4px 0">Приложение предупредит, если ты записываешь операцию, которая нарушает условия (например, снятие до окончания срока — банк может не начислить проценты).</p>
    </div></details>
    ${S.closeAcc === a.name ? closeDepForm(a, bal) : `<button class="btn small light" data-closeacc="${esc(a.name)}" style="margin-top:8px">🔒 Закрыть депозит</button>`}
    </div>`;
}
const WITHDRAW = { free: 'можно в любой момент', partial: 'частично (до неснижаемого остатка)', no: 'нельзя до окончания срока' };
function depRulesText(a) {
  const up = (a.topUp || 'yes') === 'yes', w = a.withdraw || 'free';
  if (up && w === 'free') return 'Можно и пополнять, и снимать в любой момент (обычно «несрочный» депозит).';
  if (up && w === 'partial') return `Пополнять можно, снимать — пока остаётся не меньше ${a.minBal ? fmt(+a.minBal, accCur(a)) : 'неснижаемого остатка'}.`;
  if (up && w === 'no') return 'Деньги только ложатся: пополнять можно, снимать до окончания срока нельзя — иначе можно потерять проценты (обычно «срочный» депозит).';
  if (!up && w === 'no') return 'Ни пополнять, ни снимать до окончания срока (обычно «сберегательный» депозит).';
  return w === 'partial' ? 'Пополнять нельзя, снимать — до неснижаемого остатка.' : 'Пополнять нельзя, снимать можно.';
}
// Предупреждение, если операция нарушает условия депозита (возвращает текст или '')
function depositRuleWarn(o) {
  const T = TYPE[o.type]; if (!T) return '';
  const msgs = [], b = balances();
  const out = S.cfg.accounts.find(a => a.name === o.account && a.savings);
  if (out && T.sign < 0) {
    const w = out.withdraw || 'free', end = depEnd(out);
    if (w === 'no' && (!end || o.date < end)) msgs.push(`По условиям с депозита «${out.name}» нельзя снимать${end ? ' до ' + end.split('-').reverse().join('.') : ''} — банк может не начислить проценты.`);
    if (w === 'partial' && +out.minBal > 0 && b[out.name] - o.amount < +out.minBal) msgs.push(`После этой операции на «${out.name}» останется меньше неснижаемого остатка (${fmt(+out.minBal, accCur(out))}).`);
  }
  const inAcc = S.cfg.accounts.find(a => a.savings && (T.to ? a.name === o.to : (T.sign > 0 && a.name === o.account)));
  const isInterest = o.type === 'Доход' && o.cat === 'Банк' && o.sub === 'Проценты по депозиту';
  if (inAcc && !isInterest && inAcc.topUp === 'no') msgs.push(`По условиям депозит «${inAcc.name}» нельзя пополнять.`);
  return msgs.join('\n');
}
// Закрытие депозита: последние проценты (если есть) + перевод всего остатка на выбранный счёт; счёт уходит в «Закрытые»
function closeDepForm(a, bal) {
  const same = openAccs().filter(x => x.name !== a.name && accCur(x) === accCur(a));
  return `<div class="card" style="padding:8px 10px;margin-top:8px"><b>🔒 Закрытие депозита</b>
    <div class="muted">Сейчас на нём ${fmt(bal, accCur(a))}. Если при закрытии банк начислил последние проценты — впиши их, они запишутся доходом.</div>
    <div class="grid2"><div><label class="f">Последние проценты</label><input class="in" id="clInt" inputmode="decimal" placeholder="0"></div><div><label class="f">Дата закрытия</label><input class="in" type="date" id="clDate" value="${today()}"></div></div>
    ${same.length ? `<label class="f">Куда перевести все деньги</label><select class="in" id="clTo">${same.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select>
    <button class="btn small" data-closeok="${esc(a.name)}">Закрыть депозит</button>` : '<div class="err">Нет открытого счёта в этой валюте, куда перевести деньги — добавь его.</div>'}
    <button class="btn small light" data-closecancel="1">Отмена</button></div>`;
}
// Начальный остаток: вводится один раз → «Сохранить» → «Всё верно?» Да/Нет → «Сохранить» ещё раз → закреплён навсегда.
// После сохранения поле исчезает из счёта (видно только в «С чего начался учёт»), ошибки исправляются только сверкой.
const accHasOps = a => live().some(o => !isPocketOp(o) && (o.account === a.name || o.to === a.name));
const startSaved = a => !!a.startLocked || accHasOps(a);
const dRu = d => d ? d.split('-').reverse().join('.') : '';
function startField(a, i) {
  if (startSaved(a)) return '';
  const unit = isMetal(accCur(a)) ? ' (в граммах)' : '';
  return `<div class="info" style="margin-top:8px"><b>Начальный остаток на ${dRu(S.cfg.startDate)}${unit}</b><br>Сколько было на счёте в этот день. Сохраняется один раз и больше не меняется.
    <div class="grid2" style="margin-top:6px"><input class="in" id="st${i}" inputmode="decimal" value="${a.start || ''}" placeholder="0"><button class="btn small" data-startsave="${i}" style="margin:0">Сохранить</button></div></div>`;
}
// Окно с кнопками: возвращает значение нажатой кнопки
function askModal(body, btns) {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'modal';
    el.innerHTML = `<div class="modal-box">${body}${btns.map((b, k) => `<button class="btn ${b.light ? 'light' : ''}" data-mb="${k}">${esc(b.t)}</button>`).join('')}</div>`;
    document.body.appendChild(el);
    el.querySelectorAll('[data-mb]').forEach(x => x.onclick = () => { el.remove(); res(btns[+x.dataset.mb].v); });
  });
}
// «С чего начался учёт»: зафиксированная точка отсчёта, только просмотр
function startRecord() {
  const accs = S.cfg.accounts, any = accs.some(startSaved);
  const tot = totals(Object.fromEntries(accs.map(a => [a.name, startSaved(a) ? +a.start || 0 : 0]))).total;
  return `<details class="card" style="padding:4px 12px"><summary style="font-weight:600">📜 С чего начался учёт</summary>
    <div class="muted" style="margin-bottom:6px">Точка отсчёта: что было на счетах ${dRu(S.cfg.startDate)}. Её нельзя изменить — если что-то было введено неверно, это исправляется сверкой с банком.</div>
    <table class="t">${accs.map(a => `<tr><td>${esc(a.name)}${a.closed ? ' <span class="sub">· закрыт</span>' : ''}<div class="sub">${startSaved(a) ? (a.startSavedAt ? 'сохранён ' + dRu(a.startSavedAt) : 'закреплён') : 'ещё не сохранён'}</div></td><td>${startSaved(a) ? fmt(+a.start || 0, accCur(a)) : '–'}</td></tr>`).join('')}
    ${any ? `<tr><th>Итого</th><th>${money(tot)}</th></tr>` : ''}</table></details>`;
}
// Сверка с банком: разовое действие — ввела сумму из банка → «Сверить» → сразу результат
function reconField(a, i, bal) {
  const last = a.reconciledAt ? 'последняя ' + a.reconciledAt.split('-').reverse().join('.') : 'ещё не было';
  const pend = a.reconPending;
  return `<label class="f">Сверка с банком · ${last}</label>
    <div class="grid2"><input class="in" id="rc${i}" inputmode="decimal" placeholder="сколько в банке сейчас"><button class="btn small" data-recon="${i}" style="margin:0">Сверить</button></div>
    ${pend ? `<div class="err" style="margin-top:6px">Сверка ${pend.date.split('-').reverse().join('.')}: в банке ${fmt(pend.bank, accCur(a))}, по учёту было ${fmt(pend.calc, accCur(a))} — разница ${(pend.bank - pend.calc > 0 ? '+' : '−') + fmt(Math.abs(pend.bank - pend.calc), accCur(a))}.
      <div><button class="btn small" data-reconfix="${i}" style="margin:4px 4px 0 0">${pend.bank > pend.calc ? '💰 Нашла средства: внести +' : 'Внести списание −'}${fmt(Math.abs(pend.bank - pend.calc), accCur(a))}</button><button class="btn small light" data-reconok="${i}" style="margin:4px 0 0">Найду пропущенную операцию сама</button></div></div>` : ''}`;
}
function closedAccRow(a, i) {
  return `<div class="row"><span class="sub">🔒 ${esc(a.name)} · закрыт ${a.closedAt ? a.closedAt.split('-').reverse().join('.') : ''}</span><button class="btn small light" data-reopen="${i}" style="margin:0">Открыть снова</button></div>`;
}
// Ожидаемые проценты как «поступления» в календаре платежей (не редактируются — считаются из счёта)
function interestPayments() {
  const b = balances();
  return S.cfg.accounts.filter(a => !a.closed && a.savings && nominalRate(a) > 0 && !isMetal(accCur(a))).map(a => ({
    id: 'int:' + a.name, name: 'Проценты: ' + a.name, kind: 'in', auto: true, toSavings: true,
    amount: r2(toBase(interestMonthly(a, b[a.name]), accCur(a))), account: a.name, cat: 'Банк', sub: 'Проценты по депозиту', person: '',
    freq: 'month', day: +a.payDay || 1, start: S.cfg.startDate, end: a.autoRenew ? '' : depEnd(a), active: true,
  }));
}
const allPayments = () => [...payments(), ...interestPayments(), ...debtPayments()];

// ---------- Регулярные платежи и поступления ----------
// cfg.payments: [{ id, name, kind:'out'|'in', amount, account, cat, sub, person, freq:'month'|'months'|'year'|'week', n, day, start, end, active }]
// Оплата распознаётся по операции: явная связь (op.payId) или та же категория/подкатегория рядом с датой платежа.
const FREQS = { month: 'Каждый месяц', months: 'Каждые N месяцев', year: 'Раз в год', week: 'Каждую неделю' };
const payments = () => S.cfg.payments || [];
const dIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dParse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dAdd = (s, days) => { const d = dParse(s); d.setDate(d.getDate() + days); return dIso(d); };
const dDiff = (a, b) => Math.round((dParse(a) - dParse(b)) / 864e5);
const dHuman = s => dParse(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });
// Даты платежа в промежутке [from, to]
function payDates(p, from, to) {
  const out = [], start = p.start || S.cfg.startDate, end = p.end || '9999-12-31';
  const lo = from > start ? from : start, hi = to < end ? to : end;
  if (lo > hi) return out;
  if (p.freq === 'week') {
    let d = start; const k = Math.max(0, Math.floor(dDiff(lo, start) / 7)); d = dAdd(start, 7 * k);
    for (; d <= hi; d = dAdd(d, 7)) if (d >= lo) out.push(d);
    return out;
  }
  const step = p.freq === 'year' ? 12 : p.freq === 'months' ? Math.max(1, +p.n || 1) : 1;
  const sd = dParse(start); let y = sd.getFullYear(), m = sd.getMonth();
  if (p.freq === 'year' && p.month) m = +p.month - 1;
  for (let i = 0; i < 2000; i++) {
    const dim = new Date(y, m + 1, 0).getDate();
    const d = dIso(new Date(y, m, Math.min(+p.day || 1, dim)));
    if (d > hi) break;
    if (d >= lo) out.push(d);
    m += step; while (m > 11) { m -= 12; y++; }
  }
  return out;
}
// Окно, в котором операция считается оплатой этой даты
const payWindow = (p, due) => p.freq === 'week' ? [dAdd(due, -3), dAdd(due, 3)] : p.freq === 'year' ? [dAdd(due, -20), dAdd(due, 20)]
  : p.freq === 'months' ? [dAdd(due, -15), dAdd(due, 15)] : [due.slice(0, 8) + '01', dIso(new Date(+due.slice(0, 4), +due.slice(5, 7), 0))];
function payMatches(p, due) {
  const [a, b] = payWindow(p, due);
  const shared = allPayments().filter(q => q.active !== false && q.kind === p.kind && q.cat === p.cat && q.sub === p.sub && (q.person || '') === (p.person || '')).length > 1;
  return live().filter(o => {
    if (isPocketOp(o) || validate(o) || o.date < a || o.date > b) return false;
    if (p.debtId) { const dd = debts().find(x => x.id === p.debtId); return o.payId === p.id || (o.type === 'Я вернула долг' && !!dd && debtOpMatch(dd, o)); }
    if (o.payId) return o.payId === p.id;
    if (shared) return false;                                   // одинаковая категория у нескольких платежей — нужна явная отметка
    if (p.kind === 'out') return o.type === 'Расход' && o.cat === p.cat && o.sub === p.sub;
    if (p.person) return o.type === 'Помощь' && o.person === p.person;
    if (p.toSavings) return o.type === 'Доход' && o.cat === p.cat && o.sub === p.sub && o.account === p.account;
    return o.type === 'Доход' && o.cat === p.cat && o.sub === p.sub;
  });
}
// Все даты платежей в окне со статусами
function payCalendar(from, to) {
  const t = today(), rows = [];
  for (const p of allPayments()) {
    if (p.active === false) continue;
    for (const due of payDates(p, from, to)) {
      const paid = r2(payMatches(p, due).reduce((s, o) => s + opBase(o), 0));
      const skipped = (S.cfg.intSkipped || []).includes(p.id + '|' + due);
      const status = skipped ? 'skipped' : paid >= p.amount * 0.99 ? 'paid' : paid > 0 ? 'partial' : due < t ? 'overdue' : dDiff(due, t) <= 3 ? 'soon' : 'planned';
      rows.push({ p, due, paid, left: r2(Math.max(0, p.amount - paid)), status });
    }
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due));
}
const PAY_ST = { skipped: ['—', 'начисления не было'], paid: ['✅', 'оплачено'], partial: ['◐', 'частично'], overdue: ['⚠', 'просрочено'], soon: ['⏳', 'скоро'], planned: ['📅', 'по плану'] };
// Прогноз: сколько уйдёт и придёт за 7 и 30 дней и хватит ли денег до следующего поступления
function payForecast() {
  const t = today(), cal = payCalendar(dAdd(t, -60), dAdd(t, 400)).filter(r => r.status !== 'paid' && r.status !== 'skipped');
  const outs = cal.filter(r => r.p.kind === 'out'), ins = cal.filter(r => r.p.kind === 'in' && !r.p.toSavings && r.due >= t);   // проценты идут на депозит — не в «хватит ли до поступления»
  const sumTo = (list, d) => r2(list.filter(r => r.due <= d).reduce((s, r) => s + r.left, 0));
  const cash = totals(balances()).free;                         // деньги на обычных (не накопительных) счетах
  const next = ins[0];
  const need = next ? sumTo(outs, next.due) : sumTo(outs, dAdd(t, 30));
  return { cash: r2(cash), out7: sumTo(outs, dAdd(t, 7)), out30: sumTo(outs, dAdd(t, 30)), in30: sumTo(ins, dAdd(t, 30)), next, need, enough: cash >= need, overdue: outs.filter(r => r.due < t) };
}

// ---------- Долги, имущество, чистый капитал ----------
// cfg.debts: [{ id, name, kind:'installment'|'credit'|'loan'|'lent', person, balance (остаток на дату), balanceDate, balanceSetAt (время ввода),
//               rate (% годовых), monthly (платёж в месяц), day (день платежа), account (с какого счёта платить), archived }]
// Остаток = введённый остаток − платежи после ввода («Я вернула долг» / «Мне вернули долг») + новые займы («Заём получен» / «Заём выдан»).
// cfg.assets: [{ id, name, kind, value }] — имущество по оценке.
const DEBT_KINDS = { installment: '🧾 Рассрочка', credit: '🏦 Кредит', loan: '🤝 Заём у человека', lent: '💸 Я дала в долг' };
const ASSET_KINDS = ['Недвижимость', 'Автомобиль', 'Техника', 'Украшения', 'Другое'];
const debts = () => (S.cfg.debts || []).filter(d => !d.archived);
const assets = () => S.cfg.assets || [];
const isLent = d => d.kind === 'lent';
// Операция относится к долгу: явная связь (debtId) или тот же человек, если долг у него один
function debtOpMatch(d, o) {
  if (o.debtId) return o.debtId === d.id;
  if (!d.person || o.person !== d.person) return false;
  return debts().filter(x => x.person === d.person && isLent(x) === isLent(d)).length === 1;
}
function debtBalance(d, upto) {
  let b = +d.balance || 0;
  for (const o of live()) {
    if (isPocketOp(o) || validate(o) || !debtOpMatch(d, o)) continue;
    if (o.date < (d.balanceDate || '0000') || (o.createdAt || 0) <= (d.balanceSetAt || 0)) continue;
    if (upto && o.date > upto) continue;
    const v = opBase(o);
    if (!isLent(d)) { if (o.type === 'Я вернула долг') b -= v; else if (o.type === 'Заём получен') b += v; }
    else { if (o.type === 'Мне вернули долг') b -= v; else if (o.type === 'Заём выдан') b += v; }
  }
  return r2(Math.max(0, b));
}
function debtInfo(d) {
  const rest = debtBalance(d), m = +d.monthly || 0;
  const months = m > 0 ? Math.ceil(rest / m) : 0;
  const t = today(), firstDue = d.day ? (() => { const x = dParse(t); const dim = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); const cand = dIso(new Date(x.getFullYear(), x.getMonth(), Math.min(+d.day, dim))); return cand >= t ? cand : addMonthsIso(cand, 1); })() : t;
  const endDate = months > 0 ? addMonthsIso(firstDue, months - 1) : '';
  const interestM = +d.rate > 0 ? r2(rest * d.rate / 1200) : 0;
  return { d, rest, months, endDate, interestM, done: rest <= 0 };
}
// Платежи по долгам — авто-строки в календаре «Платежи»
function debtPayments() {
  return debts().filter(d => !isLent(d) && +d.monthly > 0 && +d.day > 0).map(d => {
    const i = debtInfo(d); if (i.done) return null;
    return { id: 'debt:' + d.id, name: 'Платёж: ' + d.name, kind: 'out', auto: true, debtId: d.id, amount: r2(Math.min(+d.monthly, i.rest)), account: d.account || '', cat: '', sub: '', person: d.person || '',
      freq: 'month', day: +d.day, start: d.balanceDate || S.cfg.startDate, end: i.endDate, active: true };
  }).filter(Boolean);
}
// Чистый капитал = деньги на счетах (вкл. депозиты и металлы) + имущество + что мне должны − мои долги
function capital(upto) {
  const t = totals(upto ? balances(mkey(upto)) : balances());
  const prop = r2(assets().reduce((s, a) => s + (+a.value || 0), 0));
  let owe = 0, owed = 0;
  for (const d of debts()) { const b = debtBalance(d, upto); if (isLent(d)) owed += b; else owe += b; }
  return { money: r2(t.total), prop, owed: r2(owed), owe: r2(owe), net: r2(t.total + prop + owed - owe) };
}
// Капитал на конец последних месяцев (имущество — по текущей оценке)
function capitalHistory(n) {
  const out = [], cur = mkey(today());
  for (let k = n - 1; k >= 0; k--) {
    const M = mshift(cur, -k); if (M < mkey(S.cfg.startDate)) continue;
    const end = k === 0 ? today() : dIso(new Date(+M.slice(0, 4), +M.slice(5, 7), 0));
    out.push({ M, ...capital(end) });
  }
  return out;
}
function renderCapital() {
  const c = capital(), hist = capitalHistory(6), maxNet = Math.max(1, ...hist.map(h => Math.abs(h.net)));
  const dl = debts().map(debtInfo), mine = dl.filter(i => !isLent(i.d)), lent = dl.filter(i => isLent(i.d));
  const ed = S.debtEdit ? (S.cfg.debts || []).find(d => d.id === S.debtEdit) : null;
  const ae = S.assetEdit ? assets().find(a => a.id === S.assetEdit) : null;
  const accOpts = sel => openAccs().map(a => `<option value="${esc(a.name)}" ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const kind = (ed && ed.kind) || S.debtKind || 'installment';
  $('#view').innerHTML = budgetSeg() + `
  <div class="cards">
    <div class="kpi ${c.net < 0 ? 'powder' : 'green'}"><div class="l">Чистый капитал</div><div class="v ${c.net < 0 ? 'neg' : ''}">${money(c.net)}</div><div class="s">всё моё − мои долги</div></div>
    <div class="kpi blue"><div class="l">Деньги</div><div class="v">${money(c.money)}</div><div class="s">все счета, депозиты, металлы</div></div>
    <div class="kpi lilac"><div class="l">Имущество + мне должны</div><div class="v">${money(c.prop + c.owed)}</div><div class="s">${money(c.prop)} + ${money(c.owed)}</div></div>
    <div class="kpi powder"><div class="l">Мои долги</div><div class="v ${c.owe ? 'neg' : ''}">${money(c.owe)}</div><div class="s">рассрочки, кредиты, займы</div></div>
  </div>
  ${hist.length > 1 ? `<h2>Как менялся капитал</h2><div class="card">${hist.map(h => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span>${mlabel(h.M)}</span><b class="${h.net < 0 ? 'neg' : ''}">${money(h.net)}</b></div><div class="bar"><i style="width:${Math.max(2, Math.abs(h.net) / maxNet * 100)}%;${h.net < 0 ? 'background:var(--red)' : ''}"></i></div></div>`).join('')}
    <div class="sub" style="padding:6px 0">Имущество — по текущей оценке.${hist.length >= 2 ? ` За период: ${(hist[hist.length - 1].net - hist[0].net >= 0 ? '+' : '−') + money(Math.abs(hist[hist.length - 1].net - hist[0].net))}` : ''}</div></div>` : ''}
  <h2>Мои долги</h2>
  ${mine.length ? mine.map(debtCard).join('') : '<div class="card"><div class="row muted">Долгов нет 🎉 Если есть рассрочка или кредит — добавь ниже.</div></div>'}
  ${lent.length ? `<h2>Мне должны</h2>${lent.map(debtCard).join('')}` : ''}
  <h2>${ed ? 'Правка долга' : 'Добавить долг'}</h2>
  <div class="card" style="padding:10px 12px">
    <div class="seg">${Object.entries(DEBT_KINDS).map(([k, l]) => `<button class="chip ${k === kind ? 'on' : ''}" data-dkind="${k}">${l}</button>`).join('')}</div>
    <label class="f">Название</label><input class="in" id="dName" value="${esc(ed ? ed.name : '')}" placeholder="${kind === 'installment' ? 'Например: Рассрочка на телефон' : kind === 'credit' ? 'Например: Кредит на машину' : kind === 'lent' ? 'Например: Айгерим до зарплаты' : 'Например: Заём у брата'}">
    <label class="f">${kind === 'lent' ? 'Кто должен' : 'Кому плачу (банк или человек)'}</label><select class="in" id="dPerson"><option value="">—</option>${S.cfg.people.map(p => `<option ${ed && p.name === ed.person ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <div class="muted">Нет в списке? Добавь в «Ещё → Люди» (например, «Kaspi рассрочка» уже есть).</div>
    <div class="grid2"><div><label class="f">${kind === 'lent' ? 'Сколько должны сейчас' : 'Остаток долга сейчас'}</label><input class="in" id="dBal" inputmode="decimal" value="${ed ? debtBalance(ed) : ''}"></div>
      <div><label class="f">На дату</label><input class="in" type="date" id="dDate" value="${today()}"></div></div>
    ${kind === 'lent' ? '' : `<div class="grid2"><div><label class="f">Платёж в месяц</label><input class="in" id="dMonthly" inputmode="decimal" value="${ed ? ed.monthly || '' : ''}"></div>
      <div><label class="f">День платежа</label><input class="in" id="dDay" inputmode="numeric" value="${ed ? ed.day || '' : ''}" placeholder="1–31"></div></div>
    <div class="grid2"><div><label class="f">Ставка, % годовых</label><input class="in" id="dRate" inputmode="decimal" value="${ed ? ed.rate || '' : ''}" placeholder="${kind === 'installment' ? '0 — рассрочка' : 'из договора'}"></div>
      <div><label class="f">Платить со счёта</label><select class="in" id="dAcc">${accOpts(ed ? ed.account : (openAccs()[0] || {}).name)}</select></div></div>`}
    <div class="err" id="dErr"></div>
    <button class="btn" id="dSave">${ed ? 'Сохранить' : '+ Добавить'}</button>
    ${ed ? '<button class="btn light" id="dCancel">Отмена</button><button class="btn danger" id="dDel">Удалить (в архив)</button>' : ''}
  </div>
  <h2>Имущество</h2>
  <div class="card">${assets().length ? assets().map(a => `<div class="row"><span>${esc(a.name)} <span class="sub">· ${esc(a.kind)}</span></span><span style="white-space:nowrap"><b>${money(a.value)}</b> <button class="btn small light" data-aedit="${a.id}" style="margin:0;padding:4px 8px">✎</button></span></div>`).join('') : '<div class="row muted">Имущества пока нет. Машина, квартира, техника — добавь по оценочной стоимости.</div>'}</div>
  <div class="card" style="padding:10px 12px"><b>${ae ? 'Правка имущества' : 'Добавить имущество'}</b>
    <div class="grid2"><div><label class="f">Название</label><input class="in" id="aName" value="${esc(ae ? ae.name : '')}" placeholder="Например: Ноутбук"></div>
      <div><label class="f">Вид</label><select class="in" id="aKind">${ASSET_KINDS.map(k => `<option ${ae && ae.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
    <label class="f">Сколько стоит сейчас (примерно)</label><input class="in" id="aValue" inputmode="decimal" value="${ae ? ae.value : ''}">
    <button class="btn small" id="aSave">${ae ? 'Сохранить' : '+ Добавить'}</button>${ae ? '<button class="btn small light" id="aCancel">Отмена</button><button class="btn small danger" id="aDel">Удалить</button>' : ''}
  </div>
  <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как это работает?</summary><div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0"><b>Чистый капитал</b> = все деньги на счетах (вкл. депозиты и золото) + имущество + что тебе должны − твои долги. Это главный показатель того, как растёт твоё финансовое положение.</p>
    <p style="margin:4px 0"><b>Долг</b>: впиши остаток на сегодня, платёж и день. Платёж сам появится в «Платежах». Когда платишь — «+» → «Ещё…» → «Я вернула долг» (выбери долг) — остаток уменьшится.</p>
    <p style="margin:4px 0"><b>Кредит с процентами</b>: часть платежа — проценты, поэтому остаток в банке уменьшается медленнее. Раз в месяц сверь остаток в приложении банка и обнови его здесь (✎).</p>
    <p style="margin:4px 0"><b>Я дала в долг</b>: «Заём выдан» увеличивает, «Мне вернули долг» уменьшает.</p>
    <p style="margin:4px 0"><b>Имущество</b> — по примерной стоимости, без точности до тенге. Обновляй раз в полгода.</p>
    <p style="margin:4px 0">Это учёт, а не инвестиционные рекомендации.</p>
  </div></details>`;
  bindBudgetSeg();
  document.querySelectorAll('[data-dkind]').forEach(b => b.onclick = () => { S.debtKind = b.dataset.dkind; if (ed) ed.kind = b.dataset.dkind; renderCapital(); });
  $('#dSave').onclick = async () => {
    const name = $('#dName').value.trim(), bal = num($('#dBal').value), date = $('#dDate').value || today();
    if (!name) return ($('#dErr').textContent = '⚠ Назови долг');
    if (!(bal >= 0) || $('#dBal').value.trim() === '') return ($('#dErr').textContent = '⚠ Укажи остаток');
    const rec = { ...(ed || {}), kind, name, person: $('#dPerson').value, balance: bal, balanceDate: date, balanceSetAt: Date.now() };
    if (kind !== 'lent') Object.assign(rec, { monthly: num($('#dMonthly').value), day: Math.min(31, Math.max(0, Math.round(num($('#dDay').value)))) || null, rate: num($('#dRate').value), account: $('#dAcc').value });
    const list = (S.cfg.debts || []).slice();
    if (ed) list[list.findIndex(d => d.id === ed.id)] = rec; else list.push({ ...rec, id: uid().slice(0, 8) });
    S.cfg.debts = list; S.debtEdit = null; await saveCfg(); toast(ed ? 'Долг обновлён' : 'Долг добавлен'); renderCapital();
  };
  if ($('#dCancel')) $('#dCancel').onclick = () => { S.debtEdit = null; renderCapital(); };
  if ($('#dDel')) $('#dDel').onclick = async () => { if (!confirm('Убрать «' + ed.name + '» в архив? Операции останутся.')) return; S.cfg.debts = S.cfg.debts.map(d => d.id === ed.id ? { ...d, archived: true } : d); S.debtEdit = null; await saveCfg(); renderCapital(); };
  document.querySelectorAll('[data-dedit]').forEach(b => b.onclick = () => { S.debtEdit = b.dataset.dedit; renderCapital(); setTimeout(() => $('#dName').scrollIntoView({ block: 'center' }), 50); });
  document.querySelectorAll('[data-dpay]').forEach(b => b.onclick = () => {
    const d = debts().find(x => x.id === b.dataset.dpay), i = debtInfo(d);
    S.edit = null; S.draft = { ...newDraft(), type: isLent(d) ? 'Мне вернули долг' : 'Я вернула долг', amount: String(isLent(d) ? i.rest : Math.min(+d.monthly || i.rest, i.rest)), account: d.account || newDraft().account, person: d.person || '', debtId: d.id, payId: isLent(d) ? '' : 'debt:' + d.id };
    setTab('add');
  });
  $('#aSave').onclick = async () => {
    const name = $('#aName').value.trim(), value = num($('#aValue').value); if (!name || !(value >= 0)) { toast('Укажи название и стоимость'); return; }
    const list = assets().slice(), rec = { ...(ae || {}), name, kind: $('#aKind').value, value, updated: today() };
    if (ae) list[list.findIndex(a => a.id === ae.id)] = rec; else list.push({ ...rec, id: uid().slice(0, 8) });
    S.cfg.assets = list; S.assetEdit = null; await saveCfg(); toast('Имущество сохранено'); renderCapital();
  };
  if ($('#aCancel')) $('#aCancel').onclick = () => { S.assetEdit = null; renderCapital(); };
  if ($('#aDel')) $('#aDel').onclick = async () => { if (!confirm('Удалить «' + ae.name + '»?')) return; S.cfg.assets = assets().filter(a => a.id !== ae.id); S.assetEdit = null; await saveCfg(); renderCapital(); };
  document.querySelectorAll('[data-aedit]').forEach(b => b.onclick = () => { S.assetEdit = b.dataset.aedit; renderCapital(); setTimeout(() => $('#aName').scrollIntoView({ block: 'center' }), 50); });
}
function debtCard(i) {
  const d = i.d, lent = isLent(d);
  const info = lent ? `должны мне${d.person ? ' · ' + esc(d.person) : ''}`
    : [d.person && esc(d.person), +d.monthly ? 'платёж ' + money(d.monthly) + (d.day ? ' · ' + d.day + '-го' : '') : 'платёж не указан', +d.rate ? 'ставка ' + fmtPct(+d.rate) + ' · ≈ ' + money(i.interestM) + '/мес проценты' : (d.kind === 'installment' ? 'без процентов' : ''), i.months ? `осталось ${i.months} мес. · до ${i.endDate.split('-').reverse().join('.')}` : ''].filter(Boolean).join(' · ');
  const paid = +d.balance > 0 ? Math.min(1, 1 - i.rest / Math.max(+d.balance, i.rest)) : 1;
  return `<div class="card" style="padding:10px 12px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${DEBT_KINDS[d.kind].split(' ')[0]} ${esc(d.name)}</b><b class="${lent ? 'pos' : 'neg'}">${money(i.rest)}</b></div>
    <div class="bar"><i style="width:${paid * 100}%;background:var(--greenInk)"></i></div>
    <div class="sub" style="margin-top:4px">${i.done ? (lent ? '🎉 вернули полностью' : '🎉 погашен') : info}</div>
    <div>${i.done ? '' : `<button class="btn small" data-dpay="${d.id}">${lent ? 'Мне вернули' : 'Внести платёж'}</button>`}<button class="btn small light" data-dedit="${d.id}">✎</button></div></div>`;
}
// Выбор долга в форме операции (для займов и возвратов)
function debtLinkRow(d) {
  const lentTypes = ['Заём выдан', 'Мне вернули долг'], mineTypes = ['Заём получен', 'Я вернула долг'];
  const want = lentTypes.includes(d.type) ? 'lent' : mineTypes.includes(d.type) ? 'mine' : '';
  if (!want) return '';
  const fit = debts().filter(x => (want === 'lent') === isLent(x) && (!d.person || !x.person || x.person === d.person));
  if (!fit.length) return '';
  return `<label class="f">По какому долгу?</label><div class="seg">${fit.map(x => `<button class="chip ${d.debtId === x.id ? 'on' : ''}" data-debtlink="${x.id}">${esc(x.name)}</button>`).join('')}<button class="chip ${!d.debtId ? 'on' : ''}" data-debtlink="">${d.type === 'Заём выдан' || d.type === 'Заём получен' ? '＋ Новый долг' : 'Другое'}</button></div>`;
}

// ---------- Навигация ----------
// Переход по предупреждению «Внимание»: открыть нужный экран и подсветить место
function goTo(key) {
  const [k, arg] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
  let sel = null;
  if (k === 'hist') setTab('history');
  else if (['plan', 'pockets', 'pay', 'goals', 'dist', 'pocket'].includes(k)) {
    S.btab = { plan: 'plan', pay: 'pay', goals: 'goals' }[k] || 'pockets'; S.dist = k === 'dist'; setTab('budget');
    if (k === 'pocket') sel = `[data-pocketrow="${CSS.escape(arg)}"]`;
  } else {
    setTab('more');
    if (k === 'cur') sel = '#secCur'; else if (k === 'cat') sel = '#secCat';
    else { const i = S.cfg.accounts.findIndex(a => a.name === arg); sel = k === 'acc' && key.includes(':') && i >= 0 ? '#acc' + i : '#secAcc'; }
  }
  const el = sel && document.querySelector(sel);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
}
// Разделы: «Сегодня» (день), «Финансы» (обзор, история, бюджет, аналитика, отчёт), «План», «Ещё»
const FIN_TABS = ['overview', 'history', 'budget', 'analytics', 'report'], LIFE_TABS = ['today', 'day', 'days', 'lifeset'];
function setTab(t) {
  S.tab = t;
  const nav = FIN_TABS.includes(t) ? 'fin' : LIFE_TABS.includes(t) ? 'today' : t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === nav));
  const bs = $('#brandSub'); if (bs) bs.textContent = '· ' + ({ fin: 'Финансы', add: 'Финансы', today: 'Сегодня', plan: 'План', more: 'Ещё' }[nav] || '');
  render(); window.scrollTo(0, 0);
}
function renderFinNav() {
  const el = $('#finNav'); if (!el) return;
  const show = ['overview', 'history', 'budget'].includes(S.tab);
  el.style.display = show ? '' : 'none'; if (!show) return;
  el.innerHTML = `<div class="seg">${[['overview', '◉ Обзор'], ['history', '☰ История'], ['budget', '▤ Бюджет'], ['analytics', '📊 Аналитика']].map(([k, l]) => `<button class="chip ${S.tab === k ? 'on' : ''}" data-fin="${k}">${l}</button>`).join('')}</div>`;
  el.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => setTab(b.dataset.fin));
}
function render() {
  const im = $('#intModal'); if (im) im.remove();
  $('#mLabel').textContent = mlabel(S.month);
  $('#monthBar').style.visibility = (!FIN_TABS.includes(S.tab) || (S.tab === 'analytics' && anState().p !== 'm') || (S.tab === 'history' && S.hf && S.hf.per !== 'month')) ? 'hidden' : 'visible';
  renderFinNav();
  ({ overview: renderOverview, history: renderHistory, add: renderAdd, budget: renderBudget, more: renderMore, analytics: renderAnalytics, report: renderReport,
    today: renderToday, day: renderDay, days: renderDays, lifeset: renderLifeSet, plan: renderPlan })[S.tab]();
}

// ---------- Обзор ----------
function renderOverview() {
  const m = S.month, b = balances(m);
  const { total, sav, missing } = totals(b);
  const ps = pocketState(m), negPockets = ps.list.filter(p => p.bal < 0 && !p.linkSavings);
  const inc = sumType('Доход', m), help = sumType('Помощь', m), exp = sumType('Расход', m);
  const prevExp = sumType('Расход', mshift(m, -1));
  const bud = budget(m);
  const saldo = inc + help - exp;
  const errs = live().filter(o => validate(o)).length;
  const over = bud.cats.filter(c => c.plan > 0 && c.fact > c.plan);
  const warns = [];
  if (errs) warns.push(['warn', `⚠ Операций с ошибками: ${errs} — открой «Историю», они не в итогах`, 'hist']);
  over.forEach(c => warns.push(['warn', `⚠ Перерасход: ${c.cat} — ${money(c.fact - c.plan)} сверх плана`, 'plan']));
  const now = balances();
  // Сверка: незакрытое расхождение (снимок на момент сверки, а не «живая» цифра) и напоминание раз в неделю
  openAccs().filter(a => a.reconPending).forEach(a => { const p = a.reconPending; warns.push(['warn', `⚠ ${a.name}: при сверке ${p.date.split('-').reverse().join('.')} в банке было ${fmt(p.bank, accCur(a))}, по учёту ${fmt(p.calc, accCur(a))} — «Ещё → Счета»: найди операцию или внеси корректировку`, 'acc:' + a.name]); });
  const toRecon = live().length ? openAccs().filter(a => !isMetal(accCur(a)) && !a.reconPending && accHasOps(a) && (!a.reconciledAt || dDiff(today(), a.reconciledAt) >= 7)) : [];
  if (toRecon.length) warns.push(['info', `🔎 Пора сверить с банком: ${toRecon.map(a => a.name).join(', ')} — «Ещё → Счета → Сверить» (раз в неделю)`, 'acc:' + toRecon[0].name]);
  void now;
  if (ps.free < 0) warns.push(['warn', `⚠ Карманы больше, чем денег, на ${money(-ps.free)} — «Бюджет → Карманы»`, 'pockets']);
  S.cfg.accounts.filter(a => !a.closed && depEnd(a) && dDiff(depEnd(a), today()) > 0 && dDiff(depEnd(a), today()) <= 30).forEach(a => warns.push(['info', a.autoRenew ? `🔄 Депозит «${a.name}» заканчивается ${depEnd(a).split('-').reverse().join('.')} и продлится автоматически — в этот день проверь новую ставку` : `🏦 Депозит «${a.name}» заканчивается ${depEnd(a).split('-').reverse().join('.')} — реши: продлить, переоформить или забрать`, 'acc:' + a.name]));
  if (allPayments().length) {
    const pf = payForecast(), soon = payCalendar(today(), dAdd(today(), 3)).filter(r => r.p.kind === 'out' && r.status !== 'paid');
    pf.overdue.forEach(r => warns.push(['warn', `⚠ Просрочен платёж «${r.p.name}» (${dHuman(r.due)}) — ${money(r.left)}`, 'pay']));
    soon.forEach(r => warns.push(['info', `📅 Скоро платёж «${r.p.name}»: ${dHuman(r.due)}, ${money(r.left)}`, 'pay']));
    if (!pf.enough) warns.push(['warn', `⚠ ${pf.next ? 'До «' + pf.next.p.name + '»' : 'За 30 дней'} платежей на ${money(pf.need)}, на счетах ${money(pf.cash)} — не хватает ${money(pf.need - pf.cash)}`, 'pay']);
  }
  const buf = ps.list.find(p => p.kind === 'buffer'), bufT = r2(0.1 * ps.planTotal);
  if (buf && bufT > 0 && buf.bal < bufT * 0.3) warns.push(buf.bal <= 0
    ? ['info', `ℹ Буфер пуст: нужно ${money(bufT)} (10% плана) — пополни при следующем поступлении`, 'pockets']
    : ['warn', `⚠ Буфер почти израсходован: осталось ${money(buf.bal)} из ${money(bufT)}`, 'pockets']);
  negPockets.forEach(p => warns.push(['warn', `⚠ Карман «${p.name}» в минусе на ${money(-p.bal)} — не хватило свободных денег, покрой его из других карманов`, 'pocket:' + p.name]));
  if (ps.free > 0 && ps.inPockets === 0 && live().length) warns.push(['info', `ℹ ${money(ps.free)} без назначения — разложи по карманам: «Бюджет → Карманы»`, 'dist']);
  if (missing.length) warns.push(['warn', `⚠ Нет курса для: ${missing.join(', ')} — эти счета не вошли в итоги. Обнови курсы: «Ещё → Валюты и курсы»`, 'cur']);
  if (goals().some(g => !g.archived)) {
    const gsum = goalsSummary(pocketState(mkey(today())));
    gsum.infos.filter(i => i.late).slice(0, 2).forEach(i => warns.push(['warn', `⚠ Срок цели «${i.g.name}» прошёл — осталось накопить ${money(i.rest)}. Поменяй срок или сумму в «Бюджет → Цели»`, 'goals']));
    gsum.infos.filter(i => !i.done && !i.late && i.g.deadline && !i.onTrack).slice(0, 2).forEach(i => warns.push(['info', `🎯 Цель «${i.g.name}» отстаёт: нужно ${money(i.need)}/мес${i.pace ? ', сейчас ' + money(i.pace) + '/мес' : ''}`, 'goals']));
    if (gsum.extra > 0) warns.push(['info', `🎯 Чтобы успеть ко всем целям, не хватает ${money(gsum.extra)} в месяц`, 'goals']);
  }
  if (!bud.plan) warns.push(['info', 'ℹ План на месяц пуст — задай «План в месяц» в разделе «Ещё → Категории»', 'cat']);
  const noStart = openAccs().filter(a => !startSaved(a));
  if (noStart.length) warns.push(['info', `ℹ Сохрани начальный остаток: ${noStart.map(a => a.name).join(', ')} — «Ещё → Счета»`, 'acc:' + noStart[0].name]);
  if (!warns.length) warns.push(['ok', '✓ Всё в порядке']);
  const topCats = bud.cats.filter(c => c.plan || c.fact).sort((a, b) => b.fact - a.fact);
  const people = S.cfg.people.map(p => ({ p: p.name, v: live().filter(o => o.person === p.name && mkey(o.date) === m && !validate(o) && TYPE[o.type].sign > 0).reduce((s, o) => s + opBase(o), 0) })).filter(x => x.v);
  $('#view').innerHTML = maturityHtml() + `
  <div class="cards">
    <div class="kpi blue"><div class="l">Всего денег</div><div class="v">${money(total)}</div><div class="s">на конец месяца</div></div>
    <div class="kpi lilac"><div class="l">Свободно</div><div class="v ${ps.free < 0 ? 'neg' : ''}">${money(ps.free)}</div><div class="s">не в карманах · в карманах ${money(ps.inPockets)}</div></div>
    <div class="kpi green"><div class="l">Накопления</div><div class="v">${money(sav)}</div><div class="s">${S.cfg.accounts.some(a => isMetal(accCur(a))) ? 'вкл. металлы' : '&nbsp;'}</div></div>
    <div class="kpi powder"><div class="l">Сальдо месяца</div><div class="v ${saldo < 0 ? 'neg' : ''}">${money(saldo)}</div><div class="s">пришло − потрачено · отложено ${inc + help ? pct(saldo / (inc + help)) : '–'}</div></div>
  </div>
  <h2>Месяц</h2>
  <div class="card">
    <div class="row"><span>Доходы (свои)</span><b class="pos">${money(inc)}</b></div>
    <div class="row"><span>Помощь</span><b>${money(help)}</b></div>
    <div class="row"><span>Расходы</span><b class="neg">${money(exp)}</b></div>
    ${debts().length || assets().length ? `<div class="row"><span>Чистый капитал <span class="sub">· Бюджет → Капитал</span></span><b>${money(capital().net)}</b></div>` : ''}
    <div class="row"><span class="sub">к прошлому месяцу</span><span class="sub">${prevExp ? (exp >= prevExp ? '+' : '') + pct(exp / prevExp - 1) + ' расходов' : '–'}</span></div>
  </div>
  <h2>Внимание</h2>${warns.map(([c, t, go]) => go ? `<div class="${c} go" role="button" tabindex="0" data-go="${esc(go)}">${esc(t)}<span class="goarr">›</span></div>` : `<div class="${c}">${esc(t)}</div>`).join('')}
  <h2>Бюджет по категориям</h2>
  <div class="card">${topCats.length ? topCats.map(catBar).join('') : '<div class="row muted">Пока нет плана и расходов</div>'}</div>
  ${overviewCharts(m)}
  <h2>Счета</h2>
  <div class="card">${S.cfg.accounts.filter(a => !a.closed || r2(b[a.name])).map(a => accRow(a, b[a.name])).join('')}</div>
  ${S.cfg.accounts.some(a => accCur(a) !== baseCur()) ? `<p class="muted">Счета в другой валюте и металлы пересчитаны в ${CUR[baseCur()].sym} по текущему курсу${Rates.data ? ' (' + esc(Rates.data.src) + ', ' + esc(Rates.data.date) + ')' : ''}.</p>` : ''}
  ${people.length ? `<h2>Деньги от людей</h2><div class="card">${people.map(x => `<div class="row"><span>${esc(x.p)}</span><b>${money(x.v)}</b></div>`).join('')}</div>` : ''}`;
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => goTo(el.dataset.go));
  bindOverviewCharts();
  bindMaturity();
  interestModal();
}
// ---------- Подтверждение процентов по депозиту ----------
// В день начисления (и если пропущено раньше) — окно «Подтвердите поступление процентов»: сумма по расчёту, можно поменять.
// Подтверждение = доход «Банк → Проценты по депозиту» на депозит (входит в доходы месяца, остаток депозита растёт).
function interestPending() {
  const t = today(), skip = S.cfg.intSkipped || [];
  return payCalendar(dAdd(t, -120), t).filter(r => r.p.toSavings && r.due <= t && r.status !== 'paid' && !(r.paid > 0) && !skip.includes(r.p.id + '|' + r.due));
}
function interestModal() {
  const old = $('#intModal'); if (old) old.remove();
  if (!['overview', 'today'].includes(S.tab)) return;
  try { if (sessionStorage.getItem('zhizn-int-later')) return; } catch (e) {}
  const list = interestPending(); if (!list.length) return;
  const r = list[0], a = accByName(r.p.account); if (!a) return;
  const c = accCur(a), est = interestMonthly(a, balances()[a.name]);
  const el = document.createElement('div'); el.id = 'intModal'; el.className = 'modal';
  el.innerHTML = `<div class="modal-box">
    <div style="font-size:34px">💰</div>
    <b style="font-size:17px">Подтвердите поступление процентов</b>
    <div class="muted" style="margin:6px 0">на депозит «${esc(a.name)}» за ${dHuman(r.due)}<br>Сумма рассчитана по ставке ${fmtPct(nominalRate(a))}. Если в банке пришло другое — поменяй.</div>
    <input class="amount" id="imAmt" inputmode="decimal" value="${String(est).replace('.', ',')}">
    <div class="muted">${esc(CUR[c] && !CUR[c].metal ? CUR[c].sym : c)}</div>
    <label class="f" style="text-align:left">Дата поступления</label><input class="in" type="date" id="imDate" value="${r.due}">
    ${list.length > 1 ? `<div class="muted" style="margin-top:6px">Ещё ждут подтверждения: ${list.length - 1}</div>` : ''}
    <div class="err" id="imErr"></div>
    <button class="btn" id="imOk">✓ Подтвердить поступление</button>
    <button class="btn light" id="imNo">Начисления не было</button>
    <button class="btn light" id="imLater">Позже</button></div>`;
  document.body.appendChild(el);
  $('#imOk').onclick = async () => {
    const amount = num($('#imAmt').value), date = $('#imDate').value || r.due;
    if (!(amount > 0)) { $('#imErr').textContent = '⚠ Укажи сумму (или нажми «Начисления не было»)'; return; }
    const now = Date.now(), op = { id: uid(), type: 'Доход', date, account: a.name, cat: 'Банк', sub: 'Проценты по депозиту', amount, person: '', to: '', comment: 'проценты по депозиту', rate: 0, amountTo: 0, payId: r.p.id, createdAt: now, updatedAt: now, device: DEVICE, deleted: false };
    const err = validate(op); if (err) { $('#imErr').textContent = '⚠ ' + err; return; }
    S.ops.push(op); await DB.put(op); Sync.soon();
    toast(`Проценты +${fmt(amount, c)} на «${a.name}» ✓ · учтены в доходах`); renderOverview();
  };
  $('#imNo').onclick = async () => { S.cfg.intSkipped = [...(S.cfg.intSkipped || []), r.p.id + '|' + r.due]; await saveCfg(); renderOverview(); };
  $('#imLater').onclick = () => { try { sessionStorage.setItem('zhizn-int-later', '1'); } catch (e) {} el.remove(); toast('Напомню при следующем открытии'); };
}
// ---------- Окончание срока депозита: «что делать со средствами?» ----------
const matSnoozed = a => { try { return localStorage.getItem('zhizn-mat-' + a.name) === today(); } catch (e) { return false; } };
const maturityDue = () => S.cfg.accounts.filter(a => !a.closed && a.savings && depEnd(a) && depEnd(a) <= today() && a.handledEnd !== depEnd(a) && !matSnoozed(a));
// Следующий срок при продлении: тот же срок от даты окончания (по дням, если срок задан датой по договору)
const nextEnd = a => { const end = depEnd(a); return termN(a) ? termFrom(a, end) : (a.openDate ? dAdd(end, dDiff(end, a.openDate)) : ''); };
function maturityHtml() {
  return maturityDue().map(a => {
    const end = depEnd(a), c = accCur(a), bal = balances()[a.name], ui = (S.matUI && S.matUI.acc === a.name) ? S.matUI.mode : '';
    const same = S.cfg.accounts.filter(x => !x.closed && x.name !== a.name && accCur(x) === c);
    const head = a.autoRenew
      ? `🔄 <b>Срок депозита «${esc(a.name)}» закончился ${end.split('-').reverse().join('.')}.</b> Банк продлевает его автоматически. Проверь новые условия: после продления ставка и дата окончания могут быть другими.`
      : `🏦 <b>Срок депозита «${esc(a.name)}» закончился ${end.split('-').reverse().join('.')}.</b> На нём ${fmt(bal, c)}. Что делать со средствами?`;
    const renewForm = `<div class="grid2"><div><label class="f">Новая дата окончания (как в банке)</label><input class="in" type="date" id="matEnd" value="${nextEnd(a)}"></div>
      <div><label class="f">Номинальная, %</label><input class="in" id="matRate" inputmode="decimal" value="${a.rate || ''}"></div></div>
      <label class="f">Эффективная (ГЭСВ), %</label><input class="in" id="matEff" inputmode="decimal" value="${a.rateEff || ''}">
      <button class="btn small" data-mat="renewOk|${esc(a.name)}">✓ ${a.autoRenew ? 'Подтвердить продление' : 'Продлить'}</button>`;
    const moveForm = same.length ? `<div class="grid2"><div><label class="f">На счёт</label><select class="in" id="matTo">${same.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select></div>
      <div><label class="f">Сумма</label><input class="in" id="matAmt" inputmode="decimal" value="${r2(bal)}"></div></div>
      <button class="btn small" data-mat="moveOk|${esc(a.name)}">Перевести</button>` : `<div class="muted">Нет другого счёта в этой валюте — добавь его в «Ещё → Счета».</div>`;
    return `<div class="card" style="padding:10px 12px;border:2px solid var(--lilac2)">${head}
      <div class="seg" style="margin-top:8px">
        <button class="chip ${ui === 'renew' ? 'on' : ''}" data-mat="renew|${esc(a.name)}">${a.autoRenew ? '✓ Продлён — подтвердить' : '🔄 Продлить'}</button>
        <button class="chip ${ui === 'move' ? 'on' : ''}" data-mat="move|${esc(a.name)}">💳 Перевести на счёт</button>
        <button class="chip" data-mat="close|${esc(a.name)}">🔒 Закрыть депозит</button>
        ${a.autoRenew ? '' : `<button class="chip" data-mat="open|${esc(a.name)}">Оставить без срока</button>`}
        <button class="chip" data-mat="later|${esc(a.name)}">Позже</button></div>
      ${ui === 'renew' ? renewForm : ui === 'move' ? moveForm : ''}</div>`;
  }).join('');
}
function bindMaturity() {
  document.querySelectorAll('[data-mat]').forEach(btn => btn.onclick = async () => {
    const [act, name] = btn.dataset.mat.split('|'), a = S.cfg.accounts.find(x => x.name === name); if (!a) return;
    const end = depEnd(a);
    if (act === 'renew' || act === 'move') { S.matUI = { acc: name, mode: act }; return renderOverview(); }
    if (act === 'close') { S.closeAcc = name; S.matUI = null; setTab('more'); setTimeout(() => { const el = document.querySelector('#clInt'); if (el) el.scrollIntoView({ block: 'center' }); }, 80); return; }
    if (act === 'later') { try { localStorage.setItem('zhizn-mat-' + name, today()); } catch (e) {} S.matUI = null; toast('Напомню завтра'); return renderOverview(); }
    if (act === 'open') { a.termN = null; delete a.termMonths; a.endDate = ''; a.handledEnd = end; await saveCfg(); S.matUI = null; toast('Депозит без срока'); return renderOverview(); }
    if (act === 'renewOk') {
      const ne = $('#matEnd').value; if (!ne || ne <= end) { toast('⚠ Новая дата окончания должна быть позже ' + end.split('-').reverse().join('.')); return; }
      const nr = $('#matRate').value.trim(), ef = $('#matEff').value.trim();
      a.openDate = end; a.endDate = ne; a.handledEnd = end;
      a.rate = nr ? num(nr) : a.rate; a.rateEff = ef ? num(ef) : a.rateEff;
      await saveCfg(); S.matUI = null; toast('Депозит продлён до ' + ne.split('-').reverse().join('.')); return renderOverview();
    }
    if (act === 'moveOk') {
      const to = $('#matTo').value, amount = num($('#matAmt').value); if (!(amount > 0)) { toast('⚠ Укажи сумму'); return; }
      const now = Date.now(), op = { id: uid(), type: 'Перевод между счетами', date: today(), account: name, to, amount, cat: '', sub: '', person: '', comment: 'окончание депозита', rate: 0, amountTo: 0, createdAt: now, updatedAt: now, device: DEVICE, deleted: false };
      const err = validate(op); if (err) { toast('⚠ ' + err); return; }
      S.ops.push(op); await DB.put(op); a.handledEnd = end; await saveCfg(); S.matUI = null; toast(`Переведено ${fmt(amount, accCur(a))} → ${to}`); return renderOverview();
    }
  });
}
// Строка счёта: остаток в его валюте, для чужой валюты — «≈ в основной»
function accRow(a, v) {
  const c = accCur(a), r = Rates.get(c);
  const eq = c !== baseCur() ? `<div class="sub" style="text-align:right">${r ? '≈ ' + money(v * r) : 'нет курса'}</div>` : '';
  // строка про проценты — отдельной строкой во всю ширину, с переносом (иначе растягивает экран телефона)
  const dep = nominalRate(a) > 0 && a.savings ? `<div class="sub pos" style="margin-top:2px">≈ +${fmt(interestMonthly(a, v), c)}/мес · ${fmtPct(nominalRate(a))}${effectiveRate(a) ? ' (эфф. ' + fmtPct(effectiveRate(a)) + ')' : ''}${depEnd(a) ? ' · до ' + depEnd(a).split('-').reverse().join('.') : ''}</div>` : '';
  return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><span style="min-width:0">${esc(a.name)}${a.savings || isMetal(c) ? ' <span class="sub">· накопления</span>' : ''}</span><div style="text-align:right;white-space:nowrap"><b class="${v < 0 ? 'neg' : ''}">${fmt(v, c)}</b>${eq}</div></div>${dep}</div>`;
}
function catBar(c) {
  const r = c.plan ? c.fact / c.plan : (c.fact ? 2 : 0);
  const cls = r > 1 ? 'over' : r > .8 ? 'warn' : '';
  const left = c.plan - c.fact;
  return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span class="t">${esc(c.cat)}</span><span>${money(c.fact)} <span class="sub">из ${money(c.plan)}</span></span></div>
  <div class="bar ${cls}"><i style="width:${Math.min(100, r * 100)}%"></i></div>
  <div class="sub ${left < 0 ? 'neg' : ''}">${c.plan ? (left >= 0 ? 'осталось ' + money(left) : 'перерасход ' + money(-left)) : 'без плана'}</div></div>`;
}

// ---------- История ----------
function renderHistory() {
  const f = S.hf || (S.hf = { per: 'month', from: '', to: '', type: '', cat: '', acc: '', person: '' });
  const q = S.q.toLowerCase();
  const inPer = o => f.per === 'all' ? true : f.per === 'range' ? (!f.from || o.date >= f.from) && (!f.to || o.date <= f.to) : mkey(o.date) === S.month;
  const list = live().filter(o => !isPocketOp(o) && inPer(o) && (!f.type || o.type === f.type) && (!f.cat || o.cat === f.cat) && (!f.acc || o.account === f.acc || o.to === f.acc) && (!f.person || o.person === f.person))
    .filter(o => !q || [o.type, o.cat, o.sub, o.person, o.comment, o.account, String(o.amount)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const nF = ['type', 'cat', 'acc', 'person'].filter(k => f[k]).length + (f.per !== 'month' ? 1 : 0);
  let inS = 0, outS = 0;
  for (const o of list) { const T = TYPE[o.type]; if (validate(o) || !T || T.to) continue; if (T.sign > 0) inS += opBase(o); else outS += opBase(o); }
  const cats = [...new Set([...S.cfg.exp.map(c => c.cat), ...S.cfg.inc.map(c => c.cat)])];
  const sel = (k, opts) => `<select class="in" data-hf="${k}"><option value="">Все</option>${opts.map(v => `<option ${v === f[k] ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  let html = `<input class="in search" id="q" placeholder="Поиск: категория, где/что, сумма…" value="${esc(S.q)}">
  <details class="card" id="hfBox" ${S.hfOpen ? 'open' : ''} style="padding:4px 12px"><summary style="font-weight:600">⚙ Фильтры${nF ? ` <span class="sub">(${nF})</span>` : ''}</summary>
    <div class="seg">${[['month', 'Месяц'], ['range', 'Свои даты'], ['all', 'Всё время']].map(([k, l]) => `<button class="chip ${f.per === k ? 'on' : ''}" data-hper="${k}">${l}</button>`).join('')}</div>
    ${f.per === 'month' ? '<div class="muted" style="margin-top:4px">Месяц — стрелками вверху</div>' : ''}
    ${f.per === 'range' ? `<div class="grid2"><div><label class="f">С</label><input class="in" type="date" id="hfFrom" value="${f.from}"></div><div><label class="f">По</label><input class="in" type="date" id="hfTo" value="${f.to}"></div></div>` : ''}
    <div class="grid2"><div><label class="f">Тип</label>${sel('type', TYPES.map(x => x.t))}</div><div><label class="f">Категория</label>${sel('cat', cats)}</div></div>
    <div class="grid2"><div><label class="f">Счёт</label>${sel('acc', S.cfg.accounts.map(a => a.name))}</div><div><label class="f">Человек</label>${sel('person', S.cfg.people.map(p => p.name))}</div></div>
    ${nF ? '<button class="btn small light" id="hfReset" style="margin-bottom:8px">Сбросить фильтры</button>' : '<div style="height:8px"></div>'}
  </details>
  <div class="hsum">Найдено: <b>${list.length}</b> · пришло <b class="pos">+${money(inS)}</b> · ушло <b class="neg">−${money(outS)}</b><div class="sub">без переводов между своими счетами и ошибочных операций</div></div>`;
  let day = '';
  if (!list.length) html += `<div class="card"><div class="row muted">${nF || q ? 'Ничего не найдено — поменяй фильтры или поиск.' : 'В этом месяце операций нет. Нажми «+».'}</div></div>`;
  for (const o of list) {
    if (o.date !== day) { if (day) html += '</div>'; day = o.date; const d = new Date(o.date + 'T00:00'); html += `<div class="day">${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', ...(f.per !== 'month' ? { year: 'numeric' } : {}) })}</div><div class="card">`; }
    const T = TYPE[o.type], err = validate(o);
    const sign = !T ? '' : T.to ? '⇄ ' : T.sign > 0 ? '+' : '−';
    const what = T && T.grp ? `${o.cat} · ${o.sub}` : (o.person || (T && T.to ? `${o.account} → ${o.to}` : o.type));
    const c = curOf(o.account);
    const amt = T && T.fx ? `−${fmt(o.amount, c)}<br>+${fmt(o.amountTo, curOf(o.to))}` : sign + fmt(o.amount, c);
    const eq = T && !T.to && c !== baseCur() ? `<div class="sub">≈ ${money(opBase(o))}</div>` : '';
    html += `<div class="row" data-id="${o.id}" style="cursor:pointer"><div style="flex:1;min-width:0"><div class="t">${esc(what)}</div><div class="sub">${esc(o.type)} · ${esc(o.account)}${o.comment ? ' · ' + esc(o.comment) : ''}${err ? ' · <span class="neg">⚠ ' + esc(err) + '</span>' : ''}</div></div><div style="text-align:right;white-space:nowrap"><b class="${T && !T.to ? (T.sign > 0 ? 'pos' : 'neg') : ''}">${amt}</b>${eq}</div></div>`;
  }
  if (day) html += '</div>';
  $('#view').innerHTML = html;
  $('#q').addEventListener('input', e => { S.q = e.target.value; const p = e.target.selectionStart; renderHistory(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); });
  $('#hfBox').addEventListener('toggle', e => { S.hfOpen = e.target.open; });
  document.querySelectorAll('[data-hper]').forEach(b => b.onclick = () => { f.per = b.dataset.hper; if (f.per === 'range' && !f.from) { f.from = S.month + '-01'; f.to = today(); } render(); });
  document.querySelectorAll('[data-hf]').forEach(el => el.onchange = () => { f[el.dataset.hf] = el.value; renderHistory(); });
  if ($('#hfFrom')) { $('#hfFrom').onchange = e => { f.from = e.target.value; renderHistory(); }; $('#hfTo').onchange = e => { f.to = e.target.value; renderHistory(); }; }
  if ($('#hfReset')) $('#hfReset').onclick = () => { S.hf = null; render(); };
  document.querySelectorAll('[data-id]').forEach(r => r.addEventListener('click', () => { const o = S.ops.find(x => x.id === r.dataset.id); S.edit = o.id; S.draft = { ...o }; S.autoHint = ''; setTab('add'); }));
}

// ---------- Новая операция / правка ----------
function newDraft() { const open = openAccs(); return { type: 'Расход', date: today(), account: (open.some(a => a.name === lastAcc.get()) ? lastAcc.get() : (open[0] || S.cfg.accounts[0]).name), cat: '', sub: '', amount: '', amountTo: '', rate: '', person: '', to: '', comment: '' }; }
function renderAdd() {
  if (!S.draft) S.draft = newDraft();
  const d = S.draft, T = TYPE[d.type];
  const cats = T.grp === 'exp' ? S.cfg.exp.map(c => c.cat) : T.grp === 'inc' ? S.cfg.inc.map(c => c.cat) : [];
  const subs = T.grp === 'exp' ? ((S.cfg.exp.find(c => c.cat === d.cat) || {}).subs || []).map(s => s.name) : T.grp === 'inc' ? ((S.cfg.inc.find(c => c.cat === d.cat) || {}).subs || []) : [];
  const freq = {}; live().forEach(o => { if (o.type === d.type && o.cat) freq[o.cat] = (freq[o.cat] || 0) + 1; });
  cats.sort((a, b) => (freq[b] || 0) - (freq[a] || 0));
  const accOpts = S.cfg.accounts.filter(a => !a.closed || a.name === d.account).map(a => `<option value="${esc(a.name)}" ${a.name === d.account ? 'selected' : ''}>${esc(a.name)}${accCur(a) !== baseCur() ? ' · ' + accCur(a) : ''}</option>`).join('');
  const cFrom = curOf(d.account), cTo = d.to ? curOf(d.to) : '';
  const symFrom = (CUR[cFrom] || {}).sym || cFrom;
  // Курс для операции в чужой валюте: сохранённый в операции → ручной/автоматический
  if (!T.to && cFrom !== baseCur() && !d.rate) d.rate = Rates.get(cFrom) ? String(+Rates.get(cFrom).toFixed(4)) : '';
  const rateRow = !T.to && cFrom !== baseCur() ? `<label class="f">Курс: 1 ${isMetal(cFrom) ? 'г' : esc(symFrom)} = ? ${esc(CUR[baseCur()].sym)} <span class="muted">(можно поправить)</span></label><input class="in" id="rate" inputmode="decimal" value="${esc(d.rate)}" placeholder="курс">` : '';
  const fxRow = T.fx ? `<label class="f">Получила на счёт «${esc(d.to || '…')}»${cTo ? ' (' + esc((CUR[cTo] || {}).sym || cTo) + ')' : ''}</label><input class="in" id="amountTo" inputmode="decimal" value="${esc(d.amountTo)}" placeholder="сколько получила">
    <div class="muted" id="fxRate" style="margin-top:4px"></div>` : '';
  $('#view').innerHTML = `
  <h2>${S.edit ? 'Правка операции' : 'Новая операция'}</h2>
  ${S.edit ? '' : quickRow()}
  <div class="seg">${TYPES.slice(0, 4).map(x => `<button class="chip ${x.t === d.type ? 'on' : ''}" data-type="${x.t}">${x.t === 'Перевод между счетами' ? 'Перевод' : x.t}</button>`).join('')}
    <select class="chip" id="moreType" style="padding:6px 10px"><option value="">Ещё…</option>${TYPES.slice(4).map(x => `<option ${x.t === d.type ? 'selected' : ''}>${x.t}</option>`).join('')}</select></div>
  <div class="muted" style="margin-top:6px">${esc(T.hint)}</div>
  <input class="amount" id="amount" inputmode="decimal" placeholder="0 ${esc(isMetal(cFrom) ? 'г' : symFrom)}" value="${d.amount}">
  <label class="f">Где или что <span class="muted">(необязательно — по нему приложение само подберёт категорию)</span></label>
  <input class="in" id="comment" list="cmtList" autocomplete="off" value="${esc(d.comment)}" placeholder="Магнум, кофе, такси…"><datalist id="cmtList">${commentList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
  ${S.autoHint ? `<div class="muted" style="margin-top:4px">✨ ${esc(S.autoHint)}</div>` : ''}
  ${cats.length ? `<label class="f">Категория</label><div class="tiles">${cats.map(c => `<div class="tile ${c === d.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</div>`).join('')}</div>` : ''}
  ${subs.length ? `<label class="f">Подкатегория</label><div class="seg">${subs.map(s => `<button class="chip ${s === d.sub ? 'on' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
  ${T.person ? `<label class="f">Человек</label><div class="seg">${S.cfg.people.map(p => `<button class="chip ${p.name === d.person ? 'on' : ''}" data-person="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
  ${payLinkRow(d)}
  ${debtLinkRow(d)}
  <div class="grid2"><div><label class="f">${T.to ? 'Со счёта' : 'Счёт'}</label><select class="in" id="account">${accOpts}</select></div>
    <div><label class="f">Дата</label><input class="in" type="date" id="date" value="${d.date}"></div></div>
  ${T.to ? `<label class="f">На счёт</label><select class="in" id="to"><option value="">—</option>${S.cfg.accounts.filter(a => !a.closed || a.name === d.to).map(a => `<option value="${esc(a.name)}" ${a.name === d.to ? 'selected' : ''}>${esc(a.name)}${accCur(a) !== baseCur() ? ' · ' + accCur(a) : ''}</option>`).join('')}</select>` : ''}
  ${fxRow}${rateRow}
  ${S.edit ? '' : `<label class="f" style="font-size:13px;color:var(--ink)"><input type="checkbox" id="favAdd" ${d.fav ? 'checked' : ''}> ⭐ Добавить в избранное — потом вводится в одно касание</label>`}
  <div class="err" id="err"></div>
  <button class="btn" id="save">${S.edit ? 'Сохранить изменения' : 'Сохранить'}</button>
  ${S.edit ? '<button class="btn light" id="repeat">↺ Повторить сегодня (новая операция)</button><button class="btn danger" id="del">Удалить операцию</button>' : ''}
  <button class="btn light" id="cancel">Отмена</button>`;
  const sync = () => { d.amount = $('#amount').value; d.account = $('#account').value; d.date = $('#date').value; d.comment = $('#comment').value; if ($('#to')) d.to = $('#to').value; if ($('#amountTo')) d.amountTo = $('#amountTo').value; if ($('#rate')) d.rate = $('#rate').value; };
  // Смена счёта меняет валюту → перерисовать (значок, курс, поле «получила»)
  $('#account').onchange = () => { sync(); d.rate = ''; renderAdd(); };
  if ($('#to')) $('#to').onchange = () => { sync(); renderAdd(); };
  $('#comment').onchange = () => { sync(); const h = autoFill(d); if (h) { S.autoHint = h; renderAdd(); } };
  if ($('#favAdd')) $('#favAdd').onchange = e => { d.fav = e.target.checked; };
  document.querySelectorAll('[data-qfav]').forEach(b => b.onclick = () => { const f = (S.cfg.favs || []).find(x => x.id === b.dataset.qfav); if (!f) return; S.draft = fillFrom(f, true); S.autoHint = ''; renderAdd(); });
  document.querySelectorAll('[data-qrec]').forEach(b => b.onclick = () => { const o = S.ops.find(x => x.id === b.dataset.qrec); if (!o) return; S.draft = fillFrom(o, true); S.autoHint = ''; renderAdd(); });
  if ($('#repeat')) $('#repeat').onclick = () => { sync(); S.draft = fillFrom(d, true); S.edit = null; S.autoHint = ''; toast('Новая операция на сегодня — проверь и сохрани'); renderAdd(); };
  const showFx = () => { const el = $('#fxRate'); if (!el) return; const a = num($('#amount').value), b2 = num($('#amountTo').value);
    if (a > 0 && b2 > 0 && cTo) { const c1 = isMetal(cFrom) ? 'г' : symFrom, c2 = isMetal(cTo) ? 'г' : (CUR[cTo] || {}).sym; const rr = x => (+x.toFixed(x < 10 ? 4 : 2)).toLocaleString('ru-RU'); el.textContent = b2 >= a ? `Курс: 1 ${c1} = ${rr(b2 / a)} ${c2}` : `Курс: 1 ${c2} = ${rr(a / b2)} ${c1}`; } else el.textContent = ''; };
  if ($('#amountTo')) { $('#amountTo').oninput = showFx; $('#amount').oninput = showFx; showFx(); }
  document.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { sync(); d.type = b.dataset.type; d.cat = ''; d.sub = ''; renderAdd(); });
  $('#moreType').onchange = e => { if (!e.target.value) return; sync(); d.type = e.target.value; d.cat = ''; d.sub = ''; renderAdd(); };
  document.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { sync(); d.cat = b.dataset.cat; d.sub = ''; renderAdd(); });
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { sync(); d.sub = b.dataset.sub; renderAdd(); });
  document.querySelectorAll('[data-person]').forEach(b => b.onclick = () => { sync(); d.person = b.dataset.person; renderAdd(); });
  document.querySelectorAll('[data-debtlink]').forEach(b => b.onclick = () => { sync(); d.debtId = b.dataset.debtlink; const x = debts().find(y => y.id === d.debtId); if (x && x.person) d.person = x.person; renderAdd(); });
  document.querySelectorAll('[data-paylink]').forEach(b => b.onclick = () => { sync(); d.payId = b.dataset.paylink; renderAdd(); });
  $('#cancel').onclick = () => { const back = S.edit ? 'history' : (S.backTab || 'overview'); S.draft = null; S.edit = null; S.autoHint = ''; S.backTab = null; setTab(back); };
  $('#save').onclick = async () => {
    sync();
    const T2 = TYPE[d.type];
    const op = { ...d, amount: num(d.amount) }; const wantFav = !S.edit && d.fav; delete op.fav;
    op.comment = (op.comment || '').trim();
    if (!T2.grp) { op.cat = ''; op.sub = ''; } if (!T2.person) op.person = ''; if (!T2.to) op.to = '';
    op.amountTo = T2.fx ? num(d.amountTo) : 0;
    // Курс к основной валюте запоминаем в операции (траты/доходы в чужой валюте не «плывут» при смене курса)
    const c0 = curOf(op.account);
    if (!T2.to && c0 !== baseCur()) { const rv = parseFloat(String(d.rate).replace(/\s/g, '').replace(',', '.')); if (!(rv > 0)) { $('#err').textContent = '⚠ Укажи курс (нет интернета — впиши вручную)'; return; } op.rate = rv; }
    else op.rate = 0;
    const err = validate(op); if (err) { $('#err').textContent = '⚠ ' + err; return; }
    const rule = depositRuleWarn(op); if (rule && !confirm(rule + '\n\nВсё равно сохранить?')) return;
    const now = Date.now();
    // Новый заём без выбранного долга — долг заводится сам (чтобы он сразу был виден в «Капитал»)
    if (!S.edit && (op.type === 'Заём выдан' || op.type === 'Заём получен') && !op.debtId) {
      const lentKind = op.type === 'Заём выдан', id = uid().slice(0, 8);
      S.cfg.debts = [...(S.cfg.debts || []), { id, kind: lentKind ? 'lent' : 'loan', name: (lentKind ? 'Должен(на) мне: ' : 'Я должна: ') + op.person + ' (' + op.date.split('-').reverse().join('.') + ')', person: op.person, balance: 0, balanceDate: op.date, balanceSetAt: now - 1, monthly: 0, day: null, rate: 0, account: op.account }];
      op.debtId = id; await saveCfg();
    }
    if (S.edit) { Object.assign(op, { id: S.edit, updatedAt: now, device: DEVICE }); const i = S.ops.findIndex(x => x.id === S.edit); op.createdAt = S.ops[i].createdAt; S.ops[i] = op; }
    else { Object.assign(op, { id: uid(), createdAt: now, updatedAt: now, device: DEVICE, deleted: false }); S.ops.push(op); }
    await DB.put(op);
    if (wantFav) { const f = { id: uid().slice(0, 8), type: op.type, cat: op.cat, sub: op.sub, person: op.person, account: op.account, to: op.to, comment: op.comment, amount: op.amount };
      if (!(S.cfg.favs || []).some(x => quickKey(x) === quickKey(f))) { S.cfg.favs = [...(S.cfg.favs || []), f]; await saveCfg(); } }
    S.autoHint = '';
    lastAcc.set(op.account); Sync.soon();
    S.month = mkey(op.date);
    toast(afterSaveText(op));
    S.draft = null; const wasEdit = !!S.edit; S.edit = null;
    // Пришли деньги → сразу предложить разложить их по карманам
    if (!wasEdit && (op.type === 'Доход' || op.type === 'Помощь') && suggestDistribution(S.month).items.length) { S.btab = 'pockets'; S.dist = true; setTab('budget'); return; }
    const back = S.backTab; S.backTab = null; setTab(wasEdit ? 'history' : (back || 'overview'));
  };
  if ($('#del')) $('#del').onclick = async () => {
    if (!confirm('Удалить эту операцию? Её можно будет восстановить только из резервной копии.')) return;
    const i = S.ops.findIndex(x => x.id === S.edit); S.ops[i] = { ...S.ops[i], deleted: true, updatedAt: Date.now(), device: DEVICE }; await DB.put(S.ops[i]); Sync.soon();
    toast('Операция удалена'); S.draft = null; S.edit = null; setTab('history');
  };
  if (!S.edit) setTimeout(() => $('#amount').focus(), 50);
}
// ---------- Быстрый ввод: избранное, недавние, категория по «где/что» ----------
const quickKey = o => [o.type, o.cat || '', o.sub || '', o.person || '', (o.comment || '').trim().toLowerCase()].join('|');
const qLabel = o => (o.comment && o.comment.trim()) || o.sub || o.person || o.type;
function quickRow() {
  const favs = S.cfg.favs || [], fk = new Set(favs.map(quickKey)), seen = new Set(), rec = [];
  for (const o of live().filter(o => !isPocketOp(o) && ['Расход', 'Доход', 'Помощь'].includes(o.type) && !validate(o)).sort((a, b) => b.createdAt - a.createdAt)) {
    const k = quickKey(o); if (fk.has(k) || seen.has(k)) continue; seen.add(k); rec.push(o); if (rec.length >= 4) break;
  }
  if (!favs.length && !rec.length) return '';
  return `<div class="quick">${favs.map(f => `<button class="chip" data-qfav="${f.id}">⭐ ${esc(qLabel(f))}${f.amount ? ' · ' + fmt(f.amount, curOf(f.account)) : ''}</button>`).join('')}${rec.map(o => `<button class="chip" data-qrec="${o.id}">↺ ${esc(qLabel(o))} · ${fmt(o.amount, curOf(o.account))}</button>`).join('')}</div>
  <div class="muted" style="margin:2px 0 8px">⭐ избранное · ↺ недавние — нажми, форма заполнится сама</div>`;
}
function fillFrom(src, withAmount) {
  const d = newDraft();
  for (const k of ['type', 'cat', 'sub', 'person', 'comment', 'to']) if (src[k]) d[k] = src[k];
  if (src.account && openAccs().some(a => a.name === src.account)) d.account = src.account;
  if (withAmount && src.amount) d.amount = String(src.amount);
  return d;
}
// Подсказки для поля «Где или что»: свои прошлые записи, сначала недавние
function commentList() {
  const seen = new Set(), out = [];
  for (const o of live().filter(o => o.comment && !isPocketOp(o)).sort((a, b) => b.createdAt - a.createdAt)) { const k = o.comment.trim().toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(o.comment.trim()); } if (out.length >= 60) break; }
  return out;
}
// Категорию (и человека) подставляем из последней операции того же типа с тем же «где/что»
function autoFill(d) {
  const key = (d.comment || '').trim().toLowerCase(); if (!key) return '';
  const T = TYPE[d.type];
  const prev = live().filter(o => !isPocketOp(o) && o.type === d.type && (o.comment || '').trim().toLowerCase() === key && !validate(o)).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!prev) return '';
  const parts = [];
  if (T.grp && !d.cat && prev.cat) { d.cat = prev.cat; d.sub = prev.sub; parts.push(prev.cat + ' · ' + prev.sub); }
  if (T.person && !d.person && prev.person) { d.person = prev.person; parts.push(prev.person); }
  return parts.length ? `Подобрала по «${d.comment.trim()}»: ${parts.join(', ')}` : '';
}
// «Это оплата: …» — если у операции подходящие регулярные платежи
function payLinkRow(d) {
  const kind = d.type === 'Расход' ? 'out' : (d.type === 'Доход' || d.type === 'Помощь') ? 'in' : '';
  if (!kind) return '';
  const fit = allPayments().filter(p => p.active !== false && p.kind === kind && (p.id === d.payId ||
    (d.type === 'Помощь' ? p.person && p.person === d.person : !p.person && p.cat === d.cat && p.sub === d.sub && d.sub)));
  if (!fit.length) return '';
  return `<label class="f">Это оплата регулярного платежа?</label><div class="seg">${fit.map(p => `<button class="chip ${d.payId === p.id ? 'on' : ''}" data-paylink="${p.id}">📅 ${esc(p.name)}</button>`).join('')}<button class="chip ${!d.payId ? 'on' : ''}" data-paylink="">Нет</button></div>`;
}
function afterSaveText(o) {
  const T = TYPE[o.type], b = balances(), c = curOf(o.account);
  const bal = fmt(b[o.account], c);
  if (o.type === 'Расход') {
    const m = mkey(o.date), cc = budget(m).cats.find(x => x.cat === o.cat);
    const tail = cc && cc.plan ? (cc.plan - cc.fact >= 0 ? `${o.cat}: осталось ${money(cc.plan - cc.fact)} из ${money(cc.plan)}` : `${o.cat}: перерасход ${money(cc.fact - cc.plan)}`) : `${o.cat}: без плана`;
    return `${o.sub} −${fmt(o.amount, c)} · ${tail} · ${o.account}: ${bal}`;
  }
  if (T.fx) return `Обмен: −${fmt(o.amount, c)} → +${fmt(o.amountTo, curOf(o.to))} · ${o.to}: ${fmt(b[o.to], curOf(o.to))}`;
  if (T.to) return `Перевод ${fmt(o.amount, c)}: ${o.account} → ${o.to}`;
  return `${o.type} ${T.sign > 0 ? '+' : '−'}${fmt(o.amount, c)} · ${o.account}: ${bal}`;
}

// ---------- Бюджет: карманы и план/факт ----------
const budgetSeg = () => `<div class="seg" style="margin-bottom:10px">${[['pockets', '💼 Карманы'], ['goals', '🎯 Цели'], ['pay', '📅 Платежи'], ['capital', '🏛 Капитал'], ['plan', '▤ План и факт']].map(([k, l]) => `<button class="chip ${(S.btab || 'pockets') === k ? 'on' : ''}" data-btab="${k}">${l}</button>`).join('')}</div>`;
function bindBudgetSeg() { document.querySelectorAll('[data-btab]').forEach(b => b.onclick = () => { S.btab = b.dataset.btab; S.dist = false; renderBudget(); }); }
function renderBudget() { const b = S.btab || 'pockets'; if (b === 'pockets') return renderPockets(); if (b === 'pay') return renderPayments(); if (b === 'capital') return renderCapital(); if (b === 'goals') return renderGoals(); return renderPlanFact(); }
function renderPayments() {
  const t = today(), f = payForecast();
  const cal = payCalendar(dAdd(t, -45), dAdd(t, 45));
  const shown = cal.filter(r => r.due >= dAdd(t, -45) && (r.status !== 'paid' || r.due >= dAdd(t, -10)));
  const ed = S.payEdit, p0 = ed ? (payments().find(p => p.id === ed) || {}) : null;
  const accOpts = sel => openAccs().map(a => `<option value="${esc(a.name)}" ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  $('#view').innerHTML = budgetSeg() + `
  <div class="cards">
    <div class="kpi powder"><div class="l">Платежи за 7 дней</div><div class="v">${money(f.out7)}</div><div class="s">ещё не оплачено</div></div>
    <div class="kpi lilac"><div class="l">За 30 дней</div><div class="v">${money(f.out30)}</div><div class="s">поступит ${money(f.in30)}</div></div>
  </div>
  <div class="${f.enough ? 'ok' : 'warn'}">${f.next
    ? `${f.enough ? '✓' : '⚠'} До «${esc(f.next.p.name)}» (${dHuman(f.next.due)}) платежей на ${money(f.need)}; на обычных счетах ${money(f.cash)} — ${f.enough ? 'хватит' : 'не хватит ' + money(f.need - f.cash)}.`
    : `${f.enough ? '✓' : '⚠'} За 30 дней платежей на ${money(f.need)}; на обычных счетах ${money(f.cash)}${f.enough ? ' — хватит' : ' — не хватит ' + money(f.need - f.cash)}. Добавь регулярные поступления (стипендию), чтобы видеть прогноз «до поступления».`}</div>
  ${f.overdue.length ? `<div class="warn">⚠ Просрочено: ${f.overdue.map(r => esc(r.p.name) + ' (' + dHuman(r.due) + ')').join(', ')}</div>` : ''}
  <h2>Календарь</h2>
  <div class="card">${shown.length ? shown.map(r => `<div class="row"><div style="flex:1;min-width:0"><div class="t">${PAY_ST[r.status][0]} ${esc(r.p.name)}</div><div class="sub">${dHuman(r.due)} · ${r.p.kind === 'in' && r.status === 'overdue' ? 'не пришло' : r.p.kind === 'in' && r.status === 'paid' ? 'пришло' : PAY_ST[r.status][1]}${r.status === 'partial' ? ' · осталось ' + money(r.left) : ''}${r.p.kind === 'in' ? ' · поступление' : ''}</div></div>
    <div style="text-align:right;white-space:nowrap"><b class="${r.p.kind === 'in' ? 'pos' : ''}">${r.p.kind === 'in' ? '+' : '−'}${money(r.p.amount)}</b>${r.status !== 'paid' && r.status !== 'skipped' ? `<br><button class="btn small light" data-paynow="${r.p.id}|${r.due}" style="margin:4px 0 0;padding:4px 10px">${r.p.kind === 'in' ? 'Пришло' : 'Оплатить'}</button>` : ''}</div></div>`).join('')
    : '<div class="row muted">Платежей пока нет. Добавь первый ниже — например, абонемент в зал, связь, рассрочку или стипендию.</div>'}</div>
  <h2>${ed ? 'Правка платежа' : 'Новый платёж'}</h2>
  <div class="card" style="padding:10px 12px">${payForm(p0, accOpts)}</div>
  ${payments().length ? `<h2>Все платежи</h2><div class="card">${payments().map(p => `<div class="row"><div style="flex:1;min-width:0"><div class="t">${p.active === false ? '⏸ ' : ''}${esc(p.name)}</div><div class="sub">${p.kind === 'in' ? 'поступление' : 'платёж'} · ${esc(FREQS[p.freq] + (p.freq === 'months' ? ' (' + p.n + ')' : ''))} · ${p.freq === 'week' ? 'с ' + p.start.split('-').reverse().join('.') : p.freq === 'year' ? p.day + '.' + String(p.month).padStart(2, '0') : p.day + '-го'}${p.end ? ' · до ' + p.end.split('-').reverse().join('.') : ''}</div></div>
    <div style="white-space:nowrap"><b>${money(p.amount)}</b> <button class="btn small light" data-payedit="${p.id}" style="margin:0;padding:4px 8px">✎</button></div></div>`).join('')}</div>` : ''}
  <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как работают платежи?</summary><div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0"><b>Настраиваешь один раз</b>: «Зал — 15 000 ₸ каждый месяц 15-го». Приложение само считает следующие даты.</p>
    <p style="margin:4px 0"><b>Оплата распознаётся сама</b>: если в этом месяце есть расход той же категории и подкатегории — платёж ✅. Меньше суммы — ◐ частично. Не оплачен после даты — ⚠ просрочено.</p>
    <p style="margin:4px 0">Если у двух платежей одна подкатегория, при вводе операции выбери «Это оплата: …» — так приложение не перепутает.</p>
    <p style="margin:4px 0"><b>Поступления</b> (стипендия, зарплата, помощь) тоже можно добавить — тогда виден прогноз «хватит ли денег до следующего поступления».</p>
    <p style="margin:4px 0"><b>Рассрочка</b> — платёж «каждый месяц» с датой окончания.</p>
  </div></details>`;
  bindBudgetSeg(); bindPayForm(p0);
  document.querySelectorAll('[data-payedit]').forEach(b => b.onclick = () => { S.payEdit = b.dataset.payedit; renderPayments(); setTimeout(() => $('#pfName') && $('#pfName').scrollIntoView({ block: 'center' }), 50); });
  document.querySelectorAll('[data-paynow]').forEach(b => b.onclick = () => {
    const [id, due] = b.dataset.paynow.split('|'), p = allPayments().find(x => x.id === id), r = cal.find(x => x.p.id === id && x.due === due);
    S.edit = null;
    S.draft = { ...newDraft(), type: p.kind === 'out' ? 'Расход' : (p.person ? 'Помощь' : 'Доход'), amount: String(r ? r.left : p.amount), account: p.account || newDraft().account, cat: p.cat || '', sub: p.sub || '', person: p.person || '', payId: id, date: today() };
    setTab('add');
  });
}
function payForm(p, accOpts) {
  p = p || {}; const kind = p.kind || 'out';
  const cats = kind === 'out' ? S.cfg.exp.map(c => c.cat) : S.cfg.inc.map(c => c.cat);
  const cat = p.cat || '', subs = kind === 'out' ? ((S.cfg.exp.find(c => c.cat === cat) || {}).subs || []).map(s => s.name) : ((S.cfg.inc.find(c => c.cat === cat) || {}).subs || []);
  const freq = p.freq || 'month';
  return `<div class="seg"><button class="chip ${kind === 'out' ? 'on' : ''}" data-pfkind="out">Платёж</button><button class="chip ${kind === 'in' ? 'on' : ''}" data-pfkind="in">Поступление</button></div>
  <label class="f">Название</label><input class="in" id="pfName" value="${esc(p.name || '')}" placeholder="${kind === 'out' ? 'Например: Абонемент в зал' : 'Например: Стипендия'}">
  <div class="grid2"><div><label class="f">Сумма, ${esc(CUR[baseCur()].sym)}</label><input class="in" id="pfAmt" inputmode="decimal" value="${p.amount || ''}"></div><div><label class="f">Счёт</label><select class="in" id="pfAcc">${accOpts(p.account || S.cfg.accounts[0].name)}</select></div></div>
  ${kind === 'in' ? `<label class="f">От кого (если это помощь)</label><select class="in" id="pfPerson"><option value="">— свой доход —</option>${S.cfg.people.map(x => `<option ${x.name === p.person ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
  <div class="grid2"><div><label class="f">Категория</label><select class="in" id="pfCat"><option value="">—</option>${cats.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div><label class="f">Подкатегория</label><select class="in" id="pfSub"><option value="">—</option>${subs.map(s => `<option ${s === p.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div></div>
  <div class="grid2"><div><label class="f">Как часто</label><select class="in" id="pfFreq">${Object.entries(FREQS).map(([k, v]) => `<option value="${k}" ${k === freq ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div id="pfWhen">${freq === 'week' ? '<label class="f">Первая дата — ниже, «Начало»</label>' : freq === 'year' ? `<label class="f">День и месяц</label><div class="grid2"><input class="in" id="pfDay" inputmode="numeric" value="${p.day || ''}" placeholder="день"><select class="in" id="pfMonth">${MONTHS.map((m, i) => `<option value="${i + 1}" ${+p.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>` : `<label class="f">Число месяца</label><input class="in" id="pfDay" inputmode="numeric" value="${p.day || ''}" placeholder="1–31">`}</div></div>
  ${freq === 'months' ? `<label class="f">Раз в сколько месяцев</label><input class="in" id="pfN" inputmode="numeric" value="${p.n || 3}">` : ''}
  <div class="grid2"><div><label class="f">Начало</label><input class="in" type="date" id="pfStart" value="${p.start || today()}"></div><div><label class="f">Окончание (необязательно)</label><input class="in" type="date" id="pfEnd" value="${p.end || ''}"></div></div>
  <div class="err" id="pfErr"></div>
  <button class="btn" id="pfSave">${p.id ? 'Сохранить' : '+ Добавить платёж'}</button>
  ${p.id ? `<button class="btn light" id="pfPause">${p.active === false ? '▶ Возобновить' : '⏸ Приостановить'}</button><button class="btn danger" id="pfDel">Удалить платёж</button><button class="btn light" id="pfCancel">Отмена</button>` : ''}`;
}
function bindPayForm(p0) {
  const read = () => ({ ...(p0 || {}), kind: document.querySelector('[data-pfkind].on').dataset.pfkind, name: $('#pfName').value.trim(), amount: num($('#pfAmt').value), account: $('#pfAcc').value,
    cat: $('#pfCat').value, sub: $('#pfSub').value, person: $('#pfPerson') ? $('#pfPerson').value : '', freq: $('#pfFreq').value,
    day: $('#pfDay') ? +$('#pfDay').value : 0, month: $('#pfMonth') ? +$('#pfMonth').value : 0, n: $('#pfN') ? Math.max(1, +$('#pfN').value || 1) : 1,
    start: $('#pfStart').value, end: $('#pfEnd').value });
  const redraw = draft => { S.payDraft = draft; const box = $('#pfName').closest('.card'); box.innerHTML = payForm(draft, sel => openAccs().map(a => `<option value="${esc(a.name)}" ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('')); bindPayForm(draft); };
  document.querySelectorAll('[data-pfkind]').forEach(b => b.onclick = () => redraw({ ...read(), kind: b.dataset.pfkind, cat: '', sub: '' }));
  $('#pfCat').onchange = () => redraw({ ...read(), sub: '' });
  $('#pfFreq').onchange = () => redraw(read());
  $('#pfSave').onclick = async () => {
    const p = read();
    if (!p.name) return ($('#pfErr').textContent = '⚠ Назови платёж');
    if (!(p.amount > 0)) return ($('#pfErr').textContent = '⚠ Укажи сумму');
    if (p.kind === 'out' && (!p.cat || !p.sub)) return ($('#pfErr').textContent = '⚠ Выбери категорию и подкатегорию — по ним приложение узнаёт оплату');
    if (p.kind === 'in' && !p.person && (!p.cat || !p.sub)) return ($('#pfErr').textContent = '⚠ Выбери категорию дохода или человека');
    if (p.freq !== 'week' && !(p.day >= 1 && p.day <= 31)) return ($('#pfErr').textContent = '⚠ Укажи число (1–31)');
    if (!p.start) return ($('#pfErr').textContent = '⚠ Укажи дату начала');
    if (p.end && p.end < p.start) return ($('#pfErr').textContent = '⚠ Окончание раньше начала');
    const list = payments().slice();
    if (p.id) list[list.findIndex(x => x.id === p.id)] = p; else list.push({ ...p, id: uid(), active: true });
    S.cfg.payments = list; S.payEdit = null; S.payDraft = null; await saveCfg(); toast(p.id ? 'Платёж сохранён' : 'Платёж добавлен ✓'); renderPayments();
  };
  if ($('#pfCancel')) $('#pfCancel').onclick = () => { S.payEdit = null; renderPayments(); };
  if ($('#pfPause')) $('#pfPause').onclick = async () => { const list = payments().map(x => x.id === p0.id ? { ...x, active: x.active === false } : x); S.cfg.payments = list; S.payEdit = null; await saveCfg(); renderPayments(); };
  if ($('#pfDel')) $('#pfDel').onclick = async () => { if (!confirm('Удалить платёж «' + p0.name + '»? Операции оплат останутся.')) return; S.cfg.payments = payments().filter(x => x.id !== p0.id); S.payEdit = null; await saveCfg(); renderPayments(); };
}
function renderPockets() {
  const M = S.month, ps = pocketState(M);
  const sug = S.dist ? suggestDistribution(M) : null;
  const opts = (sel, withFree) => (withFree ? `<option value="">Свободно</option>` : '') + ps.list.filter(p => !p.linkSavings).map(p => `<option value="${esc(p.name)}" ${p.name === sel ? 'selected' : ''}>${esc((p.kind === 'goal' ? '🎯 ' : '') + (p.label || p.name))}</option>`).join('');
  const journal = live().filter(isPocketOp).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  $('#view').innerHTML = budgetSeg() + `
  <div class="cards">
    <div class="kpi ${ps.free < 0 ? 'powder' : 'lilac'}"><div class="l">Свободно</div><div class="v ${ps.free < 0 ? 'neg' : ''}">${money(ps.free)}</div><div class="s">не в карманах</div></div>
    <div class="kpi blue"><div class="l">В карманах</div><div class="v">${money(ps.inPockets)}</div><div class="s">с назначением</div></div>
    <div class="kpi green"><div class="l">🛡 Подушка</div><div class="v">${money(ps.savings)}</div><div class="s">накопительные счета</div></div>
    <div class="kpi powder"><div class="l">Всего</div><div class="v">${money(ps.total)}</div><div class="s">${mlabel(M)}</div></div>
  </div>
  ${ps.free < 0 ? `<div class="warn">⚠ Карманы больше, чем денег, на ${money(-ps.free)}: часть карманов не обеспечена. Уменьши карманы (переложи в «Свободно») или внеси поступление.</div>` : ''}
  ${!S.dist && ps.free > 0 ? `<div class="info">У тебя ${money(ps.free)} без назначения. <button class="btn small" id="distOpen" style="margin:6px 0 0">Распределить по правилу</button></div>` : ''}
  ${sug ? `<div class="card" style="padding:10px 12px"><b>Распределение ${money(ps.free)}</b>
    <div class="muted">По правилу: обязательные → накопительные → гибкие → буфер до 10% плана → цели (по приоритету и сроку). Суммы можно поменять.</div>
    <table class="t">${sug.items.map((it, i) => `<tr><td>${esc(POCKET_KINDS[ps.st[it.to].kind].i)} ${esc(ps.st[it.to].label || it.to)}</td><td><input class="mini" data-dist="${i}" inputmode="decimal" value="${it.amount}"></td></tr>`).join('') || '<tr><td class="muted">Всё уже распределено по плану 🎉</td><td></td></tr>'}
    <tr><td class="muted">Останется свободно</td><td id="distLeft">${money(sug.left)}</td></tr></table>
    ${sug.left > 0 ? '<div class="muted">Остаток останется свободным — его можно положить в любую цель кнопкой «Пополнить» в «Цели».</div>' : ''}
    ${sug.items.length ? '<button class="btn" id="distOk">Подтвердить распределение</button><button class="btn light" id="distCancel">Не сейчас</button>' : '<button class="btn light" id="distCancel">Понятно</button>'}</div>` : ''}
  <h2>Карманы · ${mlabel(M)}</h2>
  ${(() => { const empty = p => !p.linkSavings && p.kind !== 'buffer' && !p.bal && !p.plan && !p.inM && !p.spentM;
    const act = ps.list.filter(p => !empty(p)), emp = ps.list.filter(empty);
    return `<div class="card">${act.map(p => pocketRow(p)).join('')}</div>` + (emp.length ? `<details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Пустые карманы (${emp.length})</summary><div class="muted" style="padding-bottom:8px">${emp.map(p => esc(POCKET_KINDS[p.kind].i + ' ' + (p.label || p.name))).join(' · ')}<br>Появятся в списке, когда в них будет план, деньги или траты.</div></details>` : ''); })()}
  <details class="card" style="padding:4px 12px"><summary style="font-weight:600">⇄ Переложить между карманами</summary>
    <div class="grid2"><div><label class="f">Откуда</label><select class="in" id="mvFrom">${opts('', true)}</select></div><div><label class="f">Куда</label><select class="in" id="mvTo">${opts(ps.list.find(p => !p.linkSavings) ? ps.list.find(p => !p.linkSavings).name : '', true)}</select></div></div>
    <label class="f">Сумма</label><input class="in" id="mvAmt" inputmode="decimal" placeholder="0">
    <button class="btn small" id="mvOk" style="margin-bottom:10px">Переложить</button></details>
  ${journal.length ? `<details class="card" style="padding:4px 12px"><summary style="font-weight:600">Журнал карманов</summary>${journal.map(o => `<div class="row"><span class="sub">${o.date.split('-').reverse().join('.')} · ${esc(pLabel(o.from))} → ${esc(pLabel(o.to))}${o.comment ? ' · ' + esc(o.comment) : ''}</span><span>${money(o.amount)} <button class="btn small light" data-undo="${o.id}" style="margin:0;padding:4px 8px">✕</button></span></div>`).join('')}</details>` : ''}
  <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как работают карманы?</summary><div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0"><b>Карман — деньги с назначением</b>: на машину, на обязательные платежи, на повседневные траты. Деньги остаются на твоих счетах, карман просто «помечает», для чего они.</p>
    <p style="margin:4px 0"><b>Свободно</b> = деньги на обычных счетах − всё, что лежит в карманах. Если карманов больше, чем денег, приложение предупредит.</p>
    <p style="margin:4px 0"><b>Трата</b> уменьшает карман своей категории (бензин → «Автомобиль»). Какая категория в каком кармане — «Ещё → Категории».</p>
    <p style="margin:4px 0"><b>Пришли деньги</b> — приложение предложит разложить их по правилу: обязательные → накопительные → гибкие → буфер (до 10% месячного плана).</p>
    ${Object.values(POCKET_KINDS).map(k => `<p style="margin:4px 0">${k.i} <b>${k.l}</b>: ${k.d}.</p>`).join('')}
    <p style="margin:4px 0">🛡 <b>Подушка</b> — это твои накопительные счета (депозит, металлы). Пополняется переводом на депозит.</p>
  </div></details>`;
  bindBudgetSeg();
  if ($('#distOpen')) $('#distOpen').onclick = () => { S.dist = true; renderPockets(); };
  if ($('#distCancel')) $('#distCancel').onclick = () => { S.dist = false; renderPockets(); };
  const recalcLeft = () => { const sum = [...document.querySelectorAll('[data-dist]')].reduce((s, i) => s + num(i.value), 0); const el = $('#distLeft'); if (el) el.textContent = money(ps.free - sum); };
  document.querySelectorAll('[data-dist]').forEach(i => i.oninput = recalcLeft);
  if ($('#distOk')) $('#distOk').onclick = async () => {
    const moves = sug.items.map((it, i) => ({ from: '', to: it.to, amount: num(document.querySelector(`[data-dist="${i}"]`).value) })).filter(m => m.amount > 0);
    const sum = moves.reduce((s, m) => s + m.amount, 0);
    if (r2(sum) > r2(ps.free)) { toast('⚠ Больше, чем свободно — уменьши суммы'); return; }
    await addPocketMoves(moves, 'распределение'); S.dist = false; toast(`Распределено ${money(sum)} ✓`); renderPockets();
  };
  document.querySelectorAll('[data-cover]').forEach(btn => btn.onclick = async () => {
    const plan = coverPlan(M, btn.dataset.cover);
    if (!plan.moves.length) { toast('Покрыть нечем: нет свободных денег, экономии гибких карманов и буфера. Переложи вручную.'); return; }
    const txt = plan.moves.map(m => `${m.from || 'Свободно'}: ${money(m.amount)}`).join('\n');
    if (!confirm(`Покрыть перерасход «${btn.dataset.cover}»:\n${txt}${plan.left > 0 ? '\n\nНе хватит ещё ' + money(plan.left) : ''}`)) return;
    await addPocketMoves(plan.moves, 'покрытие перерасхода'); toast('Перерасход покрыт ✓'); renderPockets();
  });
  $('#mvOk').onclick = async () => {
    const from = $('#mvFrom').value, to = $('#mvTo').value, amount = num($('#mvAmt').value);
    if (from === to || !(amount > 0)) { toast('Выбери разные карманы и сумму'); return; }
    if (from && ps.st[from] && ps.st[from].bal < amount && !confirm(`В «${from}» только ${money(ps.st[from].bal)}. Всё равно переложить?`)) return;
    await addPocketMoves([{ from, to, amount }], 'вручную'); toast('Переложено ✓'); renderPockets();
  };
  document.querySelectorAll('[data-undo]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Отменить эту перекладку?')) return;
    const i = S.ops.findIndex(x => x.id === btn.dataset.undo); S.ops[i] = { ...S.ops[i], deleted: true, updatedAt: Date.now(), device: DEVICE }; await DB.put(S.ops[i]); Sync.soon(); renderPockets();
  });
}
function pocketRow(p) {
  const k = POCKET_KINDS[p.kind] || POCKET_KINDS.flexible;
  const neg = p.bal < 0;
  const detail = p.linkSavings ? 'накопительные счета · пополняется переводом на депозит'
    : p.kind === 'buffer' ? `цель: ${money(0.1 * pocketState(S.month).planTotal)} (10% плана)`
    : p.kind === 'goal' ? `в этом месяце: +${money(Math.max(0, p.inM))} · подробно — «Бюджет → Цели»`
    : `в этом месяце: +${money(Math.max(0, p.inM))} · потрачено ${money(p.spentM)} · план ${money(p.plan)}${p.auto ? ' · ' + money(p.auto) + ' взято из «Свободно»' : ''}${p.kind === 'flexible' ? ' · остаток вернётся в «Свободно» 1-го' : ''}`;
  const attr = ` data-pocketrow="${esc(p.name)}"`;
  return `<div class="row"${attr} style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><span class="t">${k.i} ${esc(p.label || p.name)}</span><b class="${neg ? 'neg' : ''}">${money(p.bal)}</b></div>
    <div class="sub">${k.l} · ${detail}</div>
    ${neg && !p.linkSavings ? `<div class="err">Перерасход ${money(-p.bal)} <button class="btn small" data-cover="${esc(p.name)}" style="margin:4px 0 0">Покрыть</button></div>` : ''}</div>`;
}
// ---------- Экран «Цели» ----------
const GOAL_IDEAS = ['Финансовая подушка', 'Первая квартира', 'Путешествие', 'Международная конференция', 'Крупная покупка', 'Курсы и обучение'];
function renderGoals() {
  const ps = pocketState(mkey(today())), sum = goalsSummary(ps);
  const ed = S.goalEdit ? goals().find(g => g.id === S.goalEdit) : null;
  const active = sum.infos.filter(i => !i.done).sort((a, b) => ((+a.g.priority || 3) - (+b.g.priority || 3)) || (a.g.deadline || '9999').localeCompare(b.g.deadline || '9999'));
  const done = sum.infos.filter(i => i.done);
  $('#view').innerHTML = budgetSeg() + `
  <div class="cards">
    <div class="kpi lilac"><div class="l">Откладывать на цели</div><div class="v">${money(sum.needAll)}</div><div class="s">в месяц, чтобы успеть к срокам</div></div>
    <div class="kpi ${sum.extra ? 'powder' : 'green'}"><div class="l">Остаётся в месяц</div><div class="v">${sum.cap === null ? '—' : money(sum.cap)}</div><div class="s">${sum.cap === null ? 'нужен хотя бы 1 полный месяц учёта' : 'доходы + помощь − расходы, ср. за ' + sum.monthsUsed + ' мес.'}</div></div>
  </div>
  ${sum.cap !== null && sum.needAll > 0 ? (sum.extra > 0
    ? `<div class="warn">⚠ Чтобы успеть ко всем целям, не хватает <b>${money(sum.extra)}</b> в месяц. Варианты: больше дохода, меньше расходов или сдвинуть сроки.</div>`
    : `<div class="ok">✓ Текущего остатка хватает, чтобы успевать к срокам всех целей.</div>`) : ''}
  ${ps.free > 0 ? `<div class="info">Свободно ${money(ps.free)} — можно положить в цель кнопкой «Пополнить».</div>` : ''}
  <h2>Мои цели</h2>
  ${active.length ? active.map(goalCard).join('') : '<div class="card"><div class="row muted">Целей пока нет — добавь первую ниже.</div></div>'}
  ${done.length ? `<h2>Достигнуто 🎉</h2>${done.map(goalCard).join('')}` : ''}
  <h2>${ed ? 'Правка цели' : 'Новая цель'}</h2>
  <div class="card" style="padding:10px 12px">
    ${ed ? '' : `<div class="seg" style="margin-bottom:6px">${GOAL_IDEAS.map(n => `<button class="chip" data-gidea="${esc(n)}">${esc(n)}</button>`).join('')}</div>`}
    <label class="f">Название</label><input class="in" id="gName" value="${esc(ed ? ed.name : '')}" placeholder="Например: Первая квартира">
    <div class="grid2"><div><label class="f">Сумма цели, ${esc(CUR[baseCur()].sym)}</label><input class="in" id="gTarget" inputmode="decimal" value="${ed ? ed.target : ''}"></div>
      <div><label class="f">Срок (необязательно)</label><input class="in" type="date" id="gDeadline" value="${ed ? ed.deadline || '' : ''}"></div></div>
    <label class="f">Приоритет</label><select class="in" id="gPrio">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${(+(ed ? ed.priority : 3) || 3) === n ? 'selected' : ''}>${'★'.repeat(6 - n)}${'☆'.repeat(n - 1)} ${['— главная', '— высокий', '— средний', '— низкий', '— когда-нибудь'][n - 1]}</option>`).join('')}</select>
    <label class="f"><input type="checkbox" id="gLink" ${ed && ed.linkSavings ? 'checked' : ''}> копится на накопительных счетах (депозит) — накоплено = их остаток</label>
    <div class="muted" id="gHint" style="margin-top:4px">${pocketState(mkey(today())).planTotal ? 'Подсказка для подушки: 6 × план месяца = ' + money(6 * pocketState(mkey(today())).planTotal) + ' <button class="btn small light" id="gSix" style="margin:0 0 0 4px;padding:3px 8px">вписать</button>' : ''}</div>
    <div class="err" id="gErr"></div>
    <button class="btn" id="gSave">${ed ? 'Сохранить' : '+ Добавить цель'}</button>
    ${ed ? '<button class="btn light" id="gCancel">Отмена</button><button class="btn danger" id="gDel">Удалить цель</button>' : ''}
  </div>
  <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как работают цели?</summary><div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0"><b>Цель — это карман 🎯</b> с суммой и сроком. Деньги в ней настоящие: они остаются на твоих счетах, но уже «отложены» и не входят в «Свободно».</p>
    <p style="margin:4px 0"><b>Взнос в месяц</b> = сколько осталось накопить ÷ сколько месяцев до срока. Без срока — копишь в своём темпе.</p>
    <p style="margin:4px 0"><b>Распределение</b> после поступления: обязательные → накопительные → гибкие → буфер → <b>цели по приоритету и ближайшему сроку</b>.</p>
    <p style="margin:4px 0"><b>Успеваю или нет</b> — по среднему темпу пополнения за 3 месяца. «Не хватает в месяц» — сравнение нужных взносов со средним остатком месяца (доходы + помощь − расходы).</p>
    <p style="margin:4px 0"><b>Подушка на депозите</b>: поставь галочку «копится на накопительных счетах» — накоплено будет равно остатку депозита.</p>
    <p style="margin:4px 0">Это планирование и учёт, а не инвестиционные рекомендации.</p>
  </div></details>`;
  bindBudgetSeg();
  document.querySelectorAll('[data-gidea]').forEach(b => b.onclick = () => { $('#gName').value = b.dataset.gidea; if (b.dataset.gidea === 'Финансовая подушка') $('#gLink').checked = true; });
  if ($('#gSix')) $('#gSix').onclick = () => { $('#gTarget').value = r2(6 * pocketState(mkey(today())).planTotal); };
  $('#gSave').onclick = async () => {
    const name = $('#gName').value.trim(), target = num($('#gTarget').value), deadline = $('#gDeadline').value, priority = +$('#gPrio').value, linkSavings = $('#gLink').checked;
    if (!name) return ($('#gErr').textContent = '⚠ Назови цель');
    if (!(target > 0)) return ($('#gErr').textContent = '⚠ Укажи сумму цели');
    if (deadline && deadline <= today()) return ($('#gErr').textContent = '⚠ Срок должен быть в будущем');
    if (goals().some(g => g.name === name && (!ed || g.id !== ed.id))) return ($('#gErr').textContent = '⚠ Цель с таким названием уже есть');
    const list = goals().slice();
    if (ed) list[list.findIndex(g => g.id === ed.id)] = { ...ed, name, target, deadline, priority, linkSavings };
    else list.push({ id: uid().slice(0, 8), name, target, deadline, priority, linkSavings, archived: false, createdAt: new Date().toISOString() });
    S.cfg.goals = list; S.goalEdit = null; await saveCfg(); toast(ed ? 'Цель сохранена' : 'Цель добавлена 🎯'); renderGoals();
  };
  if ($('#gCancel')) $('#gCancel').onclick = () => { S.goalEdit = null; renderGoals(); };
  if ($('#gDel')) $('#gDel').onclick = async () => {
    const bal = (ps.st[gKey(ed)] || {}).bal || 0;
    if (!confirm(`Удалить цель «${ed.name}»?${bal > 0 ? ' Накопленные ' + money(bal) + ' вернутся в «Свободно».' : ''}`)) return;
    if (bal > 0) await addPocketMoves([{ from: gKey(ed), to: '', amount: bal }], 'цель удалена');
    S.cfg.goals = goals().map(g => g.id === ed.id ? { ...g, archived: true } : g); S.goalEdit = null; await saveCfg(); renderGoals();
  };
  document.querySelectorAll('[data-gedit]').forEach(b => b.onclick = () => { S.goalEdit = b.dataset.gedit; renderGoals(); setTimeout(() => $('#gName').scrollIntoView({ block: 'center' }), 50); });
  document.querySelectorAll('[data-gadd],[data-gtake]').forEach(b => b.onclick = async () => {
    const add = !!b.dataset.gadd, g = goals().find(x => x.id === (b.dataset.gadd || b.dataset.gtake)), bal = (ps.st[gKey(g)] || {}).bal || 0;
    const v = num(prompt(add ? `Сколько положить в «${g.name}»? Свободно ${money(ps.free)}` : `Сколько забрать из «${g.name}» в «Свободно»? В цели ${money(bal)}`, add ? r2(Math.max(0, Math.min(ps.free, goalInfo(g, ps).need || ps.free))) : r2(bal)) || '');
    if (!(v > 0)) return;
    if (add && v > ps.free && !confirm(`Свободно только ${money(ps.free)} — карманы станут больше денег. Всё равно?`)) return;
    if (!add && v > bal) { toast('В цели только ' + money(bal)); return; }
    await addPocketMoves([add ? { from: '', to: gKey(g), amount: v } : { from: gKey(g), to: '', amount: v }], add ? 'пополнение цели' : 'из цели');
    const after = goalInfo(g, pocketState(mkey(today())));
    toast(after.done ? `🎉 Цель «${g.name}» достигнута!` : `${add ? 'В цель' : 'Из цели'}: ${money(v)} · накоплено ${Math.round(after.pct * 100)}%`); renderGoals();
  });
}
function goalCard(i) {
  const g = i.g, pr = +g.priority || 3, t = today();
  const status = i.done ? '<span class="pos">🎉 достигнута</span>'
    : i.late ? `<span class="neg">⚠ срок прошёл, осталось ${money(i.rest)}</span>`
    : !g.deadline ? (i.pace > 0 ? `в текущем темпе — к ${i.eta.split('-').reverse().join('.')}` : 'без срока · копи в своём темпе')
    : i.fresh ? 'новая цель · начни с первого взноса'
    : i.onTrack ? `<span class="pos">✓ успеваю</span>${i.pace > 0 && i.eta ? ' · в текущем темпе к ' + i.eta.split('-').reverse().join('.') : ''}`
    : `<span class="neg">⚠ отстаю</span>${i.pace > 0 ? ' · в текущем темпе к ' + i.eta.split('-').reverse().join('.') : ' · пополнений пока не было'}`;
  return `<div class="card" style="padding:10px 12px"><div style="display:flex;justify-content:space-between;gap:8px"><b>🎯 ${esc(g.name)}</b><span class="sub">${'★'.repeat(6 - pr)}${'☆'.repeat(pr - 1)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-top:4px"><span>${money(i.saved)} <span class="sub">из ${money(i.target)}</span></span><b>${Math.round(i.pct * 100)}%</b></div>
    <div class="bar"><i style="width:${i.pct * 100}%;background:${i.done ? 'var(--greenInk)' : 'var(--lilac2)'}"></i></div>
    <div class="sub" style="margin-top:4px">${g.deadline ? 'срок ' + g.deadline.split('-').reverse().join('.') + (g.deadline > t ? ` (${i.months} мес.)` : '') + ' · ' : ''}${!i.done && g.deadline ? 'нужно ' + money(i.need) + '/мес · ' : ''}${i.pace ? 'темп ' + money(i.pace) + '/мес · ' : ''}${g.linkSavings ? 'на депозите · ' : ''}${status}</div>
    <div>${g.linkSavings ? '' : `<button class="btn small" data-gadd="${g.id}">+ Пополнить</button><button class="btn small light" data-gtake="${g.id}">Забрать</button>`}<button class="btn small light" data-gedit="${g.id}">✎</button></div></div>`;
}
function renderPlanFact() {
  const b = budget(S.month);
  $('#view').innerHTML = budgetSeg() + `
  <div class="cards"><div class="kpi lilac"><div class="l">План</div><div class="v">${money(b.plan)}</div></div>
  <div class="kpi powder"><div class="l">Факт</div><div class="v">${money(b.fact)}</div></div>
  <div class="kpi ${b.diff < 0 ? 'powder' : 'green'}"><div class="l">${b.diff < 0 ? 'Перерасход' : 'Экономия'}</div><div class="v ${b.diff < 0 ? 'neg' : ''}">${money(Math.abs(b.diff))}</div></div>
  <div class="kpi blue"><div class="l">Исполнение</div><div class="v">${b.plan ? pct(b.fact / b.plan) : '–'}</div></div></div>
  <details class="card" style="padding:4px 12px;margin-top:10px"><summary class="muted" style="font-weight:600">Откуда план и как его поменять?</summary>
  <div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0"><b>Обычный план</b> берётся из «Ещё → Категории → План в месяц» — средняя сумма, одна на все месяцы.</p>
    <p style="margin:4px 0"><b>Только для этого месяца</b>: нажми на сумму в колонке «План» и впиши другую. Например, в декабре на подарки 40 000 вместо обычных 10 000 — остальные месяцы не изменятся.</p>
    <p style="margin:4px 0">«Остаток» — сколько ещё можно потратить по плану; красным — перерасход.</p>
  </div></details>
  ${b.cats.map(c => `<details class="card" ${c.fact ? 'open' : ''}><summary>${esc(c.cat)} <span class="sub" style="float:right">${money(c.fact)} / ${money(c.plan)}</span></summary>
    <table class="t"><tr><th>Подкатегория</th><th>План</th><th>Факт</th><th>Остаток</th></tr>
    ${c.subs.map(s => `<tr><td>${esc(s.name)}</td><td><input class="mini" data-plan="${esc(c.cat)}|${esc(s.name)}" value="${s.plan || ''}" inputmode="numeric" placeholder="0"></td><td>${s.fact ? money(s.fact) : '–'}</td><td class="${s.diff < 0 ? 'neg' : ''}">${s.plan || s.fact ? money(s.diff) : '–'}</td></tr>`).join('')}
    </table></details>`).join('')}`;
  document.querySelectorAll('[data-plan]').forEach(inp => inp.addEventListener('change', async () => {
    const [cat, sub] = inp.dataset.plan.split('|'); const v = num(inp.value);
    S.cfg.plans = S.cfg.plans.filter(p => !(p.month === S.month && p.cat === cat && p.sub === sub));
    const base = planFor(S.month, cat, sub);
    if (v !== base) S.cfg.plans.push({ month: S.month, cat, sub, amount: v });
    await saveCfg(); toast(`План «${sub}» на ${mlabel(S.month)}: ${money(v)}`); renderBudget();
  }));
  bindBudgetSeg();
}

// ---------- Ещё: счета, категории, люди, данные ----------
function renderMore() {
  const b = balances();
  $('#view').innerHTML = `
  <h2 id="secAcc">Счета</h2>
  <div class="card" style="padding:10px 12px"><label class="f" style="margin-top:0">Дата начала учёта</label>
    ${S.cfg.accounts.some(startSaved) ? `<div style="display:flex;justify-content:space-between"><b>${dRu(S.cfg.startDate)}</b><span class="sub">🔒 закреплена</span></div>` : `<input class="in" type="date" id="startDate" value="${S.cfg.startDate}">`}
    <div class="muted" style="margin-top:4px">Начальные остатки вводятся на эту дату. Операции раньше неё не считаются — чтобы деньги не учлись дважды.</div>
    <details style="margin-top:6px"><summary class="muted" style="font-weight:600">Начальный остаток и сверка — как это работает?</summary>
    <div class="muted"><p style="margin:4px 0"><b>Начальный остаток</b> вводится один раз — сколько было на счёте в дату начала учёта. Нажми «Сохранить», проверь ещё раз и подтверди. После этого он закреплён навсегда и больше не показывается в счёте — посмотреть его можно в «📜 С чего начался учёт».</p>
    <p style="margin:4px 0"><b>Ошиблась при вводе?</b> Исправляется сверкой: впиши, сколько в банке, — если больше, «Нашла средства», если меньше, «Внести списание».</p>
    <p style="margin:4px 0"><b>Сверка</b> — раз в неделю открой банк, впиши, сколько там денег сейчас, и нажми «Сверить». Совпало — ✓, всё внесено. Не совпало — приложение покажет разницу: найди пропущенную операцию или внеси «Корректировку» на разницу одной кнопкой. Цифра из банка не хранится, поэтому новые операции не вызывают ложных ошибок.</p></div></details></div>
  ${startRecord()}
  <div class="card">${S.cfg.accounts.map((a, i) => a.closed ? closedAccRow(a, i) : `<div class="row" id="acc${i}" style="display:block">
    <div style="display:flex;justify-content:space-between"><b>${esc(a.name)}</b><span>${fmt(b[a.name], accCur(a))}</span></div>
    <label class="f">Валюта счёта</label><select class="in" data-acc="${i}" data-k="cur">${CURRENCIES.map(c => `<option value="${c.code}" ${c.code === accCur(a) ? 'selected' : ''}>${c.code} — ${esc(c.name)}</option>`).join('')}</select>
    ${startField(a, i)}
    ${reconField(a, i, b[a.name])}
    <label class="f"><input type="checkbox" data-acc="${i}" data-k="savings" ${a.savings ? 'checked' : ''}> это накопления</label>
    ${a.savings && !isMetal(accCur(a)) ? depositBlock(a, i, b[a.name]) : ''}
    <div class="grid2"><input class="in" data-acc="${i}" data-k="name" value="${esc(a.name)}"><button class="btn small light" data-delacc="${i}">Убрать счёт</button></div></div>`).join('')}
    <button class="btn small" id="addAcc">+ Счёт</button></div>
  <h2 id="secCur">Валюты и курсы</h2>
  <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как работают валюты и золото?</summary>
  <div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0"><b>У каждого счёта своя валюта</b> (выбирается выше): тенге, доллары, евро… Для золота и серебра выбери «Золото (граммы)» — счёт будет в граммах.</p>
    <p style="margin:4px 0"><b>Купила валюту или золото</b> — операция «Обмен валюты» («+» → «Ещё…»): сколько отдала с одного счёта и сколько получила на другой.</p>
    <p style="margin:4px 0"><b>Траты в другой валюте</b> (например, в поездке) пересчитываются в основную валюту по курсу, который запоминается в операции — старые отчёты не меняются, когда меняется курс.</p>
    <p style="margin:4px 0"><b>Итоги</b> («Всего денег», «Накопления») — в основной валюте по текущему курсу. Металлы входят в накопления, но не в «Свободно».</p>
    <p style="margin:4px 0"><b>Курсы</b> подтягиваются сами раз в 12 часов. Золото — мировая биржевая цена; банк покупает и продаёт слитки по своей цене — её можно вписать вручную. Пустое поле «Свой курс» = автоматический.</p>
    <p style="margin:4px 0">Это учёт, а не инвестиционная рекомендация.</p>
  </div></details>
  <div class="card" style="padding:10px 12px">
    <label class="f" style="margin-top:0">Основная валюта (в ней итоги и бюджет)</label>
    <select class="in" id="baseCur" ${live().length ? 'disabled' : ''}>${CURRENCIES.filter(c => !c.metal).map(c => `<option value="${c.code}" ${c.code === baseCur() ? 'selected' : ''}>${c.code} — ${esc(c.name)}</option>`).join('')}</select>
    ${live().length ? '<div class="muted" style="margin-top:4px">Основную валюту можно менять, только пока нет операций.</div>' : ''}
    ${ratesTable()}
    <button class="btn small" id="refreshRates">↻ Обновить курсы</button>
    <div class="muted" style="margin-top:6px">${Rates.data ? `Курсы: ${esc(Rates.data.src)}, на ${esc(Rates.data.date)}; загружено ${new Date(Rates.data.fetchedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'Курсы ещё не загружались.'} Источники: <a href="https://github.com/fawazahmed0/exchange-api" target="_blank" rel="noopener">Currency API</a>, запасной — <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a>.</div>
  </div>
  <h2 id="secCat">Категории и план в месяц</h2>
  <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как работает «План в месяц»?</summary>
  <div class="muted" style="padding-bottom:8px">
    <p style="margin:4px 0">Впиши, <b>сколько обычно тратишь</b> на подкатегорию <b>в среднем месяце</b>. Эта сумма сама становится планом <b>для каждого месяца</b> — заполнять заново не нужно.</p>
    <p style="margin:4px 0">Пример: на кафе обычно уходит ~15 000 ₸ → пишешь 15 000. Каждый месяц приложение покажет: «осталось 2 700 ₸» или «перерасход».</p>
    <p style="margin:4px 0">Заполняй только то, на что реально тратишь. Пусто — значит «не планирую». Траты раз в год (страховка, сезонная одежда) раздели на 12.</p>
    <p style="margin:4px 0"><b>Особый месяц</b> (праздники, поездка) — меняется на вкладке «Бюджет»: выбери месяц стрелками и нажми на сумму плана. Изменится только этот месяц.</p>
    <p style="margin:4px 0">Не знаешь точно — ставь примерно. Через месяц учёта увидишь реальные цифры и поправишь.</p>
  </div></details>
  ${S.cfg.exp.map((c, ci) => `<details class="card"><summary>${esc(c.cat)} <span class="sub" style="float:right">${money(c.subs.reduce((a, s) => a + (+s.base || 0), 0))}</span></summary>
    <label class="f">Карман этой категории</label><select class="in" data-catpocket="${ci}">${pockets().filter(p => !p.linkSavings).map(p => `<option value="${esc(p.name)}" ${p.name === pocketOfCat(c.cat) ? 'selected' : ''}>${esc(POCKET_KINDS[p.kind].i + ' ' + p.name)}</option>`).join('')}</select>
    <table class="t"><tr><th>Подкатегория</th><th>План в месяц</th></tr>${c.subs.map((s, si) => `<tr><td>${esc(s.name)}<div class="sub">${esc(s.oblig)} · ${esc(s.period)}</div></td><td><input class="mini" data-base="${ci}|${si}" value="${s.base || ''}" inputmode="numeric" placeholder="0"></td></tr>`).join('')}</table>
    <div class="grid2" style="margin:8px 0"><input class="in" id="ns${ci}" placeholder="Новая подкатегория"><button class="btn small" data-addsub="${ci}">+ Добавить</button></div></details>`).join('')}
  <div class="card"><div class="grid2" style="margin:8px 0"><input class="in" id="newCat" placeholder="Новая категория расходов"><button class="btn small" id="addCat">+ Категория</button></div></div>
  <h2>Карманы</h2>
  <p class="muted">Название и тип каждого кармана. Какая категория в каком кармане — выбирается внутри категории выше. Подробно — «Бюджет → Карманы → Как работают карманы?».</p>
  <div class="card">${pockets().map((p, i) => `<div class="row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px">
    <input class="in" data-pk="${i}" data-k="name" value="${esc(p.name)}" ${p.linkSavings ? 'disabled' : ''}>
    <select class="in" data-pk="${i}" data-k="kind" ${p.linkSavings ? 'disabled' : ''}>${Object.entries(POCKET_KINDS).filter(([k]) => k !== 'goal' && (p.linkSavings || k !== 'protected')).map(([k, v]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v.i} ${v.l}</option>`).join('')}</select>
    ${p.linkSavings ? '<span></span>' : `<button class="btn small light" data-delpk="${i}" style="margin:0">✕</button>`}</div>`).join('')}
    <div class="grid2" style="margin:8px 0"><input class="in" id="newPocket" placeholder="Новый карман"><button class="btn small" id="addPocket">+ Карман</button></div></div>
  <h2>Люди</h2>
  <p class="muted">Роль выбери из списка или «✎ Своя роль…». Удалить можно того, с кем нет операций.</p>
  <div class="card">${S.cfg.people.map((p, i) => `<div class="row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px">
    <input class="in" data-person-i="${i}" data-k="name" value="${esc(p.name)}">
    <select class="in" data-person-i="${i}" data-k="role">${roleOptions(p.role)}</select>
    <button class="btn small light" data-delperson="${i}" style="margin:0" aria-label="Удалить">✕</button></div>`).join('')}
    <div class="grid2" style="margin:8px 0"><input class="in" id="newPerson" placeholder="Имя"><button class="btn small" id="addPerson">+ Человек</button></div></div>
  <h2>⭐ Избранные операции</h2>
  <div class="card">${(S.cfg.favs || []).length ? S.cfg.favs.map((f, i) => `<div class="row"><span style="min-width:0">${esc(qLabel(f))} <span class="sub">· ${esc(f.type)}${f.cat ? ' · ' + esc(f.cat) : ''}${f.amount ? ' · ' + fmt(f.amount, curOf(f.account)) : ''}</span></span><button class="btn small light" data-delfav="${i}" style="margin:0">✕</button></div>`).join('') : '<div class="row muted">Пока пусто. При вводе операции отметь «⭐ Добавить в избранное».</div>'}</div>
  <h2>🔒 Защита входа</h2>
  <div class="card" style="padding:12px"><div class="muted">PIN-код спрашивается при открытии приложения и после минуты в фоне. Хранится только на этом устройстве — на телефоне и ноутбуке ставится отдельно. Это замок экрана, а не шифрование данных.</div>
    ${Lock.has() ? '<div class="ok" style="margin-top:8px">🔒 PIN-код включён на этом устройстве</div><button class="btn small" id="pinChange">Сменить PIN</button><button class="btn small light" id="pinOff">Убрать PIN</button>' : '<button class="btn small" id="pinSet">Поставить PIN-код</button>'}</div>
  <h2>Данные</h2>
  <div class="card" style="padding:12px">
    <div class="muted">Операций: ${live().length}. Хранятся на этом устройстве${Sync.enabled() ? ' и в твоём Google Диске (скрытая папка приложения — её видит только «Жизнь»)' : ''}.</div>
    <div style="margin-top:6px;font-size:13px">${syncInfo()}</div>
    <button class="btn small" id="syncNow">${Sync.enabled() ? '☁ Синхронизировать сейчас' : '☁ Подключить Google Диск'}</button>
    ${Sync.enabled() ? '<button class="btn small light" id="syncOff">Отключить на этом устройстве</button>' : ''}
    <button class="btn small" id="openReport">📄 Отчёт за месяц (PDF / Excel)</button>
    <button class="btn small" id="exportCsv">Выгрузить операции (Excel / CSV)</button>
    <button class="btn small light" id="backup">Резервная копия (файл)</button>
    <label class="btn small light" style="cursor:pointer">Восстановить из копии<input type="file" id="restore" accept=".json" hidden></label>
  </div>
  <p class="muted">Жизнь · раздел «Финансы» · этап 1. Это учёт и планирование, а не инвестиционные рекомендации.</p>`;
  document.querySelectorAll('[data-acc]').forEach(inp => inp.addEventListener('change', async () => {
    const a = S.cfg.accounts[+inp.dataset.acc], k = inp.dataset.k;
    if (k === 'savings') a.savings = inp.checked;
    else if (k === 'capitalize') a.capitalize = inp.checked;
    else if (k === 'payDay') a.payDay = Math.min(31, Math.max(0, Math.round(num(inp.value)))) || null;
    else if (k === 'openDate' || k === 'depType' || k === 'endDate' || k === 'termUnit' || k === 'topUp' || k === 'withdraw') a[k] = inp.value || '';
    else if (k === 'autoRenew') a.autoRenew = inp.checked;
    else if (k === 'termN') { a.termN = Math.max(0, Math.round(num(inp.value))) || null; delete a.termMonths; }
    else if (k === 'cur') {
      if (live().some(o => o.account === a.name || o.to === a.name)) { toast('По счёту уже есть операции — валюту не поменять. Создай новый счёт в нужной валюте'); return renderMore(); }
      a.cur = inp.value; if (isMetal(a.cur)) a.savings = true;
      if (a.cur !== baseCur() && !Rates.get(a.cur)) Rates.refresh().then(renderMore).catch(() => {});
    }
    else if (k === 'name') { const old = a.name, nv = inp.value.trim(); if (!nv || S.cfg.accounts.some(x => x !== a && x.name === nv)) { toast('Такое имя уже есть'); return renderMore(); } a.name = nv; for (const o of S.ops) { let ch = false; if (o.account === old) { o.account = nv; ch = true; } if (o.to === old) { o.to = nv; ch = true; } if (ch) { o.updatedAt = Date.now(); await DB.put(o); } } }
    else a[k] = inp.value === '' ? (k === 'fact' ? null : 0) : num(inp.value);
    await saveCfg(); toast('Сохранено'); renderMore();
  }));
  if ($('#startDate')) $('#startDate').addEventListener('change', async e => {
    const v = e.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    const early = live().filter(o => o.date < v).length;
    if (early && !confirm(`Операций раньше ${v.split('-').reverse().join('.')}: ${early}. Они перестанут учитываться. Продолжить?`)) return renderMore();
    S.cfg.startDate = v; await saveCfg(); S.month = mkey(v > today() ? v : today()); toast('Дата начала учёта: ' + v.split('-').reverse().join('.')); renderMore();
  });
  document.querySelectorAll('[data-startsave]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.startsave, a = S.cfg.accounts[i], raw = $('#st' + i).value.trim();
    if (!raw) { toast('Впиши сумму (если денег не было — 0)'); return; }
    const v = num(raw); if (!(v >= 0)) { toast('⚠ Сумма не может быть отрицательной'); return; }
    const line = `<div class="muted" style="margin:6px 0">Счёт «${esc(a.name)}» · на ${dRu(S.cfg.startDate)}</div><div style="font-size:26px;font-weight:700;margin:6px 0">${fmt(v, accCur(a))}</div>`;
    const ok = await askModal(`<div style="font-size:30px">🔍</div><b style="font-size:17px">Проверь ещё раз: всё верно?</b>${line}<div class="muted">После сохранения изменить нельзя. Ошибки потом исправляются только сверкой с банком.</div>`,
      [{ t: 'Да, всё верно', v: true }, { t: 'Нет, исправить', v: false, light: true }]);
    if (!ok) { const el = $('#st' + i); if (el) el.focus(); return; }
    const save = await askModal(`<div style="font-size:30px">💾</div><b style="font-size:17px">Сохранить начальный остаток?</b>${line}`,
      [{ t: 'Сохранить', v: true }, { t: 'Отмена', v: false, light: true }]);
    if (!save) return;
    a.start = v; a.startLocked = true; a.startSavedAt = today(); await saveCfg(); toast(`🔒 ${a.name}: начальный остаток сохранён`); renderMore();
  });
  document.querySelectorAll('[data-recon]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.recon, a = S.cfg.accounts[i], raw = $('#rc' + i).value.trim();
    if (!raw) { toast('Впиши, сколько сейчас в банке'); return; }
    const bank = num(raw), calc = r2(balances()[a.name]);
    if (r2(bank) === calc) { a.reconciledAt = today(); delete a.reconPending; await saveCfg(); toast(`✓ ${a.name}: сходится (${fmt(calc, accCur(a))})`); }
    else { a.reconPending = { date: today(), bank, calc }; await saveCfg(); toast(`⚠ ${a.name}: не сходится на ${fmt(Math.abs(bank - calc), accCur(a))}`); }
    renderMore();
  });
  document.querySelectorAll('[data-reconfix]').forEach(b => b.onclick = async () => {
    const a = S.cfg.accounts[+b.dataset.reconfix], p = a.reconPending; if (!p) return;
    const diff = r2(p.bank - p.calc), now = Date.now();
    const op = { id: uid(), type: diff > 0 ? 'Корректировка +' : 'Корректировка −', date: today(), account: a.name, amount: Math.abs(diff), cat: '', sub: '', person: '', to: '', comment: 'сверка с банком', rate: 0, amountTo: 0, createdAt: now, updatedAt: now, device: DEVICE, deleted: false };
    if (!confirm(`Внести «${op.type}» на ${fmt(op.amount, accCur(a))}? Остаток станет как в банке.`)) return;
    S.ops.push(op); await DB.put(op); a.reconciledAt = today(); delete a.reconPending; await saveCfg(); toast('Корректировка внесена — счёт сходится ✓'); renderMore();
  });
  document.querySelectorAll('[data-reconok]').forEach(b => b.onclick = async () => { const a = S.cfg.accounts[+b.dataset.reconok]; delete a.reconPending; await saveCfg(); toast('Ок. Сверь ещё раз после того, как внесёшь операцию'); renderMore(); });
  document.querySelectorAll('[data-closeacc]').forEach(b => b.onclick = () => { S.closeAcc = b.dataset.closeacc; renderMore(); });
  document.querySelectorAll('[data-closecancel]').forEach(b => b.onclick = () => { S.closeAcc = null; renderMore(); });
  document.querySelectorAll('[data-closeok]').forEach(b => b.onclick = async () => {
    const a = S.cfg.accounts.find(x => x.name === b.dataset.closeok); if (!a) return;
    const date = $('#clDate').value || today(), intr = num($('#clInt').value), to = $('#clTo').value, now = Date.now();
    if (date < S.cfg.startDate) { toast('⚠ Дата раньше начала учёта'); return; }
    const mk = o => ({ id: uid(), date, cat: '', sub: '', person: '', to: '', comment: 'закрытие депозита', rate: 0, amountTo: 0, createdAt: now, updatedAt: now, device: DEVICE, deleted: false, ...o });
    const ops = [];
    if (intr > 0) ops.push(mk({ type: 'Доход', account: a.name, cat: 'Банк', sub: 'Проценты по депозиту', amount: intr }));
    const bal = r2(balances()[a.name] + intr);
    if (!confirm(`Закрыть «${a.name}»?${intr > 0 ? '\nПоследние проценты: ' + fmt(intr, accCur(a)) : ''}\nПеревести ${fmt(bal, accCur(a))} → «${to}».\nСчёт уйдёт в «Закрытые», история операций сохранится.`)) return;
    if (bal > 0) ops.push(mk({ type: 'Перевод между счетами', account: a.name, to, amount: bal }));
    for (const op of ops) { S.ops.push(op); await DB.put(op); }
    a.closed = true; a.closedAt = date; if (depEnd(a)) a.handledEnd = depEnd(a);
    S.closeAcc = null; await saveCfg(); toast(`Депозит «${a.name}» закрыт, ${fmt(bal, accCur(a))} → ${to}`); renderMore();
  });
  document.querySelectorAll('[data-reopen]').forEach(b => b.onclick = async () => { const a = S.cfg.accounts[+b.dataset.reopen]; a.closed = false; delete a.closedAt; await saveCfg(); toast('Счёт снова открыт'); renderMore(); });
  document.querySelectorAll('[data-delacc]').forEach(btn => btn.onclick = async () => {
    const a = S.cfg.accounts[+btn.dataset.delacc];
    if (live().some(o => o.account === a.name || o.to === a.name)) { toast('По этому счёту есть операции — убрать нельзя'); return; }
    if (!confirm('Убрать счёт «' + a.name + '»?')) return;
    S.cfg.accounts.splice(+btn.dataset.delacc, 1); await saveCfg(); renderMore();
  });
  $('#baseCur').onchange = async e => { S.cfg.base = e.target.value; await saveCfg(); Rates.refresh().catch(() => {}).finally(renderMore); };
  $('#refreshRates').onclick = () => { toast('Обновляю курсы…'); Rates.refresh().then(() => { toast('Курсы обновлены ✓'); renderMore(); }).catch(e => toast('⚠ ' + e.message + ' — можно вписать курс вручную')); };
  document.querySelectorAll('[data-rate]').forEach(inp => inp.addEventListener('change', async () => {
    const code = inp.dataset.rate, v = parseFloat(inp.value.replace(/\s/g, '').replace(',', '.'));
    S.cfg.rateManual = S.cfg.rateManual || {};
    if (v > 0) S.cfg.rateManual[code] = { v, at: today() }; else delete S.cfg.rateManual[code];
    await saveCfg(); toast(v > 0 ? `Свой курс ${code}: ${v}` : `${code}: автоматический курс`); renderMore();
  }));
  $('#addAcc').onclick = async () => { let n = 'Новый счёт', i = 2; while (S.cfg.accounts.some(a => a.name === n)) n = 'Новый счёт ' + i++; S.cfg.accounts.push({ name: n, type: 'Карта', savings: false, start: 0, fact: null }); await saveCfg(); renderMore(); };
  document.querySelectorAll('[data-base]').forEach(inp => inp.addEventListener('change', async () => { const [ci, si] = inp.dataset.base.split('|').map(Number); S.cfg.exp[ci].subs[si].base = num(inp.value); await saveCfg(); toast('План сохранён'); }));
  document.querySelectorAll('[data-addsub]').forEach(btn => btn.onclick = async () => { const ci = +btn.dataset.addsub, v = $('#ns' + ci).value.trim(); if (!v) return; const c = S.cfg.exp[ci]; if (c.subs.some(s => s.name === v)) return toast('Уже есть'); c.subs.splice(c.subs.length - 1, 0, { name: v, oblig: 'Важный', char: 'Переменный', period: 'Ежемесячный', base: 0 }); await saveCfg(); renderMore(); });
  $('#addCat').onclick = async () => { const v = $('#newCat').value.trim(); if (!v || S.cfg.exp.some(c => c.cat === v)) return; S.cfg.exp.push({ cat: v, pocket: 'Повседневные расходы', subs: [{ name: 'Другое', oblig: 'Необязательный', char: 'Переменный', period: 'Нерегулярный', base: 0 }] }); await saveCfg(); renderMore(); };
  document.querySelectorAll('[data-catpocket]').forEach(sel => sel.addEventListener('change', async () => { S.cfg.exp[+sel.dataset.catpocket].pocket = sel.value; await saveCfg(); toast('Карман категории: ' + sel.value); }));
  const editPockets = async fn => { const list = JSON.parse(JSON.stringify(pockets())); const r = await fn(list); if (r === false) return renderMore(); S.cfg.pockets = list; await saveCfg(); renderMore(); };
  document.querySelectorAll('[data-pk]').forEach(inp => inp.addEventListener('change', () => editPockets(async list => {
    const p = list[+inp.dataset.pk];
    if (inp.dataset.k === 'kind') { p.kind = inp.value; toast('Тип: ' + POCKET_KINDS[p.kind].l); return; }
    const v = inp.value.trim(), old = p.name;
    if (!v || list.some(x => x !== p && x.name === v)) { toast('Такое имя уже есть или пустое'); return false; }
    p.name = v;
    for (const c of S.cfg.exp) if (c.pocket === old) c.pocket = v;
    for (const o of S.ops) if (isPocketOp(o) && (o.from === old || o.to === old)) { if (o.from === old) o.from = v; if (o.to === old) o.to = v; o.updatedAt = Date.now(); await DB.put(o); }
    toast('Сохранено');
  })));
  document.querySelectorAll('[data-delpk]').forEach(btn => btn.onclick = () => editPockets(async list => {
    const p = list[+btn.dataset.delpk];
    if (S.cfg.exp.some(c => c.pocket === p.name) || live().some(o => isPocketOp(o) && (o.from === p.name || o.to === p.name))) { toast('В этом кармане есть категории или деньги — сначала перенеси их, или переименуй карман'); return false; }
    if (!confirm('Удалить карман «' + p.name + '»?')) return false;
    list.splice(+btn.dataset.delpk, 1);
  }));
  $('#addPocket').onclick = () => editPockets(async list => {
    const v = $('#newPocket').value.trim(); if (!v || list.some(p => p.name === v)) return false;
    list.splice(list.findIndex(p => p.kind === 'buffer'), 0, { name: v, kind: 'saving' }); toast('Карман добавлен (накопительный — тип можно поменять)');
  });
  document.querySelectorAll('[data-person-i]').forEach(inp => inp.addEventListener('change', async () => {
    const p = S.cfg.people[+inp.dataset.personI], v = inp.value.trim();
    if (inp.dataset.k === 'role') {
      let role = v;
      if (role === '__custom') { role = (prompt('Своя роль (например, «Одногруппники»):', '') || '').trim(); if (!role) return renderMore(); }
      p.role = role || 'Другое'; await saveCfg(); toast('Роль: ' + p.role); return renderMore();
    }
    if (!v || S.cfg.people.some(x => x !== p && x.name === v)) { toast('Такое имя уже есть или пустое'); return renderMore(); }
    const old = p.name; p.name = v;
    for (const o of S.ops) if (o.person === old) { o.person = v; o.updatedAt = Date.now(); await DB.put(o); }
    await saveCfg(); toast('Сохранено'); renderMore();
  }));
  document.querySelectorAll('[data-delperson]').forEach(btn => btn.onclick = async () => {
    const p = S.cfg.people[+btn.dataset.delperson];
    if (live().some(o => o.person === p.name)) { toast('С этим человеком есть операции — удалить нельзя, можно переименовать'); return; }
    if (!confirm('Удалить «' + p.name + '» из списка?')) return;
    S.cfg.people.splice(+btn.dataset.delperson, 1); await saveCfg(); renderMore();
  });
  $('#addPerson').onclick = async () => { const v = $('#newPerson').value.trim(); if (!v || S.cfg.people.some(p => p.name === v)) return; S.cfg.people.push({ name: v, role: 'Другое' }); await saveCfg(); renderMore(); };
  $('#syncNow').onclick = () => Sync.run(true).then(n => { toast(n ? `Синхронизировано: подтянуто изменений — ${n}` : 'Синхронизировано ✓'); renderMore(); }).catch(e => { toast('⚠ ' + e.message); renderMore(); });
  if ($('#syncOff')) $('#syncOff').onclick = () => { if (!confirm('Отключить синхронизацию на этом устройстве? Данные останутся и здесь, и в Google Диске.')) return; Sync.off(); renderMore(); };
  $('#exportCsv').onclick = exportCsv;
  $('#openReport').onclick = () => setTab('report');
  document.querySelectorAll('[data-delfav]').forEach(b => b.onclick = async () => { const f = S.cfg.favs[+b.dataset.delfav]; if (!confirm(`Убрать «${qLabel(f)}» из избранного?`)) return; S.cfg.favs.splice(+b.dataset.delfav, 1); await saveCfg(); renderMore(); });
  if ($('#pinSet')) $('#pinSet').onclick = () => Lock.setup().then(renderMore);
  if ($('#pinChange')) $('#pinChange').onclick = async () => { if (await Lock.askCurrent()) Lock.setup().then(renderMore); };
  if ($('#pinOff')) $('#pinOff').onclick = async () => { if (await Lock.askCurrent()) { Lock.clear(); toast('PIN-код убран'); renderMore(); } };
  $('#backup').onclick = () => download(`жизнь-копия-${today()}.json`, JSON.stringify({ app: 'zhizn', v: 1, at: new Date().toISOString(), cfg: S.cfg, ops: S.ops, life: S.life }, null, 1), 'application/json');
  $('#restore').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); if (data.app !== 'zhizn') throw new Error('не тот файл');
      if (!confirm(`Восстановить ${data.ops.length} операций из копии от ${data.at.slice(0, 10)}? Текущие данные будут объединены с копией.`)) return;
      for (const o of data.ops) { const cur = S.ops.find(x => x.id === o.id); if (!cur || (o.updatedAt || 0) > (cur.updatedAt || 0)) { await DB.put(o); } }
      if ((data.cfg.updatedAt || 0) > (S.cfg.updatedAt || 0)) { S.cfg = data.cfg; await DB.set('cfg', S.cfg); }
      if (data.life) mergeLife(data.life);
      S.ops = await DB.all(); toast('Восстановлено'); Sync.soon(); renderMore();
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
  };
}
// Таблица курсов: валюты, которые есть в счетах (или основные, если других нет)
function ratesTable() {
  const codes = Rates.used().length ? Rates.used() : ['USD', 'EUR', 'RUB', 'XAU'].filter(c => c !== baseCur());
  const bs = CUR[baseCur()].sym;
  return `<table class="t" style="margin-top:8px"><tr><th>Валюта</th><th>Авто</th><th>Свой курс</th></tr>${codes.map(c => {
    const a = Rates.auto(c), m = Rates.manual(c), unit = isMetal(c) ? '1 г ' + (c === 'XAU' ? 'золота' : 'серебра') : '1 ' + (CUR[c].sym);
    return `<tr><td>${esc(unit)}</td><td>${a ? (+a.toFixed(a < 10 ? 4 : 2)).toLocaleString('ru-RU') + ' ' + esc(bs) : '—'}</td><td><input class="mini" data-rate="${c}" inputmode="decimal" value="${m ?? ''}" placeholder="авто"></td></tr>`;
  }).join('')}</table>`;
}
const ROLES = ['Семья', 'Друзья', 'Отношения', 'Банк', 'Работа', 'Учёба', 'Другое'];
function roleOptions(cur) {
  const list = [...new Set([...ROLES, ...S.cfg.people.map(p => p.role).filter(Boolean)])];
  return list.map(r => `<option ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('') + '<option value="__custom">✎ Своя роль…</option>';
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function exportCsv() {
  const head = ['Дата', 'Тип', 'Счёт', 'Валюта', 'Категория', 'Подкатегория', 'Сумма', 'Курс', 'Сумма в ' + baseCur(), 'Получила (обмен)', 'Человек', 'Получатель', 'Комментарий'];
  const dec = v => (v === '' || v === undefined || v === null) ? '' : String(r2(v)).replace('.', ',');
  const rows = live().filter(o => !isPocketOp(o)).sort((a, b) => a.date.localeCompare(b.date)).map(o => [o.date.split('-').reverse().join('.'), o.type, o.account, curOf(o.account), o.cat, o.sub, dec(o.amount), o.rate ? String(o.rate).replace('.', ',') : '', TYPE[o.type] && !TYPE[o.type].to ? dec(opBase(o)) : '', o.amountTo ? dec(o.amountTo) + ' ' + curOf(o.to) : '', o.person, o.to, o.comment]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
  download(`операции-${today()}.csv`, csv, 'text/csv');
}

// ---------- Синхронизация через Google Диск ----------
// Все данные лежат одним файлом в скрытой папке приложения (appDataFolder) на Google Диске пользователя.
// Синхронизация: скачать файл → объединить с данными устройства (по id, побеждает более позднее изменение) → загрузить обратно.
// Ничего не теряется: каждое устройство хранит свою копию и при следующей синхронизации снова объединит всё.
const GOOGLE_CLIENT_ID = '973066398697-p3o4kuaquntmksm4kf5o30e2a3rnb18k.apps.googleusercontent.com';
const Sync = {
  file: 'zhizn-data.json', token: null, exp: 0, busy: false, timer: null,
  state() { try { return JSON.parse(localStorage.getItem('zhizn-sync') || '{}'); } catch (e) { return {}; } },
  setState(p) { try { localStorage.setItem('zhizn-sync', JSON.stringify({ ...this.state(), ...p })); } catch (e) {} },
  enabled() { return !!this.state().on; },
  off() { this.setState({ on: false }); this.token = null; try { sessionStorage.removeItem('zhizn-token'); } catch (e) {} this.mark('off'); },
  loadGis() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error('нет связи с Google — проверь интернет')); document.head.appendChild(s);
    });
  },
  async getToken(interactive) {
    if (this.token && Date.now() < this.exp - 60000) return this.token;
    try { const t = JSON.parse(sessionStorage.getItem('zhizn-token') || 'null'); if (t && Date.now() < t.exp - 60000) { this.token = t.v; this.exp = t.exp; return this.token; } } catch (e) {}
    if (!interactive) return null;
    await this.loadGis();
    return new Promise((res, rej) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: r => {
          if (r.error) return rej(new Error(r.error_description || r.error));
          this.token = r.access_token; this.exp = Date.now() + (r.expires_in || 3600) * 1000;
          try { sessionStorage.setItem('zhizn-token', JSON.stringify({ v: this.token, exp: this.exp })); } catch (e) {}
          res(this.token);
        },
        error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'окно входа закрыто' : (e && (e.message || e.type)) || 'вход не выполнен')),
      });
      client.requestAccessToken({ prompt: this.enabled() ? '' : 'consent' });
    });
  },
  async api(url, opt = {}) {
    const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + this.token, ...(opt.headers || {}) } });
    if (r.status === 401) { this.token = null; try { sessionStorage.removeItem('zhizn-token'); } catch (e) {} throw new Error('нужно войти в Google заново'); }
    if (!r.ok) throw new Error('Google Диск ответил ошибкой ' + r.status);
    return r;
  },
  async run(interactive) {
    if (this.busy) return 0;
    const tok = await this.getToken(interactive);
    if (!tok) { this.mark('wait'); return 0; }
    this.busy = true; this.mark('busy');
    try {
      const q = encodeURIComponent(`name='${this.file}'`);
      const list = await (await this.api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json();
      const f = list.files && list.files[0];
      let changed = 0;
      if (f) changed = await mergeData(await (await this.api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).json());
      const body = JSON.stringify({ app: 'zhizn', v: 1, at: new Date().toISOString(), device: DEVICE, cfg: S.cfg, ops: S.ops, life: S.life });
      if (f) await this.api(`https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      else {
        const fd = new FormData();
        fd.append('metadata', new Blob([JSON.stringify({ name: this.file, parents: ['appDataFolder'] })], { type: 'application/json' }));
        fd.append('file', new Blob([body], { type: 'application/json' }));
        await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', body: fd });
      }
      this.setState({ on: true, last: Date.now(), err: '' }); this.mark('ok');
      if (changed && S.tab !== 'add') render();
      return changed;
    } catch (e) { this.setState({ err: e.message }); this.mark('err'); throw e; }
    finally { this.busy = false; }
  },
  soon() { if (!this.enabled()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(false).catch(() => {}), 1500); },
  mark(st) {
    const el = $('#syncDot'); if (!el) return;
    const m = { ok: ['☁ ✓', 'Синхронизировано'], busy: ['☁ …', 'Синхронизация…'], err: ['☁ !', 'Ошибка синхронизации — нажми, чтобы повторить'], wait: ['☁ ↻', 'Нажми, чтобы синхронизировать'] }[st];
    el.textContent = m ? m[0] : ''; el.title = m ? m[1] : ''; el.dataset.st = st; el.style.display = m ? '' : 'none';
  },
};
async function mergeData(data) {
  if (!data || data.app !== 'zhizn') throw new Error('в Google Диске чужой файл');
  let n = 0;
  for (const o of data.ops || []) {
    const i = S.ops.findIndex(x => x.id === o.id);
    if (i < 0 || (o.updatedAt || 0) > (S.ops[i].updatedAt || 0)) { await DB.put(o); if (i < 0) S.ops.push(o); else S.ops[i] = o; n++; }
  }
  if (data.cfg && (data.cfg.updatedAt || 0) > (S.cfg.updatedAt || 0)) { S.cfg = data.cfg; await DB.set('cfg', S.cfg); n++; }
  if (data.life) n += mergeLife(data.life);
  return n;
}
function syncInfo() {
  const st = Sync.state();
  if (!st.on) return 'Синхронизация выключена. Подключи Google Диск, чтобы телефон и ноутбук видели одни данные.';
  const last = st.last ? new Date(st.last).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
  return `☁ Google Диск подключён · последняя синхронизация: ${last}` + (st.err ? `<div class="err">⚠ ${esc(st.err)}</div>` : '');
}

// ---------- PIN-код на вход (только это устройство) ----------
// Это замок экрана, а не шифрование: в localStorage хранится соль и SHA-256 от PIN, сам PIN нигде не хранится.
const Lock = {
  key: 'zhizn-pin', hiddenAt: 0, open: false,
  get() { try { return JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { return null; } },
  has() { return !!this.get(); },
  async hash(pin, salt) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); },
  async set(pin) { const salt = uid(); localStorage.setItem(this.key, JSON.stringify({ salt, len: pin.length, hash: await this.hash(pin, salt) })); },
  clear() { try { localStorage.removeItem(this.key); } catch (e) {} },
  async check(pin) { const st = this.get(); return !!st && (await this.hash(pin, st.salt)) === st.hash; },
  // Окно ввода PIN (цифровая клавиатура). Возвращает введённый PIN или null (отмена).
  pad(title, len, cancel, forgot) {
    return new Promise(res => {
      const el = document.createElement('div'); el.className = 'lock'; let v = '';
      const draw = msg => {
        el.innerHTML = `<div class="lock-box"><div style="font-size:34px">🔒</div><b style="font-size:17px">${esc(title)}</b>
          <div class="pin-dots">${Array.from({ length: len || Math.max(4, v.length) }, (_, i) => `<i class="${i < v.length ? 'on' : ''}"></i>`).join('')}</div>
          <div class="err" style="min-height:18px;margin:0">${msg || ''}</div>
          <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'ok', 0, '⌫'].map(k => k === 'ok' ? (len ? '<span></span>' : `<button data-pk="ok" class="kok">✓</button>`) : `<button data-pk="${k}">${k}</button>`).join('')}</div>
          ${cancel ? '<button class="ghost" data-pk="cancel" style="font-size:14px;margin-top:6px">Отмена</button>' : ''}
          ${forgot ? '<button class="ghost" data-pk="forgot" style="font-size:13px;margin-top:6px">Забыла PIN</button>' : ''}</div>`;
        el.querySelectorAll('[data-pk]').forEach(b => b.onclick = () => press(b.dataset.pk));
      };
      const done = val => { document.removeEventListener('keydown', kd); el.remove(); res(val); };
      const press = k => {
        if (k === 'cancel') return done(null);
        if (k === 'forgot') return done('__forgot');
        if (k === '⌫') v = v.slice(0, -1);
        else if (k === 'ok') { if (v.length >= 4) return done(v); }
        else if (v.length < 6) v += k;
        draw(); if (len && v.length === len) setTimeout(() => done(v), 120);
      };
      const kd = e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Enter') press('ok'); else if (e.key === 'Escape' && cancel) press('cancel'); };
      document.addEventListener('keydown', kd);
      el.redraw = draw; draw(); document.body.appendChild(el); res.el = el;
    });
  },
  // Замок при входе: пока PIN не верный — дальше не пускает
  async show() {
    if (this.open || !this.has()) return; this.open = true;
    let tries = 0;
    for (;;) {
      const pin = await this.pad('Введи PIN-код', this.get().len, false, true);
      if (pin === '__forgot') { if (await this.forgot()) return; continue; }
      if (await this.check(pin)) { this.open = false; return; }
      tries++; toast(tries >= 5 ? '⚠ Неверный PIN. Подожди 30 секунд' : '⚠ Неверный PIN');
      if (tries >= 5) { await new Promise(r => setTimeout(r, 30000)); tries = 0; }
    }
  },
  async forgot() {
    const synced = Sync.enabled();
    if (!confirm(`Сбросить PIN? Для этого данные на ЭТОМ устройстве будут удалены.\n\n${synced ? 'Синхронизация с Google Диском включена — после входа в Google данные вернутся.' : '⚠ Синхронизация с Google Диском не включена — без резервной копии данные пропадут навсегда.'}`)) return false;
    if (!synced && !confirm('Точно удалить все данные на этом устройстве? Это нельзя отменить.')) return false;
    this.clear(); try { DB.db && DB.db.close(); } catch (e) {}
    await new Promise(r => { const q = indexedDB.deleteDatabase('zhizn'); q.onsuccess = q.onerror = q.onblocked = r; });
    location.reload(); return true;
  },
  async askCurrent() {
    const pin = await this.pad('Текущий PIN', this.get().len, true, false); if (pin === null) return false;
    if (await this.check(pin)) return true; toast('⚠ Неверный PIN'); return false;
  },
  async setup() {
    const p1 = await this.pad('Новый PIN: 4–6 цифр, потом ✓', 0, true, false); if (p1 === null) return;
    const p2 = await this.pad('Повтори PIN', p1.length, true, false); if (p2 === null) return;
    if (p1 !== p2) { toast('⚠ PIN-коды не совпали — попробуй ещё раз'); return; }
    await this.set(p1); toast('🔒 PIN-код включён на этом устройстве');
  },
};

// ---------- Запуск ----------
(async function init() {
  try {
    await DB.open();
    S.ops = await DB.all();
    S.cfg = (await DB.get('cfg')) || defaultCfg();
    if (!(await DB.get('cfg'))) await DB.set('cfg', S.cfg);
    S.life = (await DB.get('life')) || { days: {}, tasks: [] };
  } catch (e) {
    $('#view').innerHTML = '<div class="warn">Не удалось открыть хранилище на устройстве. Проверь, что браузер не в режиме инкогнито.</div>'; return;
  }
  if (Lock.has()) await Lock.show();
  await Rates.load();
  if ((Rates.used().length || !Rates.data) && Rates.stale() && navigator.onLine !== false) Rates.refresh().then(() => { if (S.tab !== 'add') render(); }).catch(() => {});
  const t = today(); S.month = t < S.cfg.startDate ? mkey(S.cfg.startDate) : mkey(t);
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { if (b.dataset.tab === 'add') return plusMenu(); setTab(b.dataset.tab === 'fin' ? 'overview' : b.dataset.tab); });
  $('#mPrev').onclick = () => { S.month = mshift(S.month, -1); render(); };
  $('#mNext').onclick = () => { S.month = mshift(S.month, 1); render(); };
  render();
  Sync.mark(Sync.enabled() ? 'wait' : 'off');
  $('#syncDot').onclick = () => Sync.run(true).then(n => toast(n ? `Синхронизировано: подтянуто изменений — ${n}` : 'Синхронизировано ✓')).catch(e => toast('⚠ ' + e.message));
  if (Sync.enabled()) Sync.run(false).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { Lock.hiddenAt = Date.now(); return; }
    if (Lock.has() && Lock.hiddenAt && Date.now() - Lock.hiddenAt > 60000) Lock.show();
    if (Sync.enabled()) Sync.run(false).catch(() => {});
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
