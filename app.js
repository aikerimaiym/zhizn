'use strict';
/* Жизнь — раздел «Финансы», MVP (этап 1).
   Данные хранятся на устройстве (IndexedDB). Каждая операция — запись с уникальным id и временем изменения,
   поэтому позже их можно безопасно объединять между устройствами через OneDrive. */

// ---------- Типы операций ----------
const TYPES = [
  { t: 'Расход', sign: -1, grp: 'exp', person: false, to: false, hint: 'Трата — идёт в бюджет' },
  { t: 'Доход', sign: 1, grp: 'inc', person: false, to: false, hint: 'Свой доход: стипендия, зарплата, проекты' },
  { t: 'Помощь', sign: 1, grp: '', person: true, to: false, hint: 'Деньги от людей — не свой доход' },
  { t: 'Перевод между счетами', sign: -1, grp: '', person: false, to: true, hint: 'Общий баланс не меняется' },
  { t: 'Заём получен', sign: 1, grp: '', person: true, to: false, hint: 'Мне дали в долг' },
  { t: 'Заём выдан', sign: -1, grp: '', person: true, to: false, hint: 'Я дала в долг' },
  { t: 'Мне вернули долг', sign: 1, grp: '', person: true, to: false, hint: '' },
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
const money = n => (Math.round(n) || 0).toLocaleString('ru-RU') + ' ₸';
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
const S = { ops: [], cfg: null, month: '2026-12', tab: 'overview', edit: null, draft: null, q: '' };
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

// ---------- Проверка операции ----------
function validate(o) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) return 'Укажи дату';
  if (o.date < S.cfg.startDate) return 'Дата раньше начала учёта (' + S.cfg.startDate.split('-').reverse().join('.') + ')';
  const T = TYPE[o.type]; if (!T) return 'Выбери тип';
  if (!(o.amount > 0)) return 'Сумма должна быть больше нуля';
  if (!S.cfg.accounts.some(a => a.name === o.account)) return 'Выбери счёт';
  if (T.grp === 'exp' && !S.cfg.exp.some(c => c.cat === o.cat && c.subs.some(s => s.name === o.sub))) return 'Выбери категорию и подкатегорию';
  if (T.grp === 'inc' && !S.cfg.inc.some(c => c.cat === o.cat && c.subs.includes(o.sub))) return 'Выбери категорию дохода';
  if (T.person && !o.person) return 'Выбери человека';
  if (T.to && (!S.cfg.accounts.some(a => a.name === o.to) || o.to === o.account)) return 'Выбери другой счёт-получатель';
  return '';
}

// ---------- Расчёты ----------
function balances(uptoMonth) {
  const b = Object.fromEntries(S.cfg.accounts.map(a => [a.name, +a.start || 0]));
  for (const o of live()) {
    if (validate(o)) continue;
    if (uptoMonth && mkey(o.date) > uptoMonth) continue;
    const T = TYPE[o.type];
    if (b[o.account] !== undefined) b[o.account] += T.sign * o.amount;
    if (T.to && b[o.to] !== undefined) b[o.to] += o.amount;
  }
  return b;
}
function sumType(type, month) { return live().filter(o => o.type === type && mkey(o.date) === month && !validate(o)).reduce((s, o) => s + o.amount, 0); }
function planFor(month, cat, sub) {
  const p = S.cfg.plans.filter(x => x.month === month && x.cat === cat && x.sub === sub);
  if (p.length) return p.reduce((s, x) => s + (+x.amount || 0), 0);
  const c = S.cfg.exp.find(c => c.cat === cat); const s = c && c.subs.find(s => s.name === sub);
  return s ? (+s.base || 0) : 0;
}
function budget(month) {
  const fact = {};
  for (const o of live()) if (o.type === 'Расход' && mkey(o.date) === month && !validate(o)) { const k = o.cat + '|' + o.sub; fact[k] = (fact[k] || 0) + o.amount; }
  const cats = S.cfg.exp.map(c => {
    const subs = c.subs.map(s => { const plan = planFor(month, c.cat, s.name), f = fact[c.cat + '|' + s.name] || 0; return { name: s.name, oblig: s.oblig, plan, fact: f, diff: plan - f }; });
    const plan = subs.reduce((a, s) => a + s.plan, 0), f = subs.reduce((a, s) => a + s.fact, 0);
    return { cat: c.cat, pocket: c.pocket, subs, plan, fact: f, diff: plan - f };
  });
  const plan = cats.reduce((a, c) => a + c.plan, 0), f = cats.reduce((a, c) => a + c.fact, 0);
  return { cats, plan, fact: f, diff: plan - f };
}

