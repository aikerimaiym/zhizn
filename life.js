'use strict';
/* Жизнь — раздел «Сегодня» и «План».
   Данные дня (трекеры, отметки плана, отчёт) — S.life.days[дата], дела — S.life.tasks. Хранятся в IndexedDB (kv 'life')
   и синхронизируются через Google Диск вместе с финансами; при слиянии побеждает более свежая запись каждого дня/дела.
   Настройки (трекеры, поля отчёта, шаблон недели, периоды) — S.cfg.life, синхронизируются как остальные настройки.
   Всё настраивается: у каждого человека свои трекеры, поля и расписание. Личного расписания в коде нет. */

const WD = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const isoWd = d => { const w = new Date(d + 'T00:00').getDay(); return w === 0 ? 7 : w; };
const tmin = t => { if (!/^\d{1,2}:\d{2}$/.test(t || '')) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dayTitle = d => { const x = new Date(d + 'T00:00'); return `${WD_FULL[isoWd(d)][0].toUpperCase() + WD_FULL[isoWd(d)].slice(1)}, ${x.getDate()} ${MONTHS_GEN[x.getMonth()]}`; };
const lid = () => uid().slice(0, 8);

// ---------- Настройки по умолчанию (общие для любого человека) ----------
function defaultLife() {
  return {
    name: '',
    trackers: [
      { id: 'water', name: 'Вода', icon: '💧', kind: 'count', goal: 8, unit: 'стак.', on: true, streak: true },
      { id: 'sleep', name: 'Сон', icon: '😴', kind: 'sleep', goal: '00:00', on: true, streak: true },
      { id: 'workout', name: 'Тренировка', icon: '🏋️', kind: 'choice', options: ['Зал', 'Дом', 'Прогулка'], on: true, streak: true },
      { id: 'care', name: 'Уход', icon: '🧴', kind: 'checks', options: ['Утро', 'Вечер'], on: true, streak: true },
      { id: 'lang', name: 'Языки', icon: '🗣', kind: 'minutes', goal: 20, on: true, streak: true },
      { id: 'steps', name: 'Шаги', icon: '👟', kind: 'number', goal: 8000, on: true, streak: false },
      { id: 'mood', name: 'Настроение', icon: '🙂', kind: 'scale5', on: true, streak: false },
      { id: 'energy', name: 'Энергия', icon: '⚡', kind: 'scale5', on: true, streak: false },
    ],
    reportFields: [
      { id: 'food', label: 'Еда' },
      { id: 'workoutNote', label: 'Тренировка: что делала, веса' },
      { id: 'study', label: 'Учёба и работа' },
      { id: 'social', label: 'Общение' },
      { id: 'plus', label: 'Что зарядило (+)' },
      { id: 'minus', label: 'Что вымотало (−)' },
      { id: 'wins', label: '3 победы' },
      { id: 'lesson', label: '1 урок' },
      { id: 'free', label: 'Как прошёл день — свободно', big: true },
    ],
    week: [],      // блоки шаблона недели: {id, days:[1..7], from:'07:30', to:'08:30', title}
    periods: [],   // особые периоды: {id, name, from, to, blocks:[...]} — пока идёт период, вместо обычной недели
  };
}
function lifeCfg() {
  if (!S.cfg.life) S.cfg.life = defaultLife();
  const L = S.cfg.life;
  for (const k of ['trackers', 'reportFields', 'week', 'periods']) if (!Array.isArray(L[k])) L[k] = defaultLife()[k];
  return L;
}
async function saveLifeCfg() { await saveCfg(); }

// ---------- Данные дней и дела ----------
function lifeData() { if (!S.life) S.life = { days: {}, tasks: [] }; if (!S.life.days) S.life.days = {}; if (!S.life.tasks) S.life.tasks = []; return S.life; }
function day(date) { return lifeData().days[date] || { t: {}, r: {}, blocks: {} }; }
async function saveLife() { await DB.set('life', S.life); Sync.soon(); }
async function setDay(date, fn) {
  const L = lifeData(), d = L.days[date] ? JSON.parse(JSON.stringify(L.days[date])) : { t: {}, r: {}, blocks: {} };
  d.t = d.t || {}; d.r = d.r || {}; d.blocks = d.blocks || {};
  fn(d); d.updatedAt = Date.now(); d.device = DEVICE; L.days[date] = d; await saveLife();
}
const liveTasks = () => lifeData().tasks.filter(t => !t.deleted);
async function putTask(t) {
  const L = lifeData(), i = L.tasks.findIndex(x => x.id === t.id);
  t.updatedAt = Date.now(); t.device = DEVICE;
  if (i < 0) L.tasks.push(t); else L.tasks[i] = t;
  await saveLife();
}
// Слияние с Google Диском / резервной копией: по каждому дню и делу побеждает более свежее изменение
function mergeLife(other) {
  if (!other) return 0;
  const L = lifeData(); let n = 0;
  // словари по ключу (дни, ачивки, колесо по неделям, Прайм по месяцам) и списки по id (дела, квесты, бонусы)
  for (const k of ['days', 'ach', 'wheel', 'prime', 'lvl']) {
    if (!other[k]) continue; if (!L[k] || typeof L[k] !== 'object') L[k] = {};
    for (const [key, rec] of Object.entries(other[k])) if (rec && (!L[k][key] || (rec.updatedAt || 0) > (L[k][key].updatedAt || 0))) { L[k][key] = rec; n++; }
  }
  for (const k of ['tasks', 'quests', 'bonus', 'buys', 'skillLog']) {
    if (!Array.isArray(other[k])) continue; if (!Array.isArray(L[k])) L[k] = [];
    for (const t of other[k]) { const i = L[k].findIndex(x => x.id === t.id); if (i < 0 || (t.updatedAt || 0) > (L[k][i].updatedAt || 0)) { if (i < 0) L[k].push(t); else L[k][i] = t; n++; } }
  }
  if (n) DB.set('life', S.life);
  return n;
}

// ---------- Расписание дня ----------
function periodFor(date) { return lifeCfg().periods.find(p => p.from && p.to && p.from <= date && date <= p.to) || null; }
function blocksFor(date) {
  const p = periodFor(date), wd = isoWd(date);
  return (p ? p.blocks : lifeCfg().week).filter(b => (b.days || []).includes(wd)).sort((a, b) => (tmin(a.from) ?? 0) - (tmin(b.from) ?? 0));
}

// ---------- Трекеры: выполнено ли за день (для серий) ----------
function trackerOk(tr, v) {
  if (v === undefined || v === null || v === '') return false;
  switch (tr.kind) {
    case 'count': case 'minutes': case 'number': return +v >= (+tr.goal || 1);
    case 'sleep': { const b = tmin(v && v.bed), g = tmin(tr.goal || '00:00'); if (b === null) return false; const norm = x => x < 12 * 60 ? x + 24 * 60 : x; return norm(b) <= norm(g === null ? 0 : g); }
    case 'choice': return !!v && v !== 'Нет';
    case 'checks': return Array.isArray(v) && (tr.options || []).every(o => v.includes(o));
    case 'check': return !!v;
    default: return false;
  }
}
function streak(okFn) {
  let n = 0, d = today();
  if (!okFn(d)) d = dAdd(d, -1);          // сегодня ещё не закончилось — серия считается до вчера
  for (let i = 0; i < 400 && okFn(d); i++) { n++; d = dAdd(d, -1); }
  return n;
}
function sleepDur(v) { const b = tmin(v && v.bed), w = tmin(v && v.wake); if (b === null || w === null) return ''; let m = w - b; if (m <= 0) m += 1440; return `${Math.floor(m / 60)} ч ${m % 60 ? m % 60 + ' мин' : ''}`.trim(); }
function trackerText(tr, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  switch (tr.kind) {
    case 'count': return `${v}${tr.goal ? '/' + tr.goal : ''} ${tr.unit || ''}`.trim();
    case 'minutes': return `${v} мин${tr.goal ? ' (цель ' + tr.goal + ')' : ''}`;
    case 'number': return `${(+v).toLocaleString('ru-RU')}${tr.goal ? ' / ' + (+tr.goal).toLocaleString('ru-RU') : ''}`;
    case 'sleep': return `${v.bed ? 'легла ' + v.bed : ''}${v.wake ? ', встала ' + v.wake : ''}${sleepDur(v) ? ' (' + sleepDur(v) + ')' : ''}`.replace(/^, /, '');
    case 'choice': return v;
    case 'checks': return v.join(', ');
    case 'check': return v ? 'да' : '—';
    case 'scale5': return v + '/5';
    default: return String(v);
  }
}
const MOOD = ['', '😞', '🙁', '😐', '🙂', '😄'];

// ---------- Деньги на сегодня ----------
function moneyToday() {
  const t = today(), M = mkey(t), ps = pocketState(M);
  const flex = ps.list.filter(p => p.kind === 'flexible');
  const flexLeft = r2(flex.reduce((s, p) => s + Math.max(0, p.bal), 0));
  const end = new Date(+M.slice(0, 4), +M.slice(5, 7), 0).getDate(), daysLeft = end - +t.slice(8) + 1;
  const spentToday = r2(live().filter(o => o.type === 'Расход' && o.date === t && !validate(o)).reduce((s, o) => s + opBase(o), 0));
  // лимит на день считаем по остатку на утро: всё, что потрачено сегодня, возвращаем в расчёт
  const base = flexLeft > 0 ? flexLeft + spentToday : Math.max(0, ps.free);
  const perDay = base > 0 ? r2(base / daysLeft) : 0;
  let pays = [];
  try { pays = allPayments().length ? payCalendar(t, dAdd(t, 1)).filter(r => r.p.kind === 'out' && r.status !== 'paid') : []; } catch (e) {}
  return { perDay, left: r2(perDay - spentToday), spentToday, daysLeft, src: flexLeft > 0 ? 'гибкие карманы' : 'свободные деньги', pays };
}

// ---------- Экран «Сегодня» ----------
function renderToday() {
  const t = today(), L = lifeCfg(), d = day(t), h = new Date().getHours();
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const trs = L.trackers.filter(x => x.on);
  // серии
  const chips = [`<span class="streak">🔥 Отчёт: ${streak(dd => !!day(dd).done)}</span>`,
    ...trs.filter(x => x.streak).map(x => `<span class="streak">${x.icon} ${esc(x.name)}: ${streak(dd => trackerOk(x, day(dd).t[x.id]))}</span>`)].join('');
  // план дня
  const blocks = blocksFor(t), nm = nowMin(), per = periodFor(t);
  const tasksToday = liveTasks().filter(x => x.date === t).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const overdue = liveTasks().filter(x => !x.done && x.date && x.date < t);
  const blockRow = b => { const f = tmin(b.from), e = tmin(b.to), now = f !== null && nm >= f && (e === null ? nm < f + 30 : nm < e), done = !!d.blocks[b.id];
    return `<label class="prow ${now ? 'now' : ''} ${done ? 'done' : ''}"><input type="checkbox" data-blk="${b.id}" ${done ? 'checked' : ''}><span class="ptime">${esc(b.from)}${b.to ? '–' + esc(b.to) : ''}</span><span class="ptitle">${esc(b.title)}</span>${now ? '<span class="pnow">сейчас</span>' : ''}</label>`; };
  const taskRow = x => `<div class="prow ${x.done ? 'done' : ''}"><input type="checkbox" data-task="${x.id}" ${x.done ? 'checked' : ''}><span class="ptime">${x.time ? esc(x.time) : (x.date && x.date < t ? '⚠' : '•')}</span><span class="ptitle">${esc(x.title)}${x.date && x.date < t ? ` <span class="sub">· с ${dRu2(x.date).slice(0, 5)}</span>` : ''}</span>${x.date && x.date < t ? `<button class="mini-btn" data-tasktoday="${x.id}">→ сегодня</button>` : ''}</div>`;
  const doneCnt = blocks.filter(b => d.blocks[b.id]).length + tasksToday.filter(x => x.done).length, allCnt = blocks.length + tasksToday.length;
  const plan = `<h2>План дня${per ? ` <span class="sub">· ${esc(per.name)}</span>` : ''}${allCnt ? ` <span class="sub">· ${doneCnt}/${allCnt}</span>` : ''}</h2>
    <div class="card">${blocks.map(blockRow).join('')}${tasksToday.map(taskRow).join('')}${overdue.map(taskRow).join('')}
      ${!blocks.length && !tasksToday.length && !overdue.length ? `<div class="row muted">На сегодня пусто. ${L.week.length ? '' : 'Заполни шаблон недели во вкладке «План» — расписание будет появляться само.'}</div>` : ''}
      <div class="addtask"><input class="in" id="newTask" placeholder="+ Дело на сегодня" autocomplete="off"><button class="btn small" id="addTask" style="margin:0">Добавить</button></div></div>`;
  // трекеры
  const trCard = x => {
    const v = d.t[x.id], ok = trackerOk(x, v);
    let ctl = '';
    if (x.kind === 'count') ctl = `<div class="tctl"><button class="tbtn" data-tdec="${x.id}">−</button><b class="tval">${v || 0}${x.goal ? '<span class="sub">/' + x.goal + '</span>' : ''}</b><button class="tbtn" data-tinc="${x.id}">+</button></div>`;
    else if (x.kind === 'sleep') ctl = `<div class="grid2"><div><span class="sub">Легла</span><input class="in tin" type="time" data-tsleep="${x.id}|bed" value="${(v && v.bed) || ''}"></div><div><span class="sub">Встала</span><input class="in tin" type="time" data-tsleep="${x.id}|wake" value="${(v && v.wake) || ''}"></div></div>${sleepDur(v) ? `<div class="sub">${sleepDur(v)}</div>` : ''}`;
    else if (x.kind === 'choice') ctl = `<div class="seg">${[...(x.options || []), 'Нет'].map(o => `<button class="chip ${v === o ? 'on' : ''}" data-tchoice="${x.id}|${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    else if (x.kind === 'checks') ctl = `<div class="seg">${(x.options || []).map(o => `<button class="chip ${(v || []).includes(o) ? 'on' : ''}" data-tcheck="${x.id}|${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    else if (x.kind === 'check') ctl = `<div class="seg"><button class="chip ${v ? 'on' : ''}" data-tbool="${x.id}">${v ? '✓ Сделано' : 'Отметить'}</button></div>`;
    else if (x.kind === 'minutes' || x.kind === 'number') ctl = `<div class="tctl"><input class="in tin" inputmode="numeric" data-tnum="${x.id}" value="${v ?? ''}" placeholder="0">${x.kind === 'minutes' ? `<button class="tbtn" data-tadd="${x.id}|10">+10</button>` : ''}</div>`;
    else if (x.kind === 'scale5') ctl = `<div class="scale5">${[1, 2, 3, 4, 5].map(k => `<button class="${v === k ? 'on' : ''}" data-tscale="${x.id}|${k}">${x.id === 'mood' ? MOOD[k] : k}</button>`).join('')}</div>`;
    return `<div class="tcard ${ok ? 'ok' : ''} ${x.kind === 'sleep' ? 'wide' : ''}"><div class="tname">${x.icon} ${esc(x.name)}${x.kind === 'minutes' && x.goal ? ` <span class="sub">цель ${x.goal} мин</span>` : x.kind === 'number' && x.goal ? ` <span class="sub">цель ${(+x.goal).toLocaleString('ru-RU')}</span>` : ''}${ok ? ' <span class="tok">✓</span>' : ''}</div>${ctl}</div>`;
  };
  const trackers = `<h2>Трекеры <button class="ghost" id="lifeSet" style="font-size:13px;float:right">⚙ настроить</button></h2><div class="tgrid">${trs.map(trCard).join('') || '<div class="muted">Трекеры выключены — включи в настройках.</div>'}</div>`;
  // деньги
  const mt = moneyToday();
  const money = `<h2>Деньги на сегодня</h2><div class="card" style="padding:10px 12px">
    <div class="mrow"><div><div class="sub">Можно потратить сегодня</div><b class="${mt.left < 0 ? 'neg' : ''}" style="font-size:20px">${money0(mt.left)}</b><div class="sub">${mt.perDay ? `в день ${money0(mt.perDay)} · ${esc(mt.src)} на ${mt.daysLeft} дн.` : 'разложи деньги по гибким карманам — появится дневной лимит'}</div></div>
    <div style="text-align:right"><div class="sub">Потрачено</div><b>${money0(mt.spentToday)}</b></div></div>
    ${mt.pays.map(r => `<div class="${r.due === today() ? 'warn' : 'info'}" style="margin:6px 0 0">📅 ${r.due === today() ? 'Сегодня' : 'Завтра'}: «${esc(r.p.name)}» — ${money0(r.left)}</div>`).join('')}
    <button class="btn small" id="quickSpend" style="margin-top:8px">− Записать трату</button></div>`;
  // вечерний отчёт
  const rep = d.done
    ? `<div class="card" style="padding:10px 12px"><div class="mrow"><b>✓ Отчёт за сегодня готов</b><button class="btn small light" id="openReport" style="margin:0">Открыть</button></div></div>`
    : `<div class="card ${h >= 20 ? 'evening' : ''}" style="padding:10px 12px"><b>📝 Вечерний отчёт</b><div class="sub">${h >= 20 ? 'Самое время: как прошёл день?' : 'Можно заполнять в течение дня, отправить — вечером.'}</div><button class="btn small" id="openReport">Заполнить отчёт</button></div>`;
  $('#view').innerHTML = maturityHtml() + `<div class="hello"><div class="sub">${dayTitle(t)}</div><b>${hello}${L.name ? ', ' + esc(L.name) : ''}!</b></div>
    ${typeof charMini === 'function' ? charMini() : ''}${typeof todayGame === 'function' ? todayGame(t) : ''}
    <div class="streaks">${chips}</div>${plan}${trackers}${money}<h2>Вечер</h2>${rep}
    <button class="btn light" id="openDays">📖 Лента дней</button>`;
  bindToday(t);
  if (typeof bindMaturity === 'function') bindMaturity();
  if (typeof interestModal === 'function') interestModal();
}
const money0 = v => money(Math.round(v));
function bindToday(t) {
  const L = lifeCfg(), tr = id => L.trackers.find(x => x.id === id), rer = () => { const y = scrollY; renderToday(); scrollTo(0, y); };
  document.querySelectorAll('[data-blk]').forEach(el => el.onchange = () => setDay(t, d => { d.blocks[el.dataset.blk] = el.checked; if (!el.checked) delete d.blocks[el.dataset.blk]; }).then(rer));
  document.querySelectorAll('[data-task]').forEach(el => el.onchange = () => { const x = liveTasks().find(z => z.id === el.dataset.task); putTask({ ...x, done: el.checked, doneAt: el.checked ? t : '' }).then(rer); });
  document.querySelectorAll('[data-tasktoday]').forEach(el => el.onclick = e => { e.preventDefault(); const x = liveTasks().find(z => z.id === el.dataset.tasktoday); putTask({ ...x, date: t }).then(rer); });
  const add = () => { const v = $('#newTask').value.trim(); if (!v) return; putTask({ id: lid(), title: v, date: t, time: '', done: false, createdAt: Date.now() }).then(rer); };
  $('#addTask').onclick = add; $('#newTask').onkeydown = e => { if (e.key === 'Enter') add(); };
  document.querySelectorAll('[data-tinc],[data-tdec]').forEach(el => el.onclick = () => { const id = el.dataset.tinc || el.dataset.tdec, k = el.dataset.tinc ? 1 : -1; setDay(t, d => { d.t[id] = Math.max(0, (+d.t[id] || 0) + k); }).then(rer); });
  document.querySelectorAll('[data-tsleep]').forEach(el => el.onchange = () => { const [id, k] = el.dataset.tsleep.split('|'); setDay(t, d => { d.t[id] = { ...(d.t[id] || {}), [k]: el.value }; }).then(rer); });
  document.querySelectorAll('[data-tchoice]').forEach(el => el.onclick = () => { const [id, o] = el.dataset.tchoice.split('|'); setDay(t, d => { d.t[id] = d.t[id] === o ? '' : o; }).then(rer); });
  document.querySelectorAll('[data-tcheck]').forEach(el => el.onclick = () => { const [id, o] = el.dataset.tcheck.split('|'); setDay(t, d => { const a = new Set(d.t[id] || []); a.has(o) ? a.delete(o) : a.add(o); d.t[id] = [...a]; }).then(rer); });
  document.querySelectorAll('[data-tbool]').forEach(el => el.onclick = () => setDay(t, d => { d.t[el.dataset.tbool] = !d.t[el.dataset.tbool]; }).then(rer));
  document.querySelectorAll('[data-tnum]').forEach(el => el.onchange = () => setDay(t, d => { d.t[el.dataset.tnum] = el.value === '' ? '' : Math.max(0, Math.round(num(el.value))); }).then(rer));
  document.querySelectorAll('[data-tadd]').forEach(el => el.onclick = () => { const [id, k] = el.dataset.tadd.split('|'); setDay(t, d => { d.t[id] = (+d.t[id] || 0) + +k; }).then(rer); });
  document.querySelectorAll('[data-tscale]').forEach(el => el.onclick = () => { const [id, k] = el.dataset.tscale.split('|'); setDay(t, d => { d.t[id] = d.t[id] === +k ? '' : +k; }).then(rer); });
  void tr;
  $('#lifeSet').onclick = () => setTab('lifeset');
  $('#quickSpend').onclick = () => { S.edit = null; S.draft = null; S.backTab = 'today'; setTab('add'); };
  $('#openReport').onclick = () => { S.dayDate = t; setTab('day'); };
  $('#openDays').onclick = () => setTab('days');
  const cm = $('#charMini'); if (cm) cm.onclick = () => setTab('char');
  if (typeof bindTodayGame === 'function') bindTodayGame(t);
  vizTipInit();
}

// ---------- Вечерний отчёт ----------
function dayFacts(date) {
  const d = day(date), blocks = blocksFor(date), tasks = liveTasks().filter(x => x.date === date || (x.done && x.doneAt === date && x.date !== date));
  const ops = live().filter(o => o.date === date && !validate(o) && !isPocketOp(o));
  const exp = {}; let expT = 0, incT = 0;
  for (const o of ops) { if (o.type === 'Расход') { exp[o.cat] = (exp[o.cat] || 0) + opBase(o); expT += opBase(o); } else if (TYPE[o.type] && TYPE[o.type].sign > 0 && !TYPE[o.type].to) incT += opBase(o); }
  return { d, blocks, tasks, exp, expT: r2(expT), incT: r2(incT) };
}
function reportText(date) {
  const L = lifeCfg(), F = dayFacts(date), d = F.d, lines = [`Вечерний отчёт · ${dayTitle(date)} ${date.slice(0, 4)}`];
  for (const x of L.trackers.filter(z => z.on)) { const v = d.t[x.id]; if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) lines.push(`${x.name}: ${trackerText(x, v)}`); }
  if (F.blocks.length) lines.push(`План: выполнено ${F.blocks.filter(b => d.blocks[b.id]).length} из ${F.blocks.length} — ${F.blocks.map(b => (d.blocks[b.id] ? '✓ ' : '✗ ') + b.title).join('; ')}`);
  if (F.tasks.length) lines.push(`Дела: ${F.tasks.map(x => (x.done ? '✓ ' : '✗ ') + x.title).join('; ')}`);
  lines.push(`Траты за день: ${money(F.expT)}${Object.keys(F.exp).length ? ' (' + Object.entries(F.exp).map(([c, v]) => c + ' ' + money(v)).join(', ') + ')' : ''}${F.incT ? `; поступления: ${money(F.incT)}` : ''}`);
  for (const f of L.reportFields) { const v = (d.r[f.id] || '').trim(); if (v) lines.push(`${f.label}: ${v}`); }
  lines.push(`Для блога: ${d.open ? '🔓 можно' : '🔒 только мне'}`);
  return lines.join('\n');
}
function renderDay() {
  const date = S.dayDate || today(), L = lifeCfg(), F = dayFacts(date), d = F.d;
  const trs = L.trackers.filter(x => x.on);
  $('#view').innerHTML = `<button class="ghost" id="dayBack" style="font-size:15px;padding:4px 0">‹ ${date === today() ? 'Сегодня' : 'Лента дней'}</button>
    <h2 style="margin-top:2px">📝 ${dayTitle(date)}${date.slice(0, 4) !== today().slice(0, 4) ? ' ' + date.slice(0, 4) : ''}</h2>
    <div class="card" style="padding:10px 12px"><b>Собралось само</b>
      ${trs.map(x => `<div class="mrow"><span>${x.icon} ${esc(x.name)}</span><span class="sub">${esc(trackerText(x, d.t[x.id]))}</span></div>`).join('')}
      ${F.blocks.length ? `<div class="mrow"><span>📋 План</span><span class="sub">${F.blocks.filter(b => d.blocks[b.id]).length} из ${F.blocks.length}</span></div>` : ''}
      ${F.tasks.length ? `<div class="mrow"><span>✅ Дела</span><span class="sub">${F.tasks.filter(x => x.done).length} из ${F.tasks.length}</span></div>` : ''}
      <div class="mrow"><span>💸 Траты</span><span class="sub">${money(F.expT)}</span></div>
      ${date === today() ? '<div class="sub" style="margin-top:4px">Трекеры и план отмечаются на экране «Сегодня».</div>' : ''}</div>
    <div class="card" style="padding:4px 12px 10px">${L.reportFields.map(f => `<label class="f">${esc(f.label)}</label><textarea class="in" rows="${f.big ? 4 : 2}" data-rf="${f.id}">${esc(d.r[f.id] || '')}</textarea>`).join('')}
      <label class="f" style="font-size:13px;color:var(--ink)"><input type="checkbox" id="dayOpen" ${d.open ? 'checked' : ''}> 🔓 Можно использовать для блога (по умолчанию 🔒 только мне)</label></div>
    <button class="btn" id="daySave">${d.done ? 'Сохранить изменения' : '✓ Сохранить отчёт'}</button>
    <button class="btn light" id="dayCopy">📋 Скопировать для ИИ-помощника</button>
    <div class="muted" style="margin-top:6px">Текст отчёта можно вставить в чат с ИИ-помощником (например, Claude) — он разберёт день по правилам твоей игры.</div>`;
  const collect = () => { const r = {}; document.querySelectorAll('[data-rf]').forEach(el => { r[el.dataset.rf] = el.value; }); return r; };
  let dirty = false; document.querySelectorAll('[data-rf]').forEach(el => el.oninput = () => { dirty = true; });
  const save = async (done) => { const r = collect(), open = $('#dayOpen').checked; await setDay(date, x => { x.r = { ...x.r, ...r }; x.open = open; if (done) x.done = true; }); dirty = false; };
  $('#dayBack').onclick = async () => { if (dirty) await save(false); setTab(date === today() ? 'today' : 'days'); };
  $('#daySave').onclick = async () => { await save(true); toast('Отчёт сохранён ✓'); setTab(date === today() ? 'today' : 'days'); };
  $('#dayCopy').onclick = async () => {
    await save(false); const txt = reportText(date);
    try { await navigator.clipboard.writeText(txt); toast('Отчёт скопирован — вставь его в чат'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Отчёт скопирован'); } catch (e2) { toast('Не удалось скопировать'); } ta.remove(); }
  };
}
// Лента дней
function renderDays() {
  const L = lifeCfg(), all = Object.keys(lifeData().days).sort().reverse();
  const t = today(), list = [...new Set([t, ...all])].filter(x => x <= t).slice(0, 90);
  $('#view').innerHTML = `<button class="ghost" id="daysBack" style="font-size:15px;padding:4px 0">‹ Сегодня</button><h2 style="margin-top:2px">📖 Лента дней</h2>
    <div class="card">${list.map(x => { const d = day(x), mood = d.t.mood, okN = L.trackers.filter(z => z.on && z.streak && trackerOk(z, d.t[z.id])).length, stN = L.trackers.filter(z => z.on && z.streak).length;
      return `<div class="row" data-dday="${x}" style="cursor:pointer"><div style="min-width:0"><div class="t">${dayTitle(x)}${x.slice(0, 4) !== t.slice(0, 4) ? ' ' + x.slice(0, 4) : ''}</div><div class="sub">${d.done ? '✓ отчёт' : x === t ? 'сегодня' : 'без отчёта'} · трекеры ${okN}/${stN}${d.r && d.r.wins ? ' · ' + esc(d.r.wins.slice(0, 60)) : ''}</div></div><span style="font-size:20px">${mood ? MOOD[mood] : ''}${d.open ? '🔓' : ''}</span></div>`; }).join('')}</div>`;
  $('#daysBack').onclick = () => setTab('today');
  document.querySelectorAll('[data-dday]').forEach(el => el.onclick = () => { S.dayDate = el.dataset.dday; setTab('day'); });
}

// ---------- Экран «План»: шаблон недели, периоды, дела ----------
function renderPlan() {
  const L = lifeCfg(), seg = S.planSeg || 'week';
  const segHtml = `<div class="seg" style="margin-bottom:10px">${[['week', '🗓 Неделя'], ['tasks', '✅ Дела'], ['periods', '⏳ Периоды']].map(([k, l]) => `<button class="chip ${seg === k ? 'on' : ''}" data-pseg="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (seg === 'week') {
    const setId = S.planSet || '', per = L.periods.find(p => p.id === setId), blocks = per ? per.blocks : L.week, wd = S.planDay || isoWd(today());
    const dayBlocks = blocks.filter(b => b.days.includes(wd)).sort((a, b) => (tmin(a.from) ?? 0) - (tmin(b.from) ?? 0));
    const ed = S.blkEdit ? blocks.find(b => b.id === S.blkEdit) : null, f = ed || { from: '', to: '', title: '', days: [wd] };
    body = `<label class="f" style="margin-top:0">Расписание</label><select class="in" id="planSet"><option value="">Обычная неделя</option>${L.periods.map(p => `<option value="${p.id}" ${p.id === setId ? 'selected' : ''}>${esc(p.name)} (${dRu2(p.from).slice(0, 5)}–${dRu2(p.to).slice(0, 5)})</option>`).join('')}</select>
      <div class="wdays">${[1, 2, 3, 4, 5, 6, 7].map(k => `<button class="chip ${k === wd ? 'on' : ''}" data-pday="${k}">${WD[k]}</button>`).join('')}</div>
      <div class="card">${dayBlocks.map(b => `<div class="row"><div style="min-width:0"><b>${esc(b.from)}${b.to ? '–' + esc(b.to) : ''}</b> ${esc(b.title)}<div class="sub">${b.days.length === 7 ? 'каждый день' : b.days.map(k => WD[k]).join(', ')}</div></div><span style="white-space:nowrap"><button class="mini-btn" data-bedit="${b.id}">✎</button><button class="mini-btn" data-bdel="${b.id}">✕</button></span></div>`).join('') || '<div class="row muted">В этот день блоков нет</div>'}</div>
      <div class="card" style="padding:10px 12px" id="blkForm"><b>${ed ? 'Изменить блок' : '+ Новый блок'}</b>
        <div class="grid2"><div><label class="f">С</label><input class="in" type="time" id="bFrom" value="${esc(f.from)}"></div><div><label class="f">До (необязательно)</label><input class="in" type="time" id="bTo" value="${esc(f.to)}"></div></div>
        <label class="f">Что</label><input class="in" id="bTitle" value="${esc(f.title)}" placeholder="Учёба, работа, зал, сон…">
        <label class="f">Дни недели</label><div class="wdays">${[1, 2, 3, 4, 5, 6, 7].map(k => `<button class="chip ${f.days.includes(k) ? 'on' : ''}" data-bday="${k}">${WD[k]}</button>`).join('')}</div>
        <div class="err" id="bErr"></div>
        <button class="btn small" id="bSave">${ed ? 'Сохранить' : 'Добавить'}</button>${ed ? '<button class="btn small light" id="bCancel">Отмена</button>' : ''}</div>
      <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Как это работает?</summary><div class="muted" style="padding-bottom:8px">
        <p style="margin:4px 0">Шаблон недели — постоянное расписание. Каждый день его блоки сами появляются в «Сегодня», их можно отмечать галочками.</p>
        <p style="margin:4px 0">Один блок может повторяться в несколько дней (выбери дни). Особые периоды (сессия, отпуск, практика) — во вкладке «Периоды»: пока идёт период, вместо обычной недели действует его расписание.</p>
        <p style="margin:4px 0">Разовые дела — во вкладке «Дела» или прямо на экране «Сегодня».</p></div></details>
      <div class="card" style="padding:10px 12px"><b>Загрузить шаблон из файла</b><div class="muted">Файл .json с расписанием, трекерами и полями отчёта (например, подготовленный ИИ-помощником). Текущий шаблон заменится, данные дней не меняются.</div>
        <label class="btn small light" style="cursor:pointer">Выбрать файл<input type="file" id="lifeImport" accept=".json" hidden></label></div>`;
  } else if (seg === 'tasks') {
    const t = today(), tm = dAdd(t, 1), all = liveTasks();
    const groups = [['⚠ Просрочено', all.filter(x => !x.done && x.date && x.date < t)], ['Сегодня', all.filter(x => x.date === t)], ['Завтра', all.filter(x => x.date === tm)],
      ['Позже', all.filter(x => !x.done && x.date > tm).sort((a, b) => a.date.localeCompare(b.date))], ['Когда-нибудь', all.filter(x => !x.date && !x.done)],
      ['Сделано недавно', all.filter(x => x.done && x.date && x.date < t && x.date >= dAdd(t, -14))]];
    body = `<div class="card" style="padding:10px 12px"><b>+ Новое дело</b><input class="in" id="tTitle" placeholder="Что сделать" style="margin-top:6px">
      <div class="grid2"><div><label class="f">Дата (пусто — «когда-нибудь»)</label><input class="in" type="date" id="tDate" value="${t}"></div><div><label class="f">Время (необязательно)</label><input class="in" type="time" id="tTime"></div></div>
      <button class="btn small" id="tAdd">Добавить</button></div>
      ${groups.filter(([, l]) => l.length).map(([g, l]) => `<h2>${g} <span class="sub">${l.length}</span></h2><div class="card">${l.map(x => `<div class="prow ${x.done ? 'done' : ''}"><input type="checkbox" data-ptask="${x.id}" ${x.done ? 'checked' : ''}><span class="ptime">${x.date ? dRu2(x.date).slice(0, 5) : '—'}${x.time ? ' ' + esc(x.time) : ''}</span><span class="ptitle">${esc(x.title)}</span><span style="white-space:nowrap">${!x.done ? `<button class="mini-btn" data-pmove="${x.id}">→ завтра</button>` : ''}<button class="mini-btn" data-pdel="${x.id}">✕</button></span></div>`).join('')}</div>`).join('') || '<div class="muted">Дел пока нет.</div>'}`;
  } else {
    const ed = S.perEdit ? L.periods.find(p => p.id === S.perEdit) : null;
    body = `<div class="card">${L.periods.map(p => `<div class="row"><div><b>${esc(p.name)}</b><div class="sub">${dRu2(p.from)} — ${dRu2(p.to)} · блоков ${p.blocks.length}${periodFor(today()) === p ? ' · идёт сейчас' : ''}</div></div><span style="white-space:nowrap"><button class="mini-btn" data-peredit="${p.id}">✎</button><button class="mini-btn" data-perweek="${p.id}">🗓</button><button class="mini-btn" data-perdel="${p.id}">✕</button></span></div>`).join('') || '<div class="row muted">Особых периодов нет</div>'}</div>
      <div class="card" style="padding:10px 12px"><b>${ed ? 'Изменить период' : '+ Новый период'}</b>
        <label class="f">Название</label><input class="in" id="pName" value="${esc(ed ? ed.name : '')}" placeholder="Сессия, практика, отпуск…">
        <div class="grid2"><div><label class="f">С</label><input class="in" type="date" id="pFrom" value="${ed ? ed.from : ''}"></div><div><label class="f">По</label><input class="in" type="date" id="pTo" value="${ed ? ed.to : ''}"></div></div>
        ${ed ? '' : '<div class="muted">Расписание периода начнётся с копии обычной недели — поправь его во вкладке «Неделя» (выбери период вверху).</div>'}
        <div class="err" id="pErr"></div><button class="btn small" id="pSave">${ed ? 'Сохранить' : 'Создать'}</button>${ed ? '<button class="btn small light" id="pCancel">Отмена</button>' : ''}</div>`;
  }
  $('#view').innerHTML = `<h2 style="margin-top:4px">🗓 План</h2>${segHtml}${body}`;
  bindPlan(seg);
}
function bindPlan(seg) {
  const L = lifeCfg();
  document.querySelectorAll('[data-pseg]').forEach(b => b.onclick = () => { S.planSeg = b.dataset.pseg; S.blkEdit = null; S.perEdit = null; renderPlan(); });
  if (seg === 'week') {
    const per = L.periods.find(p => p.id === (S.planSet || '')), blocks = () => per ? per.blocks : L.week;
    $('#planSet').onchange = e => { S.planSet = e.target.value; S.blkEdit = null; renderPlan(); };
    document.querySelectorAll('[data-pday]').forEach(b => b.onclick = () => { S.planDay = +b.dataset.pday; S.blkEdit = null; renderPlan(); });
    document.querySelectorAll('[data-bday]').forEach(b => b.onclick = () => b.classList.toggle('on'));
    document.querySelectorAll('[data-bedit]').forEach(b => b.onclick = () => { S.blkEdit = b.dataset.bedit; renderPlan(); $('#blkForm').scrollIntoView({ block: 'center' }); });
    document.querySelectorAll('[data-bdel]').forEach(b => b.onclick = async () => { const bl = blocks().find(x => x.id === b.dataset.bdel); if (!confirm(`Удалить «${bl.title}»${bl.days.length > 1 ? ' из всех дней (' + bl.days.map(k => WD[k]).join(', ') + ')' : ''}?`)) return; const arr = blocks(); arr.splice(arr.indexOf(bl), 1); await saveLifeCfg(); renderPlan(); });
    if ($('#bCancel')) $('#bCancel').onclick = () => { S.blkEdit = null; renderPlan(); };
    $('#bSave').onclick = async () => {
      const from = $('#bFrom').value, to = $('#bTo').value, title = $('#bTitle').value.trim(), days = [...document.querySelectorAll('[data-bday].on')].map(b => +b.dataset.bday);
      if (!from || !title) { $('#bErr').textContent = '⚠ Укажи время начала и что делаешь'; return; }
      if (!days.length) { $('#bErr').textContent = '⚠ Выбери хотя бы один день'; return; }
      if (to && tmin(to) <= tmin(from)) { $('#bErr').textContent = '⚠ Конец раньше начала'; return; }
      const arr = blocks(), ex = S.blkEdit && arr.find(x => x.id === S.blkEdit);
      if (ex) Object.assign(ex, { from, to, title, days: days.sort() }); else arr.push({ id: lid(), from, to, title, days: days.sort() });
      S.blkEdit = null; await saveLifeCfg(); toast('Сохранено ✓'); renderPlan();
    };
    $('#lifeImport').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text()); if (data.app !== 'zhizn-life') throw new Error('это не файл шаблона');
        if (!confirm(`Загрузить шаблон «${data.title || f.name}»? Текущее расписание${data.trackers ? ', трекеры' : ''}${data.reportFields ? ' и поля отчёта' : ''} заменятся.`)) return;
        for (const k of ['week', 'periods', 'trackers', 'reportFields']) if (Array.isArray(data[k])) L[k] = data[k];
        if (data.name !== undefined) L.name = data.name;
        await saveLifeCfg(); toast('Шаблон загружен ✓'); renderPlan();
      } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
    };
  } else if (seg === 'tasks') {
    $('#tAdd').onclick = async () => { const title = $('#tTitle').value.trim(); if (!title) return; await putTask({ id: lid(), title, date: $('#tDate').value || '', time: $('#tTime').value || '', done: false, createdAt: Date.now() }); toast('Дело добавлено'); renderPlan(); };
    document.querySelectorAll('[data-ptask]').forEach(el => el.onchange = () => { const x = liveTasks().find(z => z.id === el.dataset.ptask); putTask({ ...x, done: el.checked, doneAt: el.checked ? today() : '' }).then(renderPlan); });
    document.querySelectorAll('[data-pmove]').forEach(el => el.onclick = () => { const x = liveTasks().find(z => z.id === el.dataset.pmove); putTask({ ...x, date: dAdd(x.date && x.date > today() ? x.date : today(), 1) }).then(renderPlan); });
    document.querySelectorAll('[data-pdel]').forEach(el => el.onclick = () => { const x = liveTasks().find(z => z.id === el.dataset.pdel); if (confirm(`Удалить «${x.title}»?`)) putTask({ ...x, deleted: true }).then(renderPlan); });
  } else {
    document.querySelectorAll('[data-peredit]').forEach(b => b.onclick = () => { S.perEdit = b.dataset.peredit; renderPlan(); });
    document.querySelectorAll('[data-perweek]').forEach(b => b.onclick = () => { S.planSeg = 'week'; S.planSet = b.dataset.perweek; renderPlan(); });
    document.querySelectorAll('[data-perdel]').forEach(b => b.onclick = async () => { const p = L.periods.find(x => x.id === b.dataset.perdel); if (!confirm(`Удалить период «${p.name}» и его расписание?`)) return; L.periods.splice(L.periods.indexOf(p), 1); if (S.planSet === p.id) S.planSet = ''; await saveLifeCfg(); renderPlan(); });
    if ($('#pCancel')) $('#pCancel').onclick = () => { S.perEdit = null; renderPlan(); };
    $('#pSave').onclick = async () => {
      const name = $('#pName').value.trim(), from = $('#pFrom').value, to = $('#pTo').value;
      if (!name || !from || !to) { $('#pErr').textContent = '⚠ Укажи название и даты'; return; }
      if (to < from) { $('#pErr').textContent = '⚠ Конец раньше начала'; return; }
      const clash = L.periods.find(p => p.id !== S.perEdit && !(to < p.from || from > p.to)); if (clash) { $('#pErr').textContent = `⚠ Пересекается с «${clash.name}»`; return; }
      const ex = S.perEdit && L.periods.find(p => p.id === S.perEdit);
      if (ex) Object.assign(ex, { name, from, to }); else L.periods.push({ id: lid(), name, from, to, blocks: JSON.parse(JSON.stringify(L.week)).map(b => ({ ...b, id: lid() })) });
      S.perEdit = null; await saveLifeCfg(); toast('Период сохранён ✓'); renderPlan();
    };
  }
}