// ---------- Навигация ----------
function setTab(t) { S.tab = t; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); render(); window.scrollTo(0, 0); }
function render() {
  $('#mLabel').textContent = mlabel(S.month);
  $('#monthBar').style.visibility = (S.tab === 'add' || S.tab === 'more') ? 'hidden' : 'visible';
  ({ overview: renderOverview, history: renderHistory, add: renderAdd, budget: renderBudget, more: renderMore })[S.tab]();
}

// ---------- Обзор ----------
function renderOverview() {
  const m = S.month, b = balances(m);
  const total = Object.values(b).reduce((a, x) => a + x, 0);
  const sav = S.cfg.accounts.filter(a => a.savings).reduce((a, x) => a + b[x.name], 0);
  const inc = sumType('Доход', m), help = sumType('Помощь', m), exp = sumType('Расход', m);
  const prevExp = sumType('Расход', mshift(m, -1));
  const bud = budget(m);
  const saldo = inc + help - exp;
  const errs = live().filter(o => validate(o)).length;
  const over = bud.cats.filter(c => c.plan > 0 && c.fact > c.plan);
  const warns = [];
  if (errs) warns.push(['warn', `⚠ Операций с ошибками: ${errs} — открой «Историю», они не в итогах`]);
  over.forEach(c => warns.push(['warn', `⚠ Перерасход: ${c.cat} — ${money(c.fact - c.plan)} сверх плана`]));
  S.cfg.accounts.filter(a => a.fact !== null && a.fact !== '' && Math.round(+a.fact) !== Math.round(balances()[a.name])).forEach(a => warns.push(['warn', `⚠ ${a.name}: в банке ${money(+a.fact)}, по учёту ${money(balances()[a.name])}`]));
  if (!bud.plan) warns.push(['info', 'ℹ План на месяц пуст — задай «План в месяц» в разделе «Ещё → Категории»']);
  if (!S.cfg.accounts.some(a => +a.start)) warns.push(['info', 'ℹ Укажи начальные остатки счетов: «Ещё → Счета»']);
  if (!warns.length) warns.push(['ok', '✓ Всё в порядке']);
  const topCats = bud.cats.filter(c => c.plan || c.fact).sort((a, b) => b.fact - a.fact);
  const people = S.cfg.people.map(p => ({ p: p.name, v: live().filter(o => o.person === p.name && mkey(o.date) === m && !validate(o) && TYPE[o.type].sign > 0).reduce((s, o) => s + o.amount, 0) })).filter(x => x.v);
  $('#view').innerHTML = `
  <div class="cards">
    <div class="kpi blue"><div class="l">Всего денег</div><div class="v">${money(total)}</div><div class="s">на конец месяца</div></div>
    <div class="kpi lilac"><div class="l">Свободно</div><div class="v">${money(total - sav)}</div><div class="s">без накоплений · карманы — этап 2</div></div>
    <div class="kpi green"><div class="l">Накопления</div><div class="v">${money(sav)}</div><div class="s">&nbsp;</div></div>
    <div class="kpi powder"><div class="l">Сальдо месяца</div><div class="v ${saldo < 0 ? 'neg' : ''}">${money(saldo)}</div><div class="s">отложено ${inc + help ? pct(saldo / (inc + help)) : '–'}</div></div>
  </div>
  <h2>Месяц</h2>
  <div class="card">
    <div class="row"><span>Доходы (свои)</span><b class="pos">${money(inc)}</b></div>
    <div class="row"><span>Помощь</span><b>${money(help)}</b></div>
    <div class="row"><span>Расходы</span><b class="neg">${money(exp)}</b></div>
    <div class="row"><span class="sub">к прошлому месяцу</span><span class="sub">${prevExp ? (exp >= prevExp ? '+' : '') + pct(exp / prevExp - 1) + ' расходов' : '–'}</span></div>
  </div>
  <h2>Внимание</h2>${warns.map(([c, t]) => `<div class="${c}">${esc(t)}</div>`).join('')}
  <h2>Бюджет по категориям</h2>
  <div class="card">${topCats.length ? topCats.map(catBar).join('') : '<div class="row muted">Пока нет плана и расходов</div>'}</div>
  <h2>Счета</h2>
  <div class="card">${S.cfg.accounts.map(a => `<div class="row"><span>${esc(a.name)}${a.savings ? ' <span class="sub">· накопления</span>' : ''}</span><b class="${b[a.name] < 0 ? 'neg' : ''}">${money(b[a.name])}</b></div>`).join('')}</div>
  ${people.length ? `<h2>Деньги от людей</h2><div class="card">${people.map(x => `<div class="row"><span>${esc(x.p)}</span><b>${money(x.v)}</b></div>`).join('')}</div>` : ''}`;
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
  const q = S.q.toLowerCase();
  const list = live().filter(o => mkey(o.date) === S.month).filter(o => !q || [o.type, o.cat, o.sub, o.person, o.comment, o.account, String(o.amount)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  let html = `<input class="in search" id="q" placeholder="Поиск: категория, комментарий, сумма…" value="${esc(S.q)}">`;
  let day = '';
  if (!list.length) html += '<div class="card"><div class="row muted">В этом месяце операций нет. Нажми «+».</div></div>';
  for (const o of list) {
    if (o.date !== day) { if (day) html += '</div>'; day = o.date; const d = new Date(o.date + 'T00:00'); html += `<div class="day">${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}</div><div class="card">`; }
    const T = TYPE[o.type], err = validate(o);
    const sign = !T ? '' : T.to ? '⇄ ' : T.sign > 0 ? '+' : '−';
    const what = T && T.grp ? `${o.cat} · ${o.sub}` : (o.person || (T && T.to ? `${o.account} → ${o.to}` : o.type));
    html += `<div class="row" data-id="${o.id}" style="cursor:pointer"><div><div class="t">${esc(what)}</div><div class="sub">${esc(o.type)} · ${esc(o.account)}${o.comment ? ' · ' + esc(o.comment) : ''}${err ? ' · <span class="neg">⚠ ' + esc(err) + '</span>' : ''}</div></div><b class="${T && !T.to ? (T.sign > 0 ? 'pos' : 'neg') : ''}">${sign}${money(o.amount)}</b></div>`;
  }
  if (day) html += '</div>';
  $('#view').innerHTML = html;
  $('#q').addEventListener('input', e => { S.q = e.target.value; const p = e.target.selectionStart; renderHistory(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); });
  document.querySelectorAll('[data-id]').forEach(r => r.addEventListener('click', () => { const o = S.ops.find(x => x.id === r.dataset.id); S.edit = o.id; S.draft = { ...o }; setTab('add'); }));
}

// ---------- Новая операция / правка ----------
function newDraft() { return { type: 'Расход', date: today(), account: (S.cfg.accounts.some(a => a.name === lastAcc.get()) ? lastAcc.get() : S.cfg.accounts[0].name), cat: '', sub: '', amount: '', person: '', to: '', comment: '' }; }
function renderAdd() {
  if (!S.draft) S.draft = newDraft();
  const d = S.draft, T = TYPE[d.type];
  const cats = T.grp === 'exp' ? S.cfg.exp.map(c => c.cat) : T.grp === 'inc' ? S.cfg.inc.map(c => c.cat) : [];
  const subs = T.grp === 'exp' ? ((S.cfg.exp.find(c => c.cat === d.cat) || {}).subs || []).map(s => s.name) : T.grp === 'inc' ? ((S.cfg.inc.find(c => c.cat === d.cat) || {}).subs || []) : [];
  const freq = {}; live().forEach(o => { if (o.type === d.type && o.cat) freq[o.cat] = (freq[o.cat] || 0) + 1; });
  cats.sort((a, b) => (freq[b] || 0) - (freq[a] || 0));
  const accOpts = S.cfg.accounts.map(a => `<option ${a.name === d.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  $('#view').innerHTML = `
  <h2>${S.edit ? 'Правка операции' : 'Новая операция'}</h2>
  <div class="seg">${TYPES.slice(0, 4).map(x => `<button class="chip ${x.t === d.type ? 'on' : ''}" data-type="${x.t}">${x.t === 'Перевод между счетами' ? 'Перевод' : x.t}</button>`).join('')}
    <select class="chip" id="moreType" style="padding:6px 10px"><option value="">Ещё…</option>${TYPES.slice(4).map(x => `<option ${x.t === d.type ? 'selected' : ''}>${x.t}</option>`).join('')}</select></div>
  <div class="muted" style="margin-top:6px">${esc(T.hint)}</div>
  <input class="amount" id="amount" inputmode="decimal" placeholder="0 ₸" value="${d.amount}">
  ${cats.length ? `<label class="f">Категория</label><div class="tiles">${cats.map(c => `<div class="tile ${c === d.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</div>`).join('')}</div>` : ''}
  ${subs.length ? `<label class="f">Подкатегория</label><div class="seg">${subs.map(s => `<button class="chip ${s === d.sub ? 'on' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
  ${T.person ? `<label class="f">Человек</label><div class="seg">${S.cfg.people.map(p => `<button class="chip ${p.name === d.person ? 'on' : ''}" data-person="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
  <div class="grid2"><div><label class="f">${T.to ? 'Со счёта' : 'Счёт'}</label><select class="in" id="account">${accOpts}</select></div>
    <div><label class="f">Дата</label><input class="in" type="date" id="date" value="${d.date}"></div></div>
  ${T.to ? `<label class="f">На счёт</label><select class="in" id="to"><option value="">—</option>${S.cfg.accounts.map(a => `<option ${a.name === d.to ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
  <label class="f">Комментарий</label><input class="in" id="comment" value="${esc(d.comment)}" placeholder="необязательно">
  <div class="err" id="err"></div>
  <button class="btn" id="save">${S.edit ? 'Сохранить изменения' : 'Сохранить'}</button>
  ${S.edit ? '<button class="btn danger" id="del">Удалить операцию</button>' : ''}
  <button class="btn light" id="cancel">Отмена</button>`;
  const sync = () => { d.amount = $('#amount').value; d.account = $('#account').value; d.date = $('#date').value; d.comment = $('#comment').value; if ($('#to')) d.to = $('#to').value; };
  document.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { sync(); d.type = b.dataset.type; d.cat = ''; d.sub = ''; renderAdd(); });
  $('#moreType').onchange = e => { if (!e.target.value) return; sync(); d.type = e.target.value; d.cat = ''; d.sub = ''; renderAdd(); };
  document.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { sync(); d.cat = b.dataset.cat; d.sub = ''; renderAdd(); });
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { sync(); d.sub = b.dataset.sub; renderAdd(); });
  document.querySelectorAll('[data-person]').forEach(b => b.onclick = () => { sync(); d.person = b.dataset.person; renderAdd(); });
  $('#cancel').onclick = () => { const back = S.edit ? 'history' : 'overview'; S.draft = null; S.edit = null; setTab(back); };
  $('#save').onclick = async () => {
    sync();
    const T2 = TYPE[d.type];
    const op = { ...d, amount: Math.round(parseFloat(String(d.amount).replace(/\s/g, '').replace(',', '.')) * 100) / 100 };
    if (!T2.grp) { op.cat = ''; op.sub = ''; } if (!T2.person) op.person = ''; if (!T2.to) op.to = '';
    const err = validate(op); if (err) { $('#err').textContent = '⚠ ' + err; return; }
    const now = Date.now();
    if (S.edit) { Object.assign(op, { id: S.edit, updatedAt: now, device: DEVICE }); const i = S.ops.findIndex(x => x.id === S.edit); op.createdAt = S.ops[i].createdAt; S.ops[i] = op; }
    else { Object.assign(op, { id: uid(), createdAt: now, updatedAt: now, device: DEVICE, deleted: false }); S.ops.push(op); }
    await DB.put(op);
    lastAcc.set(op.account); Sync.soon();
    S.month = mkey(op.date);
    toast(afterSaveText(op));
    S.draft = null; const wasEdit = !!S.edit; S.edit = null;
    setTab(wasEdit ? 'history' : 'overview');
  };
  if ($('#del')) $('#del').onclick = async () => {
    if (!confirm('Удалить эту операцию? Её можно будет восстановить только из резервной копии.')) return;
    const i = S.ops.findIndex(x => x.id === S.edit); S.ops[i] = { ...S.ops[i], deleted: true, updatedAt: Date.now(), device: DEVICE }; await DB.put(S.ops[i]); Sync.soon();
    toast('Операция удалена'); S.draft = null; S.edit = null; setTab('history');
  };
  if (!S.edit) setTimeout(() => $('#amount').focus(), 50);
}
function afterSaveText(o) {
  const T = TYPE[o.type];
  const bal = balances()[o.account];
  if (o.type === 'Расход') {
    const m = mkey(o.date), c = budget(m).cats.find(x => x.cat === o.cat);
    const tail = c && c.plan ? (c.plan - c.fact >= 0 ? `${o.cat}: осталось ${money(c.plan - c.fact)} из ${money(c.plan)}` : `${o.cat}: перерасход ${money(c.fact - c.plan)}`) : `${o.cat}: без плана`;
    return `${o.sub} −${money(o.amount)} · ${tail} · ${o.account}: ${money(bal)}`;
  }
  if (T.to) return `Перевод ${money(o.amount)}: ${o.account} → ${o.to}`;
  return `${o.type} ${T.sign > 0 ? '+' : '−'}${money(o.amount)} · ${o.account}: ${money(bal)}`;
}

// ---------- Бюджет ----------
function renderBudget() {
  const b = budget(S.month);
  $('#view').innerHTML = `
  <div class="cards"><div class="kpi lilac"><div class="l">План</div><div class="v">${money(b.plan)}</div></div>
  <div class="kpi powder"><div class="l">Факт</div><div class="v">${money(b.fact)}</div></div>
  <div class="kpi ${b.diff < 0 ? 'powder' : 'green'}"><div class="l">${b.diff < 0 ? 'Перерасход' : 'Экономия'}</div><div class="v ${b.diff < 0 ? 'neg' : ''}">${money(Math.abs(b.diff))}</div></div>
  <div class="kpi blue"><div class="l">Исполнение</div><div class="v">${b.plan ? pct(b.fact / b.plan) : '–'}</div></div></div>
  <p class="muted">План на месяц берётся из «План в месяц» (Ещё → Категории). Для особого месяца нажми на сумму плана подкатегории и введи другую — изменится только этот месяц.</p>
  ${b.cats.map(c => `<details class="card" ${c.fact ? 'open' : ''}><summary>${esc(c.cat)} <span class="sub" style="float:right">${money(c.fact)} / ${money(c.plan)}</span></summary>
    <table class="t"><tr><th>Подкатегория</th><th>План</th><th>Факт</th><th>Остаток</th></tr>
    ${c.subs.map(s => `<tr><td>${esc(s.name)}</td><td><input class="mini" data-plan="${esc(c.cat)}|${esc(s.name)}" value="${s.plan || ''}" inputmode="numeric" placeholder="0"></td><td>${s.fact ? money(s.fact) : '–'}</td><td class="${s.diff < 0 ? 'neg' : ''}">${s.plan || s.fact ? money(s.diff) : '–'}</td></tr>`).join('')}
    </table></details>`).join('')}`;
  document.querySelectorAll('[data-plan]').forEach(inp => inp.addEventListener('change', async () => {
    const [cat, sub] = inp.dataset.plan.split('|'); const v = +inp.value || 0;
    S.cfg.plans = S.cfg.plans.filter(p => !(p.month === S.month && p.cat === cat && p.sub === sub));
    const base = planFor(S.month, cat, sub);
    if (v !== base) S.cfg.plans.push({ month: S.month, cat, sub, amount: v });
    await saveCfg(); toast(`План «${sub}» на ${mlabel(S.month)}: ${money(v)}`); renderBudget();
  }));
}

// ---------- Ещё: счета, категории, люди, данные ----------
function renderMore() {
  const b = balances();
  $('#view').innerHTML = `
  <h2>Счета</h2>
  <div class="card" style="padding:10px 12px"><label class="f" style="margin-top:0">Дата начала учёта</label>
    <input class="in" type="date" id="startDate" value="${S.cfg.startDate}">
    <div class="muted" style="margin-top:4px">Начальные остатки вводятся на эту дату. Операции раньше неё не считаются — чтобы деньги не учлись дважды.</div></div>
  <div class="card">${S.cfg.accounts.map((a, i) => `<div class="row" style="display:block">
    <div style="display:flex;justify-content:space-between"><b>${esc(a.name)}</b><span>${money(b[a.name])}</span></div>
    <div class="grid2"><div><label class="f">Начальный остаток на ${S.cfg.startDate.split('-').reverse().join('.')}</label><input class="in" data-acc="${i}" data-k="start" inputmode="numeric" value="${a.start || ''}" placeholder="0"></div>
    <div><label class="f">Факт по банку (для сверки)</label><input class="in" data-acc="${i}" data-k="fact" inputmode="numeric" value="${a.fact ?? ''}" placeholder="—"></div></div>
    <label class="f"><input type="checkbox" data-acc="${i}" data-k="savings" ${a.savings ? 'checked' : ''}> это накопления</label>
    <div class="grid2"><input class="in" data-acc="${i}" data-k="name" value="${esc(a.name)}"><button class="btn small light" data-delacc="${i}">Убрать счёт</button></div></div>`).join('')}
    <button class="btn small" id="addAcc">+ Счёт</button></div>
  <h2>Категории и план в месяц</h2>
  <p class="muted">«План в месяц» — сколько обычно тратишь на подкатегорию. Это база для бюджета каждого месяца.</p>
  ${S.cfg.exp.map((c, ci) => `<details class="card"><summary>${esc(c.cat)} <span class="sub" style="float:right">${money(c.subs.reduce((a, s) => a + (+s.base || 0), 0))}</span></summary>
    <table class="t"><tr><th>Подкатегория</th><th>План в месяц</th></tr>${c.subs.map((s, si) => `<tr><td>${esc(s.name)}<div class="sub">${esc(s.oblig)} · ${esc(s.period)}</div></td><td><input class="mini" data-base="${ci}|${si}" value="${s.base || ''}" inputmode="numeric" placeholder="0"></td></tr>`).join('')}</table>
    <div class="grid2" style="margin:8px 0"><input class="in" id="ns${ci}" placeholder="Новая подкатегория"><button class="btn small" data-addsub="${ci}">+ Добавить</button></div></details>`).join('')}
  <div class="card"><div class="grid2" style="margin:8px 0"><input class="in" id="newCat" placeholder="Новая категория расходов"><button class="btn small" id="addCat">+ Категория</button></div></div>
  <h2>Люди</h2>
  <div class="card">${S.cfg.people.map(p => `<div class="row"><span>${esc(p.name)}</span><span class="sub">${esc(p.role)}</span></div>`).join('')}
    <div class="grid2" style="margin:8px 0"><input class="in" id="newPerson" placeholder="Имя"><button class="btn small" id="addPerson">+ Человек</button></div></div>
  <h2>Данные</h2>
  <div class="card" style="padding:12px">
    <div class="muted">Операций: ${live().length}. Хранятся на этом устройстве${Sync.enabled() ? ' и в твоём Google Диске (скрытая папка приложения — её видит только «Жизнь»)' : ''}.</div>
    <div style="margin-top:6px;font-size:13px">${syncInfo()}</div>
    <button class="btn small" id="syncNow">${Sync.enabled() ? '☁ Синхронизировать сейчас' : '☁ Подключить Google Диск'}</button>
    ${Sync.enabled() ? '<button class="btn small light" id="syncOff">Отключить на этом устройстве</button>' : ''}
    <button class="btn small" id="exportCsv">Выгрузить операции (Excel / CSV)</button>
    <button class="btn small light" id="backup">Резервная копия (файл)</button>
    <label class="btn small light" style="cursor:pointer">Восстановить из копии<input type="file" id="restore" accept=".json" hidden></label>
  </div>
  <p class="muted">Жизнь · раздел «Финансы» · этап 1. Это учёт и планирование, а не инвестиционные рекомендации.</p>`;
  document.querySelectorAll('[data-acc]').forEach(inp => inp.addEventListener('change', async () => {
    const a = S.cfg.accounts[+inp.dataset.acc], k = inp.dataset.k;
    if (k === 'savings') a.savings = inp.checked;
    else if (k === 'name') { const old = a.name, nv = inp.value.trim(); if (!nv || S.cfg.accounts.some(x => x !== a && x.name === nv)) { toast('Такое имя уже есть'); return renderMore(); } a.name = nv; for (const o of S.ops) { let ch = false; if (o.account === old) { o.account = nv; ch = true; } if (o.to === old) { o.to = nv; ch = true; } if (ch) { o.updatedAt = Date.now(); await DB.put(o); } } }
    else a[k] = inp.value === '' ? (k === 'fact' ? null : 0) : +inp.value.replace(/\s/g, '').replace(',', '.');
    await saveCfg(); toast('Сохранено'); renderMore();
  }));
  $('#startDate').addEventListener('change', async e => {
    const v = e.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    const early = live().filter(o => o.date < v).length;
    if (early && !confirm(`Операций раньше ${v.split('-').reverse().join('.')}: ${early}. Они перестанут учитываться. Продолжить?`)) return renderMore();
    S.cfg.startDate = v; await saveCfg(); S.month = mkey(v > today() ? v : today()); toast('Дата начала учёта: ' + v.split('-').reverse().join('.')); renderMore();
  });
  document.querySelectorAll('[data-delacc]').forEach(btn => btn.onclick = async () => {
    const a = S.cfg.accounts[+btn.dataset.delacc];
    if (live().some(o => o.account === a.name || o.to === a.name)) { toast('По этому счёту есть операции — убрать нельзя'); return; }
    if (!confirm('Убрать счёт «' + a.name + '»?')) return;
    S.cfg.accounts.splice(+btn.dataset.delacc, 1); await saveCfg(); renderMore();
  });
  $('#addAcc').onclick = async () => { let n = 'Новый счёт', i = 2; while (S.cfg.accounts.some(a => a.name === n)) n = 'Новый счёт ' + i++; S.cfg.accounts.push({ name: n, type: 'Карта', savings: false, start: 0, fact: null }); await saveCfg(); renderMore(); };
  document.querySelectorAll('[data-base]').forEach(inp => inp.addEventListener('change', async () => { const [ci, si] = inp.dataset.base.split('|').map(Number); S.cfg.exp[ci].subs[si].base = +inp.value || 0; await saveCfg(); toast('План сохранён'); }));
  document.querySelectorAll('[data-addsub]').forEach(btn => btn.onclick = async () => { const ci = +btn.dataset.addsub, v = $('#ns' + ci).value.trim(); if (!v) return; const c = S.cfg.exp[ci]; if (c.subs.some(s => s.name === v)) return toast('Уже есть'); c.subs.splice(c.subs.length - 1, 0, { name: v, oblig: 'Важный', char: 'Переменный', period: 'Ежемесячный', base: 0 }); await saveCfg(); renderMore(); });
  $('#addCat').onclick = async () => { const v = $('#newCat').value.trim(); if (!v || S.cfg.exp.some(c => c.cat === v)) return; S.cfg.exp.push({ cat: v, pocket: 'Повседневные расходы', subs: [{ name: 'Другое', oblig: 'Необязательный', char: 'Переменный', period: 'Нерегулярный', base: 0 }] }); await saveCfg(); renderMore(); };
  $('#addPerson').onclick = async () => { const v = $('#newPerson').value.trim(); if (!v || S.cfg.people.some(p => p.name === v)) return; S.cfg.people.push({ name: v, role: 'Другое' }); await saveCfg(); renderMore(); };
  $('#syncNow').onclick = () => Sync.run(true).then(n => { toast(n ? `Синхронизировано: подтянуто изменений — ${n}` : 'Синхронизировано ✓'); renderMore(); }).catch(e => { toast('⚠ ' + e.message); renderMore(); });
  if ($('#syncOff')) $('#syncOff').onclick = () => { if (!confirm('Отключить синхронизацию на этом устройстве? Данные останутся и здесь, и в Google Диске.')) return; Sync.off(); renderMore(); };
  $('#exportCsv').onclick = exportCsv;
  $('#backup').onclick = () => download(`жизнь-копия-${today()}.json`, JSON.stringify({ app: 'zhizn', v: 1, at: new Date().toISOString(), cfg: S.cfg, ops: S.ops }, null, 1), 'application/json');
  $('#restore').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); if (data.app !== 'zhizn') throw new Error('не тот файл');
      if (!confirm(`Восстановить ${data.ops.length} операций из копии от ${data.at.slice(0, 10)}? Текущие данные будут объединены с копией.`)) return;
      for (const o of data.ops) { const cur = S.ops.find(x => x.id === o.id); if (!cur || (o.updatedAt || 0) > (cur.updatedAt || 0)) { await DB.put(o); } }
      if ((data.cfg.updatedAt || 0) > (S.cfg.updatedAt || 0)) { S.cfg = data.cfg; await DB.set('cfg', S.cfg); }
      S.ops = await DB.all(); toast('Восстановлено'); Sync.soon(); renderMore();
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
  };
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function exportCsv() {
  const head = ['Дата', 'Тип', 'Счёт', 'Категория', 'Подкатегория', 'Сумма', 'Человек', 'Получатель', 'Комментарий'];
  const rows = live().sort((a, b) => a.date.localeCompare(b.date)).map(o => [o.date.split('-').reverse().join('.'), o.type, o.account, o.cat, o.sub, String(o.amount).replace('.', ','), o.person, o.to, o.comment]);
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
      const body = JSON.stringify({ app: 'zhizn', v: 1, at: new Date().toISOString(), device: DEVICE, cfg: S.cfg, ops: S.ops });
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
  return n;
}
function syncInfo() {
  const st = Sync.state();
  if (!st.on) return 'Синхронизация выключена. Подключи Google Диск, чтобы телефон и ноутбук видели одни данные.';
  const last = st.last ? new Date(st.last).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
  return `☁ Google Диск подключён · последняя синхронизация: ${last}` + (st.err ? `<div class="err">⚠ ${esc(st.err)}</div>` : '');
}

// ---------- Запуск ----------
(async function init() {
  try {
    await DB.open();
    S.ops = await DB.all();
    S.cfg = (await DB.get('cfg')) || defaultCfg();
    if (!(await DB.get('cfg'))) await DB.set('cfg', S.cfg);
  } catch (e) {
    $('#view').innerHTML = '<div class="warn">Не удалось открыть хранилище на устройстве. Проверь, что браузер не в режиме инкогнито.</div>'; return;
  }
  const t = today(); S.month = t < S.cfg.startDate ? mkey(S.cfg.startDate) : mkey(t);
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { if (b.dataset.tab === 'add') { S.edit = null; S.draft = null; } setTab(b.dataset.tab); });
  $('#mPrev').onclick = () => { S.month = mshift(S.month, -1); render(); };
  $('#mNext').onclick = () => { S.month = mshift(S.month, 1); render(); };
  render();
  Sync.mark(Sync.enabled() ? 'wait' : 'off');
  $('#syncDot').onclick = () => Sync.run(true).then(n => toast(n ? `Синхронизировано: подтянуто изменений — ${n}` : 'Синхронизировано ✓')).catch(e => toast('⚠ ' + e.message));
  if (Sync.enabled()) Sync.run(false).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Sync.enabled()) Sync.run(false).catch(() => {}); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