// ---------- Настройки «Сегодня»: обращение, трекеры, поля отчёта ----------
const TR_KINDS = { count: 'Счётчик (+/−)', minutes: 'Минуты', number: 'Число', check: 'Да / нет', checks: 'Несколько отметок', choice: 'Выбор варианта', scale5: 'Шкала 1–5', sleep: 'Сон (легла/встала)' };
function renderLifeSet() {
  const L = lifeCfg();
  $('#view').innerHTML = `<button class="ghost" id="lsBack" style="font-size:15px;padding:4px 0">‹ Сегодня</button><h2 style="margin-top:2px">⚙ Настройки «Сегодня»</h2>
    <div class="card" style="padding:10px 12px"><label class="f" style="margin-top:0">Как к тебе обращаться (для приветствия)</label><input class="in" id="lsName" value="${esc(L.name || '')}" placeholder="Имя (необязательно)"></div>
    <h2>Трекеры</h2><div class="card">${L.trackers.map((x, i) => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <label style="min-width:0"><input type="checkbox" data-tron="${i}" ${x.on ? 'checked' : ''}> ${x.icon} <b>${esc(x.name)}</b> <span class="sub">· ${TR_KINDS[x.kind] || x.kind}</span></label>
      <span style="white-space:nowrap">${i ? `<button class="mini-btn" data-trup="${i}">↑</button>` : ''}<button class="mini-btn" data-trdel="${i}">✕</button></span></div>
      <div class="grid2" style="margin-top:4px">${['count', 'minutes', 'number'].includes(x.kind) ? `<div><span class="sub">Цель в день</span><input class="in" inputmode="numeric" data-trgoal="${i}" value="${x.goal ?? ''}"></div>` : x.kind === 'sleep' ? `<div><span class="sub">Лечь до</span><input class="in" type="time" data-trgoal="${i}" value="${x.goal || ''}"></div>` : ['choice', 'checks'].includes(x.kind) ? `<div><span class="sub">Варианты через запятую</span><input class="in" data-tropt="${i}" value="${esc((x.options || []).join(', '))}"></div>` : '<div></div>'}
      ${x.kind !== 'scale5' ? `<label style="align-self:end;font-size:13px"><input type="checkbox" data-trstreak="${i}" ${x.streak ? 'checked' : ''}> считать серию 🔥</label>` : '<div></div>'}</div></div>`).join('')}</div>
    <div class="card" style="padding:10px 12px"><b>+ Свой трекер</b><div class="grid2"><div><label class="f">Название</label><input class="in" id="ntName" placeholder="Витамины, медитация…"></div><div><label class="f">Значок</label><input class="in" id="ntIcon" placeholder="✨" maxlength="4"></div></div>
      <label class="f">Тип</label><select class="in" id="ntKind">${Object.entries(TR_KINDS).filter(([k]) => k !== 'sleep').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn small" id="ntAdd">Добавить трекер</button></div>
    <h2>Поля вечернего отчёта</h2><div class="card">${L.reportFields.map((f, i) => `<div class="row"><input class="in" data-rflabel="${i}" value="${esc(f.label)}"><span style="white-space:nowrap">${i ? `<button class="mini-btn" data-rfup="${i}">↑</button>` : ''}<button class="mini-btn" data-rfdel="${i}">✕</button></span></div>`).join('')}
      <div class="row"><input class="in" id="nrf" placeholder="+ Новое поле: работа, дети, блог…"><button class="btn small" id="nrfAdd" style="margin:0">Добавить</button></div></div>
    <p class="muted">Трекеры, сон, настроение и отчёты хранятся на твоём устройстве и в твоём Google Диске (если включена синхронизация).</p>`;
  const sv = async () => { await saveLifeCfg(); renderLifeSet(); };
  $('#lsBack').onclick = () => setTab('today');
  $('#lsName').onchange = e => { L.name = e.target.value.trim(); saveLifeCfg().then(() => toast('Сохранено')); };
  document.querySelectorAll('[data-tron]').forEach(el => el.onchange = () => { L.trackers[+el.dataset.tron].on = el.checked; sv(); });
  document.querySelectorAll('[data-trstreak]').forEach(el => el.onchange = () => { L.trackers[+el.dataset.trstreak].streak = el.checked; sv(); });
  document.querySelectorAll('[data-trgoal]').forEach(el => el.onchange = () => { const x = L.trackers[+el.dataset.trgoal]; x.goal = x.kind === 'sleep' ? el.value : Math.max(0, Math.round(num(el.value))); sv(); });
  document.querySelectorAll('[data-tropt]').forEach(el => el.onchange = () => { L.trackers[+el.dataset.tropt].options = el.value.split(',').map(s => s.trim()).filter(Boolean); sv(); });
  document.querySelectorAll('[data-trup]').forEach(el => el.onclick = () => { const i = +el.dataset.trup; [L.trackers[i - 1], L.trackers[i]] = [L.trackers[i], L.trackers[i - 1]]; sv(); });
  document.querySelectorAll('[data-trdel]').forEach(el => el.onclick = () => { const x = L.trackers[+el.dataset.trdel]; if (!confirm(`Удалить трекер «${x.name}»? Старые отметки останутся в днях, но не будут показываться. Можно просто выключить галочкой.`)) return; L.trackers.splice(+el.dataset.trdel, 1); sv(); });
  $('#ntAdd').onclick = () => { const name = $('#ntName').value.trim(); if (!name) return; const kind = $('#ntKind').value; L.trackers.push({ id: 'u' + lid(), name, icon: $('#ntIcon').value.trim() || '✨', kind, goal: ['count', 'minutes', 'number'].includes(kind) ? 1 : undefined, options: ['choice', 'checks'].includes(kind) ? ['Да'] : undefined, on: true, streak: kind !== 'scale5' }); sv(); };
  document.querySelectorAll('[data-rflabel]').forEach(el => el.onchange = () => { L.reportFields[+el.dataset.rflabel].label = el.value.trim() || L.reportFields[+el.dataset.rflabel].label; sv(); });
  document.querySelectorAll('[data-rfup]').forEach(el => el.onclick = () => { const i = +el.dataset.rfup; [L.reportFields[i - 1], L.reportFields[i]] = [L.reportFields[i], L.reportFields[i - 1]]; sv(); });
  document.querySelectorAll('[data-rfdel]').forEach(el => el.onclick = () => { const f = L.reportFields[+el.dataset.rfdel]; if (!confirm(`Убрать поле «${f.label}»? Уже написанное в старых отчётах не удалится.`)) return; L.reportFields.splice(+el.dataset.rfdel, 1); sv(); });
  $('#nrfAdd').onclick = () => { const v = $('#nrf').value.trim(); if (!v) return; L.reportFields.push({ id: 'f' + lid(), label: v }); sv(); };
}

// ---------- Кнопка «+»: что добавить ----------
async function plusMenu() {
  const back = ['add'].includes(S.tab) ? 'today' : S.tab;
  const v = await askModal('<div style="font-size:30px">＋</div><b style="font-size:17px">Что добавить?</b><div style="height:6px"></div>',
    [{ t: '💸 Трата, доход, перевод', v: 'op' }, { t: '✅ Дело', v: 'task' }, { t: '💧 Отметить трекер', v: 'track', light: true }, { t: 'Отмена', v: '', light: true }]);
  if (v === 'op') { S.edit = null; S.draft = null; S.backTab = back; setTab('add'); }
  else if (v === 'task') { S.planSeg = 'tasks'; setTab('plan'); setTimeout(() => { const el = $('#tTitle'); if (el) el.focus(); }, 60); }
  else if (v === 'track') { setTab('today'); setTimeout(() => { const el = document.querySelector('.tgrid'); if (el) el.scrollIntoView({ block: 'start' }); }, 60); }
}
