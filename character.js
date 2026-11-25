'use strict';
/* Жизнь — раздел «Персонаж» (игра).
   Опыт (XP) считается из фактов: дни (отчёт, план, дела, трекеры), подцели и квесты, вехи, ачивки, бонусы.
   Ничего не «копится» отдельно — всё пересчитывается из данных, поэтому правка дня или вехи сразу видна в уровне.
   Настройки игры — S.cfg.game (характеристики с вехами, правила XP, сферы колеса, Прайм, перки, свои ачивки).
   Прогресс — в S.life (quests, ach, bonus, wheel, prime), синхронизируется по записям.
   Работает без ИИ: человек сам отмечает вехи и квесты; ИИ-помощник лишь подсказывает. Личного в коде нет. */

const RARITY = { common: { l: 'обычная', xp: 20, c: 'var(--c1)' }, rare: { l: 'редкая', xp: 50, c: 'var(--c3)' }, epic: { l: 'эпическая', xp: 100, c: 'var(--c7)' }, legendary: { l: 'легендарная', xp: 200, c: 'var(--c4)' } };
const QKIND = { main: '⭐ Главный', side: '🧩 Побочный', boss: '👑 Босс' };
const DEF_XP = { report: 20, block: 5, task: 10, tracker: 10, plan90: 20, sub: 30, mile: 50, mileHalf: 25 };
const XP_LABELS = { report: 'Вечерний отчёт', block: 'Блок плана дня', task: 'Выполненное дело', tracker: 'Выполненный трекер', plan90: 'План дня на 90%+ (бонус)', sub: 'Подцель квеста', mile: 'Веха выполнена', mileHalf: 'Половина вехи' };
const levelNeed = L => Math.round(100 * Math.pow(L, 1.5));

function defaultGame() {
  const t = today();
  const st = (id, name, icon) => ({ id, name, icon, miles: [], facets: [] });
  return {
    name: '', title: '', start: t, season: { name: 'Сезон 1', from: t, to: dAdd(t, 90) }, xp: { ...DEF_XP },
    stats: [st('str', 'Сила', '💪'), st('vit', 'Здоровье', '🫀'), st('int', 'Интеллект', '🧠'), st('chr', 'Харизма', '🗣'), st('wis', 'Мудрость', '🦉'), st('cap', 'Капитал', '💰'), st('art', 'Творчество', '🎨'), st('wil', 'Воля', '🔥')],
    perks: [], achievements: [], prime: [],
    spheres: ['Здоровье', 'Тело и спорт', 'Финансы', 'Работа и учёба', 'Отношения', 'Семья', 'Отдых и хобби', 'Саморазвитие', 'Внутреннее состояние', 'Дом и быт'],
  };
}
function gameCfg() {
  if (!S.cfg.game) S.cfg.game = defaultGame();
  const G = S.cfg.game, D = defaultGame();
  for (const k of ['stats', 'perks', 'achievements', 'prime', 'spheres']) if (!Array.isArray(G[k])) G[k] = D[k];
  G.xp = { ...DEF_XP, ...(G.xp || {}) }; if (!G.season) G.season = D.season; if (!G.start) G.start = D.start;
  return G;
}
function gameData() { const L = lifeData(); for (const k of ['quests', 'bonus']) if (!Array.isArray(L[k])) L[k] = []; for (const k of ['ach', 'wheel', 'prime']) if (!L[k] || typeof L[k] !== 'object') L[k] = {}; return L; }
async function putRec(coll, rec) { const L = gameData(); rec.updatedAt = Date.now(); rec.device = DEVICE; if (Array.isArray(L[coll])) { const i = L[coll].findIndex(x => x.id === rec.id); if (i < 0) L[coll].push(rec); else L[coll][i] = rec; } await saveLife(); }
async function putKey(coll, key, rec) { const L = gameData(); rec.updatedAt = Date.now(); rec.device = DEVICE; L[coll][key] = rec; await saveLife(); }

// ---------- Значения характеристик ----------
const milePts = m => m.state === 'done' ? 10 : m.state === 'half' ? 5 : 0;
const statVal = s => Math.min(100, (s.miles || []).reduce((a, m) => a + milePts(m), 0));
function facetVal(s, f) { const ms = (f.miles || []).map(i => s.miles[i - 1]).filter(Boolean); return ms.length ? Math.round(ms.reduce((a, m) => a + milePts(m), 0) / (ms.length * 10) * 100) : 0; }

// ---------- Прайм ----------
function primeAt(M) {   // последняя проверка Прайма на месяц M (или раньше)
  const P = gameData().prime, ks = Object.keys(P).filter(k => k <= M).sort();
  return ks.length ? { M: ks[ks.length - 1], s: P[ks[ks.length - 1]].s || {} } : null;
}
function primeScore(rec) { const G = gameCfg(); if (!rec || !G.prime.length) return { v: 0, n: G.prime.length, full: false }; const v = G.prime.reduce((a, p) => a + (+rec.s[p.id] || 0), 0); return { v, n: G.prime.length, full: G.prime.length > 0 && v >= G.prime.length }; }

// ---------- Опыт ----------
function dayXP(date) {
  const R = gameCfg().xp, d = day(date), parts = [];
  if (d.done) parts.push(['Отчёт', R.report]);
  const blocks = blocksFor(date), bDone = blocks.filter(b => d.blocks && d.blocks[b.id]).length;
  if (bDone) parts.push([`План: ${bDone} блок.`, bDone * R.block]);
  const tasks = liveTasks().filter(x => x.done && (x.doneAt || x.date) === date);
  if (tasks.length) parts.push([`Дела: ${tasks.length}`, tasks.length * R.task]);
  const trs = lifeCfg().trackers.filter(x => x.on && x.kind !== 'scale5' && trackerOk(x, d.t[x.id]));
  if (trs.length) parts.push([`Трекеры: ${trs.map(x => x.icon).join('')}`, trs.length * R.tracker]);
  const tot = blocks.length + liveTasks().filter(x => x.date === date).length, dn = bDone + liveTasks().filter(x => x.date === date && x.done).length;
  if (tot >= 3 && dn / tot >= 0.9) parts.push(['План на 90%+', R.plan90]);
  let xp = parts.reduce((a, p) => a + p[1], 0);
  if (xp && primeScore(primeAt(mkey(date))).full) { const b = Math.round(xp * 0.25); parts.push(['👑 Прайм ×1.25', b]); xp += b; }
  return { xp, parts };
}
// Все события с опытом: [{date, xp, what}]
function xpEvents() {
  const G = gameCfg(), L = gameData(), R = G.xp, ev = [], t = today();
  for (let d = G.start; d <= t; d = dAdd(d, 1)) { const x = dayXP(d); if (x.xp) ev.push({ date: d, xp: x.xp, what: 'День: ' + x.parts.map(p => p[0]).join(', ') }); if (ev.length > 5000) break; }
  for (const q of L.quests.filter(q => !q.deleted)) {
    for (const s of q.subs || []) if (s.done && s.doneAt) ev.push({ date: s.doneAt, xp: R.sub, what: `Подцель «${s.title}»` });
    if (q.done && q.doneAt) ev.push({ date: q.doneAt, xp: +q.reward || 0, what: `Квест «${q.title}»` });
  }
  for (const s of G.stats) for (const m of s.miles || []) if (m.state && m.date && !m.initial) ev.push({ date: m.date, xp: m.state === 'done' ? R.mile : R.mileHalf, what: `${s.icon} Веха «${m.title}»${m.state === 'half' ? ' (половина)' : ''}` });
  for (const [id, a] of Object.entries(L.ach)) if (a && a.date && !a.deleted) { const def = achDef(id); if (def) ev.push({ date: a.date, xp: RARITY[def.rarity].xp, what: `🏅 Ачивка «${def.name}»` }); }
  for (const b of L.bonus.filter(b => !b.deleted)) ev.push({ date: b.date, xp: +b.xp || 0, what: `🎁 ${b.reason}` });
  return ev.filter(e => e.xp).sort((a, b) => a.date.localeCompare(b.date));
}
function levelInfo(total) { let L = 1, x = total; while (x >= levelNeed(L) && L < 500) { x -= levelNeed(L); L++; } return { level: L, into: x, need: levelNeed(L), total }; }
function gameState() {
  const ev = xpEvents(), total = ev.reduce((a, e) => a + e.xp, 0), lv = levelInfo(total), t = today();
  // история уровней: дата, когда достигнут каждый уровень
  const ups = []; let acc = 0, L = 1, need = levelNeed(1);
  for (const e of ev) { acc += e.xp; while (acc >= need) { acc -= need; L++; ups.push({ level: L, date: e.date }); need = levelNeed(L); } }
  return { ev, total, ...lv, stars: Math.floor(total / 10), todayXP: ev.filter(e => e.date === t).reduce((a, e) => a + e.xp, 0), ups };
}

// ---------- Ачивки ----------
const AUTO_ACH = [
  { id: 'a:first', name: 'Первая глава', icon: '📝', rarity: 'common', cond: 'Первый вечерний отчёт' },
  { id: 'a:rep7', name: 'Неделя огня', icon: '🔥', rarity: 'common', cond: '7 отчётов подряд' },
  { id: 'a:rep30', name: 'Летописица', icon: '📚', rarity: 'rare', cond: '30 отчётов всего' },
  { id: 'a:sleep7', name: 'Жаворонок', icon: '🌙', rarity: 'rare', cond: '7 дней подряд трекер сна выполнен' },
  { id: 'a:plan100', name: 'Идеальный день', icon: '✨', rarity: 'common', cond: 'Весь план дня выполнен (3+ пункта)' },
  { id: 'a:quest1', name: 'Первый квест', icon: '🗺', rarity: 'common', cond: 'Выполнен первый квест' },
  { id: 'a:lvl5', name: 'Пятый уровень', icon: '⬆️', rarity: 'rare', cond: 'Уровень 5' },
  { id: 'a:lvl10', name: 'Десятый уровень', icon: '🚀', rarity: 'epic', cond: 'Уровень 10' },
  { id: 'a:stat50', name: 'Половина пути', icon: '⛰', rarity: 'epic', cond: 'Любая характеристика достигла 50' },
  { id: 'a:stat100', name: 'Легенда', icon: '👑', rarity: 'legendary', cond: 'Любая характеристика достигла 100' },
  { id: 'a:prime', name: 'В прайме', icon: '👑', rarity: 'legendary', cond: 'Впервые собраны все составляющие Прайма' },
];
const achDef = id => AUTO_ACH.find(a => a.id === id) || gameCfg().achievements.find(a => a.id === id);
// Проверка автоматических ачивок: находим дату, когда условие впервые выполнено, и сохраняем
async function checkAutoAch() {
  const G = gameCfg(), L = gameData(), t = today(), found = {};
  let run = 0, sleepRun = 0, reports = 0;
  const sleepTr = lifeCfg().trackers.find(x => x.kind === 'sleep' && x.on);
  for (let d = G.start; d <= t; d = dAdd(d, 1)) {
    const dd = day(d);
    if (dd.done) { reports++; run++; if (!found['a:first']) found['a:first'] = d; if (run >= 7 && !found['a:rep7']) found['a:rep7'] = d; if (reports >= 30 && !found['a:rep30']) found['a:rep30'] = d; } else if (d !== t) run = 0;
    if (sleepTr) { if (trackerOk(sleepTr, dd.t[sleepTr.id])) { sleepRun++; if (sleepRun >= 7 && !found['a:sleep7']) found['a:sleep7'] = d; } else if (d !== t) sleepRun = 0; }
    const bl = blocksFor(d), tk = liveTasks().filter(x => x.date === d), tot = bl.length + tk.length;
    if (tot >= 3 && bl.every(b => dd.blocks && dd.blocks[b.id]) && tk.every(x => x.done) && !found['a:plan100']) found['a:plan100'] = d;
  }
  const qd = L.quests.filter(q => q.done && !q.deleted && q.doneAt).map(q => q.doneAt).sort(); if (qd.length) found['a:quest1'] = qd[0];
  if (G.stats.some(s => statVal(s) >= 50)) found['a:stat50'] = t;
  if (G.stats.some(s => statVal(s) >= 100)) found['a:stat100'] = t;
  const pk = Object.keys(L.prime).sort().find(k => primeScore({ s: L.prime[k].s || {} }).full); if (pk) found['a:prime'] = pk + '-01' > G.start ? pk + '-01' : G.start;
  let changed = false;
  for (const [id, date] of Object.entries(found)) if (!L.ach[id]) { L.ach[id] = { date, auto: true, updatedAt: Date.now(), device: DEVICE }; changed = true; S.newAch = (S.newAch || []).concat(id); }
  // уровни — после пересчёта опыта (ачивки сами дают опыт)
  const lv = gameState().level;
  for (const [id, n] of [['a:lvl5', 5], ['a:lvl10', 10]]) if (lv >= n && !L.ach[id]) { const up = gameState().ups.find(u => u.level === n); L.ach[id] = { date: up ? up.date : t, auto: true, updatedAt: Date.now(), device: DEVICE }; changed = true; S.newAch = (S.newAch || []).concat(id); }
  if (changed) await saveLife();
  return changed;
}

// ---------- Мини-карточка на «Сегодня» ----------
function charMini() {
  const G = gameCfg(), gs = gameState(), pr = primeScore(primeAt(mkey(today())));
  return `<div class="charmini" id="charMini" role="button" tabindex="0">
    <div class="cm-top"><span class="cm-lvl">${gs.level}</span><div style="min-width:0;flex:1"><b>${esc(G.name || 'Мой персонаж')}</b>${G.title ? ` <span class="sub">· ${esc(G.title)}</span>` : ''}
      <div class="xpbar"><i style="width:${Math.round(gs.into / gs.need * 100)}%"></i></div>
      <div class="sub">${gs.into} / ${gs.need} XP до ${gs.level + 1} ур. · сегодня +${gs.todayXP} · ⭐ ${gs.stars}${G.prime.length ? ` · Прайм ${fmtHalf(pr.v)}/${pr.n}${pr.full ? ' 👑' : ''}` : ''}</div></div><span class="goarr">›</span></div></div>`;
}
const fmtHalf = v => String(v).replace('.', ',');

// ---------- Экран персонажа ----------
async function renderChar() {
  vizTipInit();
  if (await checkAutoAch()) { /* новые ачивки сохранены */ }
  const seg = S.charSeg || 'card';
  const segs = [['card', '🪪 Карточка'], ['stats', '📊 Характеристики'], ['quests', '🗺 Квесты'], ['ach', '🏅 Ачивки'], ['wheel', '🎡 Колесо и Прайм']];
  const body = { card: charCard, stats: charStats, quests: charQuests, ach: charAch, wheel: charWheel }[seg]();
  $('#view').innerHTML = `<button class="ghost" id="chBack" style="font-size:15px;padding:4px 0">‹ Сегодня</button>
    <div class="seg" style="margin:4px 0 10px">${segs.map(([k, l]) => `<button class="chip ${seg === k ? 'on' : ''}" data-chseg="${k}">${l}</button>`).join('')}</div>${body}`;
  $('#chBack').onclick = () => setTab('today');
  document.querySelectorAll('[data-chseg]').forEach(b => b.onclick = () => { S.charSeg = b.dataset.chseg; S.qEdit = null; renderChar(); });
  ({ card: bindCard, stats: bindStats, quests: bindQuests, ach: bindAch, wheel: bindWheel })[seg]();
  if (S.newAch && S.newAch.length) { const ids = S.newAch; S.newAch = []; const d = ids.map(achDef).filter(Boolean); if (d.length) toast(`🏅 Новая ачивка: ${d.map(a => a.icon + ' ' + a.name).join(', ')}`); }
}
const rer = () => { const y = scrollY; renderChar().then(() => scrollTo(0, y)); };

// --- Карточка
function charCard() {
  const G = gameCfg(), gs = gameState(), t = today(), sz = G.season;
  const sPct = sz.from && sz.to ? Math.max(0, Math.min(1, dDiff(t, sz.from) / Math.max(1, dDiff(sz.to, sz.from)))) : 0;
  const days = []; for (let i = 13; i >= 0; i--) { const d = dAdd(t, -i); days.push({ d, xp: gs.ev.filter(e => e.date === d).reduce((a, e) => a + e.xp, 0) }); }
  const mx = Math.max(20, ...days.map(x => x.xp));
  const bars = `<div class="xpdays">${days.map(x => `<div class="xpd" data-tip="${esc(dRu2(x.d) + '|' + x.xp + ' XP')}"><i style="height:${Math.round(x.xp / mx * 100)}%"></i><span>${+x.d.slice(8)}</span></div>`).join('')}</div>`;
  const recent = gs.ev.slice(-12).reverse();
  return `<div class="card charcard"><div class="cm-top"><span class="cm-lvl big">${gs.level}</span><div style="min-width:0;flex:1">
      <b style="font-size:18px">${esc(G.name || 'Мой персонаж')}</b>${G.title ? `<div class="sub">${esc(G.title)}</div>` : ''}
      <div class="xpbar"><i style="width:${Math.round(gs.into / gs.need * 100)}%"></i></div>
      <div class="sub">Уровень ${gs.level} · ${gs.into} / ${gs.need} XP до следующего · всего ${gs.total} XP · ⭐ ${gs.stars}</div></div></div>
    <div class="mrow" style="margin-top:8px"><span>⏳ ${esc(sz.name)}</span><span class="sub">${dRu2(sz.from)} — ${dRu2(sz.to)}</span></div>
    <div class="xpbar season"><i style="width:${Math.round(sPct * 100)}%"></i></div><div class="sub">${sz.to >= t ? `осталось ${dDiff(sz.to, t)} дн.` : 'сезон завершён'}</div></div>
    <h2>Опыт за 14 дней <span class="sub">· сегодня +${gs.todayXP}</span></h2><div class="card vcard viz">${bars}</div>
    <h2>За что опыт</h2><div class="card">${recent.map(e => `<div class="row"><span style="min-width:0"><span class="sub">${dRu2(e.date).slice(0, 5)}</span> ${esc(e.what)}</span><b class="pos">+${e.xp}</b></div>`).join('') || '<div class="row muted">Пока пусто: отметь план, трекеры или сдай вечерний отчёт.</div>'}</div>
    ${gs.ups.length ? `<h2>Уровни</h2><div class="card">${gs.ups.slice().reverse().slice(0, 10).map(u => `<div class="row"><span>⬆️ Уровень ${u.level}</span><span class="sub">${dRu2(u.date)}</span></div>`).join('')}</div>` : ''}
    <details class="card" style="padding:4px 12px"><summary style="font-weight:600">🎁 Бонус опыта</summary><div class="muted">За то, что приложение не видит само: например, ИИ-помощник по отчёту предложил +30 за сложный день. Пиши причину честно.</div>
      <div class="grid2"><input class="in" id="bnXp" inputmode="numeric" placeholder="XP, например 30"><input class="in" type="date" id="bnDate" value="${t}"></div>
      <input class="in" id="bnWhy" placeholder="За что" style="margin-top:8px"><button class="btn small" id="bnAdd" style="margin-bottom:8px">Начислить</button>
      ${gameData().bonus.filter(b => !b.deleted).slice(-5).reverse().map(b => `<div class="row"><span class="sub">${dRu2(b.date).slice(0, 5)} · ${esc(b.reason)}</span><span>+${b.xp} <button class="mini-btn" data-bndel="${b.id}">✕</button></span></div>`).join('')}</details>
    <details class="card" style="padding:4px 12px"><summary style="font-weight:600">⚙ Настройки игры</summary>
      <label class="f">Имя персонажа</label><input class="in" id="gName" value="${esc(G.name)}" placeholder="Как зовут персонажа">
      <label class="f">Титул (главное звание)</label><input class="in" id="gTitle" value="${esc(G.title)}" placeholder="Например: Картограф историй">
      <label class="f">Сезон</label><input class="in" id="gSzName" value="${esc(sz.name)}">
      <div class="grid2"><div><label class="f">С</label><input class="in" type="date" id="gSzFrom" value="${sz.from}"></div><div><label class="f">По</label><input class="in" type="date" id="gSzTo" value="${sz.to}"></div></div>
      <label class="f">Игра началась (опыт считается с этой даты)</label><input class="in" type="date" id="gStart" value="${G.start}">
      <b style="display:block;margin-top:12px">Правила опыта</b><table class="t tsm">${Object.keys(DEF_XP).map(k => `<tr><td>${XP_LABELS[k]}</td><td><input class="mini" style="width:70px" data-xpr="${k}" inputmode="numeric" value="${G.xp[k]}"></td></tr>`).join('')}
        ${Object.entries(RARITY).map(([, r]) => `<tr><td>Ачивка: ${r.l}</td><td>${r.xp}</td></tr>`).join('')}</table>
      <div class="muted">Уровень: до следующего нужно 100 × уровень^1,5 XP (1→2: 100, 5→6: ~1 120). ⭐ = 1 за каждые 10 XP.</div>
      <b style="display:block;margin-top:12px">Загрузить персонажа из файла</b><div class="muted">Файл .json (характеристики с вехами, Прайм, сферы колеса, перки, ачивки). Прогресс дней и квестов не меняется.</div>
      <label class="btn small light" style="cursor:pointer;margin-bottom:10px">Выбрать файл<input type="file" id="gImport" accept=".json" hidden></label></details>`;
}
function bindCard() {
  const G = gameCfg(), sv = () => saveCfg().then(rer);
  $('#gName').onchange = e => { G.name = e.target.value.trim(); sv(); };
  $('#gTitle').onchange = e => { G.title = e.target.value.trim(); sv(); };
  $('#gSzName').onchange = e => { G.season.name = e.target.value.trim() || G.season.name; sv(); };
  $('#gSzFrom').onchange = e => { G.season.from = e.target.value; sv(); };
  $('#gSzTo').onchange = e => { G.season.to = e.target.value; sv(); };
  $('#gStart').onchange = e => { if (e.target.value) { G.start = e.target.value; sv(); } };
  document.querySelectorAll('[data-xpr]').forEach(el => el.onchange = () => { G.xp[el.dataset.xpr] = Math.max(0, Math.round(num(el.value))); sv(); });
  $('#bnAdd').onclick = async () => { const xp = Math.round(num($('#bnXp').value)), why = $('#bnWhy').value.trim(); if (!xp || !why) { toast('Укажи XP и за что'); return; } await putRec('bonus', { id: lid(), date: $('#bnDate').value || today(), xp, reason: why }); toast(`+${xp} XP`); rer(); };
  document.querySelectorAll('[data-bndel]').forEach(b => b.onclick = async () => { const x = gameData().bonus.find(z => z.id === b.dataset.bndel); if (confirm('Отменить этот бонус?')) { await putRec('bonus', { ...x, deleted: true }); rer(); } });
  $('#gImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); if (data.app !== 'zhizn-game') throw new Error('это не файл персонажа');
      if (!confirm(`Загрузить «${data.title || f.name}»? Характеристики, вехи, Прайм, сферы и настройки игры заменятся.`)) return;
      for (const k of ['name', 'start', 'season', 'stats', 'perks', 'achievements', 'prime', 'spheres']) if (data[k] !== undefined) G[k] = data[k];
      if (data.charTitle !== undefined) G.title = data.charTitle;   // «title» в файле — это название самого файла
      if (data.xp) G.xp = { ...DEF_XP, ...data.xp };
      await saveCfg(); toast('Персонаж загружен ✓'); rer();
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
  };
}

// --- Характеристики
function charStats() {
  const G = gameCfg(), ed = S.statEdit;
  const perks = G.perks.map(p => { const s = G.stats.find(x => x.id === p.stat); return { ...p, s, open: s && statVal(s) >= +p.threshold }; });
  return `<div class="card">${G.stats.map(s => { const v = statVal(s);
    return `<details class="stat" ${S.statOpen === s.id ? 'open' : ''} data-stopen="${s.id}"><summary><div class="mrow"><span>${s.icon} <b>${esc(s.name)}</b>${s.hidden ? ' <span class="sub">· скрытая</span>' : ''}</span><b>${v}</b></div><div class="xpbar"><i style="width:${v}%"></i></div></summary>
      ${s.desc ? `<div class="sub" style="margin:4px 0">${esc(s.desc)}</div>` : ''}
      ${(s.facets || []).length ? `<div class="facets">${s.facets.map(f => `<div><span class="sub">${f.icon || ''} ${esc(f.name)}${f.priority ? ' ★' : ''}</span><div class="xpbar thin"><i style="width:${facetVal(s, f)}%"></i></div></div>`).join('')}</div>` : ''}
      ${ed === s.id ? statEditor(s) : `${(s.miles || []).map((m, i) => `<div class="mile ${m.state || ''}"><div class="mrow"><span style="min-width:0"><span class="sub">${i + 1}.</span> ${esc(m.title)}</span>
          <span class="mst">${[['', '—'], ['half', '◐'], ['done', '✅']].map(([k, l]) => `<button class="${(m.state || '') === k ? 'on' : ''}" data-mst="${s.id}|${i}|${k}">${l}</button>`).join('')}</span></div>
          ${m.full || m.half || m.eta ? `<div class="sub">${m.full ? '✅ ' + esc(m.full) : ''}${m.half ? '<br>◐ ' + esc(m.half) : ''}${m.eta ? '<br>⏳ ' + esc(m.eta) : ''}</div>` : ''}
          ${m.state ? `<input class="in mfact" data-mfact="${s.id}|${i}" value="${esc(m.fact || '')}" placeholder="Факт: чем подтверждено"><div class="sub">${m.initial ? 'стартовое значение' : m.date ? 'отмечено ' + dRu2(m.date) : ''}</div>` : ''}</div>`).join('') || '<div class="muted">Вех пока нет.</div>'}
        <button class="btn small light" data-stedit="${s.id}">✎ Изменить вехи и грани</button>`}</details>`; }).join('')}</div>
    <div class="card" style="padding:10px 12px"><b>+ Характеристика</b><div class="grid2"><input class="in" id="nsName" placeholder="Название"><input class="in" id="nsIcon" placeholder="Значок" maxlength="4"></div><button class="btn small" id="nsAdd">Добавить</button></div>
    <h2>Перки</h2><div class="card">${perks.map((p, i) => `<div class="row"><span style="min-width:0">${p.open ? '🔓' : '🔒'} <b>${esc(p.name)}</b><div class="sub">${p.s ? esc(p.s.name) + ' ' + p.threshold : ''} · ${esc(p.effect || '')}</div></span><button class="mini-btn" data-pkdel="${i}">✕</button></div>`).join('') || '<div class="row muted">Перков пока нет — постоянные бонусы за пороги характеристик (25, 50, 75, 100).</div>'}
      <div class="row" style="display:block"><div class="grid2"><input class="in" id="pkName" placeholder="Название перка"><select class="in" id="pkStat">${G.stats.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div class="grid2" style="margin-top:6px"><input class="in" id="pkThr" inputmode="numeric" placeholder="Порог, напр. 25"><input class="in" id="pkEff" placeholder="Эффект"></div><button class="btn small" id="pkAdd">Добавить перк</button></div></div>
    <p class="muted">Вехи — только по фактам: отчёт, замер, документ. Веха +10, половина +5, максимум 100. Выполненная веха даёт ${G.xp.mile} XP, половина — ${G.xp.mileHalf} XP.</p>`;
}
function statEditor(s) {
  return `<div class="stedit">${(s.miles || []).map((m, i) => `<div class="card" style="padding:8px"><div class="mrow"><b>${i + 1}.</b><button class="mini-btn" data-mdel="${i}">✕ удалить</button></div>
      <input class="in" data-me="${i}|title" value="${esc(m.title)}" placeholder="Веха"><input class="in" data-me="${i}|full" value="${esc(m.full || '')}" placeholder="Засчитывается (+10), если…" style="margin-top:4px">
      <input class="in" data-me="${i}|half" value="${esc(m.half || '')}" placeholder="Половина (+5)" style="margin-top:4px"><input class="in" data-me="${i}|eta" value="${esc(m.eta || '')}" placeholder="Ориентир срока" style="margin-top:4px"></div>`).join('')}
    <button class="btn small light" id="mAdd">+ Веха</button>
    <label class="f">Описание характеристики</label><input class="in" id="sDesc" value="${esc(s.desc || '')}">
    <label class="f">Грани (по строке: название = номера вех через запятую), необязательно</label><textarea class="in" rows="3" id="sFacets" placeholder="Кор и осанка = 3, 8">${esc((s.facets || []).map(f => `${f.name} = ${(f.miles || []).join(', ')}`).join('\n'))}</textarea>
    <div class="grid2"><button class="btn small" id="sDone">Готово</button><button class="btn small danger" id="sDel">Удалить характеристику</button></div></div>`;
}
function bindStats() {
  const G = gameCfg(), sv = () => saveCfg().then(rer), st = id => G.stats.find(s => s.id === id);
  document.querySelectorAll('[data-stopen]').forEach(d => d.addEventListener('toggle', () => { if (d.open) S.statOpen = d.dataset.stopen; else if (S.statOpen === d.dataset.stopen) S.statOpen = null; }));
  document.querySelectorAll('[data-mst]').forEach(b => b.onclick = e => { e.preventDefault(); const [id, i, k] = b.dataset.mst.split('|'), m = st(id).miles[+i]; if ((m.state || '') === k) return; m.state = k; m.date = k ? today() : ''; delete m.initial; if (!k) m.fact = ''; S.statOpen = id; sv(); });
  document.querySelectorAll('[data-mfact]').forEach(el => el.onchange = () => { const [id, i] = el.dataset.mfact.split('|'); st(id).miles[+i].fact = el.value.trim(); saveCfg(); });
  document.querySelectorAll('[data-stedit]').forEach(b => b.onclick = () => { S.statEdit = b.dataset.stedit; S.statOpen = b.dataset.stedit; rer(); });
  if (S.statEdit) {
    const s = st(S.statEdit);
    document.querySelectorAll('[data-me]').forEach(el => el.onchange = () => { const [i, k] = el.dataset.me.split('|'); s.miles[+i][k] = el.value.trim(); saveCfg(); });
    document.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { if (confirm('Удалить веху?')) { s.miles.splice(+b.dataset.mdel, 1); sv(); } });
    $('#mAdd').onclick = () => { s.miles.push({ title: 'Новая веха', full: '', half: '', eta: '', state: '' }); sv(); };
    $('#sDesc').onchange = e => { s.desc = e.target.value.trim(); saveCfg(); };
    $('#sDone').onclick = () => {
      s.facets = $('#sFacets').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, r] = l.split('='); const old = (s.facets || []).find(f => f.name === n.trim()) || {}; return { ...old, name: n.trim(), miles: (r || '').split(',').map(x => +x.trim()).filter(x => x > 0) }; });
      S.statEdit = null; sv();
    };
    $('#sDel').onclick = () => { if (!confirm(`Удалить характеристику «${s.name}» со всеми вехами?`)) return; G.stats.splice(G.stats.indexOf(s), 1); S.statEdit = null; sv(); };
  }
  $('#nsAdd').onclick = () => { const n = $('#nsName').value.trim(); if (!n) return; G.stats.push({ id: 's' + lid(), name: n, icon: $('#nsIcon').value.trim() || '⭐', miles: [], facets: [] }); sv(); };
  document.querySelectorAll('[data-pkdel]').forEach(b => b.onclick = () => { if (confirm('Удалить перк?')) { G.perks.splice(+b.dataset.pkdel, 1); sv(); } });
  $('#pkAdd').onclick = () => { const n = $('#pkName').value.trim(); if (!n) return; G.perks.push({ name: n, stat: $('#pkStat').value, threshold: Math.round(num($('#pkThr').value)) || 25, effect: $('#pkEff').value.trim() }); sv(); };
}

// --- Квесты
function charQuests() {
  const L = gameData(), qs = L.quests.filter(q => !q.deleted), t = today(), ed = S.qEdit ? qs.find(q => q.id === S.qEdit) : null, f = ed || { kind: 'main', title: '', deadline: '', reward: 200, subs: [], desc: '' };
  const card = q => { const n = (q.subs || []).length, dn = (q.subs || []).filter(s => s.done).length, p = q.done ? 1 : n ? dn / n : 0;
    const late = !q.done && q.deadline && q.deadline < t;
    return `<div class="card quest ${q.done ? 'qdone' : ''}" style="padding:10px 12px"><div class="mrow"><span style="min-width:0"><span class="sub">${QKIND[q.kind] || ''}</span><br><b>${esc(q.title)}</b></span><span style="white-space:nowrap"><button class="mini-btn" data-qedit="${q.id}">✎</button><button class="mini-btn" data-qdel="${q.id}">✕</button></span></div>
      ${q.desc ? `<div class="sub">${esc(q.desc)}</div>` : ''}
      <div class="xpbar ${q.kind === 'boss' ? 'boss' : ''}"><i style="width:${Math.round(p * 100)}%"></i></div>
      <div class="sub">${q.kind === 'boss' ? `Здоровье босса: ${Math.round((1 - p) * 100)}%` : `${Math.round(p * 100)}%`}${n ? ` · подцели ${dn}/${n}` : ''}${q.deadline ? ` · срок ${dRu2(q.deadline)}${late ? ' <span class="neg">просрочен</span>' : ''}` : ''} · награда ${q.reward || 0} XP</div>
      ${(q.subs || []).map((s, i) => `<label class="prow ${s.done ? 'done' : ''}"><input type="checkbox" data-qsub="${q.id}|${i}" ${s.done ? 'checked' : ''}><span class="ptitle">${esc(s.title)}</span>${s.done && s.doneAt ? `<span class="sub">${dRu2(s.doneAt).slice(0, 5)}</span>` : ''}</label>`).join('')}
      ${q.done ? `<div class="ok" style="margin-top:6px">🏆 Выполнен ${dRu2(q.doneAt)} <button class="mini-btn" data-qundo="${q.id}">вернуть</button></div>` : `<button class="btn small" data-qdone="${q.id}">🏆 Квест выполнен</button>`}</div>`; };
  const groups = [['main', 'Главные'], ['boss', 'Боссы'], ['side', 'Побочные']];
  return `${groups.map(([k, l]) => { const list = qs.filter(q => q.kind === k && !q.done); return list.length ? `<h2>${l}</h2>${list.map(card).join('')}` : ''; }).join('')}
    ${qs.some(q => q.done) ? `<details class="card" style="padding:4px 12px"><summary style="font-weight:600">🏆 Выполненные (${qs.filter(q => q.done).length})</summary>${qs.filter(q => q.done).map(card).join('')}</details>` : ''}
    ${!qs.length ? '<div class="muted">Квестов пока нет. Главный квест — большая цель сезона, побочный — разовое дело, босс — большое испытание (сессия, экзамен).</div>' : ''}
    <div class="card" style="padding:10px 12px" id="qForm"><b>${ed ? 'Изменить квест' : '+ Новый квест'}</b>
      <div class="seg" style="margin-top:6px">${Object.entries(QKIND).map(([k, l]) => `<button class="chip ${f.kind === k ? 'on' : ''}" data-qkind="${k}">${l}</button>`).join('')}</div>
      <label class="f">Название</label><input class="in" id="qTitle" value="${esc(f.title)}">
      <label class="f">Описание (необязательно)</label><input class="in" id="qDesc" value="${esc(f.desc || '')}">
      <div class="grid2"><div><label class="f">Срок</label><input class="in" type="date" id="qDl" value="${f.deadline || ''}"></div><div><label class="f">Награда, XP</label><input class="in" id="qRw" inputmode="numeric" value="${f.reward}"></div></div>
      <label class="f">Подцели — каждая с новой строки (за каждую ${gameCfg().xp.sub} XP)</label><textarea class="in" rows="4" id="qSubs">${esc((f.subs || []).map(s => s.title).join('\n'))}</textarea>
      <div class="err" id="qErr"></div><button class="btn small" id="qSave">${ed ? 'Сохранить' : 'Создать квест'}</button>${ed ? '<button class="btn small light" id="qCancel">Отмена</button>' : ''}</div>`;
}
function bindQuests() {
  const L = gameData(), q = id => L.quests.find(x => x.id === id);
  let kind = S.qEdit ? q(S.qEdit).kind : 'main';
  document.querySelectorAll('[data-qkind]').forEach(b => b.onclick = () => { kind = b.dataset.qkind; document.querySelectorAll('[data-qkind]').forEach(x => x.classList.toggle('on', x === b)); });
  document.querySelectorAll('[data-qsub]').forEach(el => el.onchange = async () => { const [id, i] = el.dataset.qsub.split('|'), x = JSON.parse(JSON.stringify(q(id))); x.subs[+i].done = el.checked; x.subs[+i].doneAt = el.checked ? today() : ''; await putRec('quests', x); if (el.checked) toast(`+${gameCfg().xp.sub} XP`); rer(); });
  document.querySelectorAll('[data-qdone]').forEach(b => b.onclick = async () => { const x = q(b.dataset.qdone); if (!confirm(`Квест «${x.title}» выполнен? +${x.reward || 0} XP`)) return; await putRec('quests', { ...x, done: true, doneAt: today() }); toast(`🏆 +${x.reward || 0} XP`); rer(); });
  document.querySelectorAll('[data-qundo]').forEach(b => b.onclick = async () => { const x = q(b.dataset.qundo); await putRec('quests', { ...x, done: false, doneAt: '' }); rer(); });
  document.querySelectorAll('[data-qedit]').forEach(b => b.onclick = () => { S.qEdit = b.dataset.qedit; rer(); setTimeout(() => $('#qForm').scrollIntoView({ block: 'center' }), 50); });
  document.querySelectorAll('[data-qdel]').forEach(b => b.onclick = async () => { const x = q(b.dataset.qdel); if (confirm(`Удалить квест «${x.title}»? Его опыт пропадёт.`)) { await putRec('quests', { ...x, deleted: true }); rer(); } });
  if ($('#qCancel')) $('#qCancel').onclick = () => { S.qEdit = null; rer(); };
  $('#qSave').onclick = async () => {
    const title = $('#qTitle').value.trim(); if (!title) { $('#qErr').textContent = '⚠ Название'; return; }
    const lines = $('#qSubs').value.split('\n').map(s => s.trim()).filter(Boolean), old = S.qEdit ? q(S.qEdit) : null;
    const subs = lines.map(tl => { const o = old && (old.subs || []).find(s => s.title === tl); return o ? { ...o } : { title: tl, done: false, doneAt: '' }; });
    await putRec('quests', { ...(old || { id: lid(), done: false, doneAt: '', createdAt: Date.now() }), kind, title, desc: $('#qDesc').value.trim(), deadline: $('#qDl').value || '', reward: Math.max(0, Math.round(num($('#qRw').value))), subs });
    S.qEdit = null; toast('Квест сохранён'); rer();
  };
}

// --- Ачивки
function charAch() {
  const G = gameCfg(), L = gameData(), all = [...AUTO_ACH.map(a => ({ ...a, auto: true })), ...G.achievements];
  const got = all.filter(a => L.ach[a.id] && L.ach[a.id].date && !L.ach[a.id].deleted), rest = all.filter(a => !got.includes(a));
  const medal = (a, have) => `<div class="medal ${have ? '' : 'locked'}" style="--rc:${RARITY[a.rarity].c}"><div class="mi">${a.icon}</div><div style="min-width:0;flex:1"><b>${esc(a.name)}</b><div class="sub">${esc(a.cond || '')} · ${RARITY[a.rarity].l} · +${RARITY[a.rarity].xp} XP</div>
      ${have ? `<div class="sub">🏅 ${dRu2(L.ach[a.id].date)}${L.ach[a.id].fact ? ' · ' + esc(L.ach[a.id].fact) : ''}</div>` : ''}</div>
      ${a.auto ? (have ? '' : '<span class="sub">сама</span>') : have ? `<button class="mini-btn" data-achun="${a.id}">↺</button>` : `<button class="mini-btn" data-achget="${a.id}">✓</button>`}</div>`;
  return `<h2>🏛 Зал славы <span class="sub">${got.length} из ${all.length}</span></h2><div class="card">${got.map(a => medal(a, true)).join('') || '<div class="row muted">Пока пусто — первая ачивка за первый вечерний отчёт.</div>'}</div>
    <h2>Впереди</h2><div class="card">${rest.map(a => medal(a, false)).join('')}</div>
    <div class="card" style="padding:10px 12px"><b>+ Своя ачивка</b><div class="muted">Отмечаешь её сама, когда выполнишь условие.</div>
      <div class="grid2"><input class="in" id="naName" placeholder="Название"><input class="in" id="naIcon" placeholder="Значок" maxlength="4"></div>
      <input class="in" id="naCond" placeholder="Условие" style="margin-top:6px"><select class="in" id="naRar" style="margin-top:6px">${Object.entries(RARITY).map(([k, r]) => `<option value="${k}">${r.l} (+${r.xp} XP)</option>`).join('')}</select>
      <button class="btn small" id="naAdd">Добавить</button></div>
    ${G.achievements.length ? `<details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Удалить свою ачивку</summary>${G.achievements.map((a, i) => `<div class="row"><span>${a.icon} ${esc(a.name)}</span><button class="mini-btn" data-nadel="${i}">✕</button></div>`).join('')}</details>` : ''}`;
}
function bindAch() {
  const G = gameCfg(), L = gameData();
  document.querySelectorAll('[data-achget]').forEach(b => b.onclick = async () => { const a = achDef(b.dataset.achget); const fact = prompt(`«${a.name}»: чем подтверждено? (дата сегодня)`, ''); if (fact === null) return; await putKey('ach', a.id, { date: today(), fact: fact.trim() }); toast(`🏅 ${a.name} · +${RARITY[a.rarity].xp} XP`); rer(); });
  document.querySelectorAll('[data-achun]').forEach(b => b.onclick = async () => { if (!confirm('Снять эту ачивку?')) return; await putKey('ach', b.dataset.achun, { date: '', deleted: true }); rer(); });
  $('#naAdd').onclick = async () => { const n = $('#naName').value.trim(); if (!n) return; G.achievements.push({ id: 'c' + lid(), name: n, icon: $('#naIcon').value.trim() || '🏅', cond: $('#naCond').value.trim(), rarity: $('#naRar').value }); await saveCfg(); rer(); };
  document.querySelectorAll('[data-nadel]').forEach(b => b.onclick = async () => { const a = G.achievements[+b.dataset.nadel]; if (!confirm(`Удалить «${a.name}»?`)) return; G.achievements.splice(+b.dataset.nadel, 1); delete L.ach[a.id]; await saveCfg(); await saveLife(); rer(); });
}

// --- Колесо баланса и Прайм
const weekKey = d => dAdd(d, -(isoWd(d) - 1));
function radar(spheres, series) {
  const n = spheres.length; if (n < 3) return '<div class="muted">Нужно хотя бы 3 сферы</div>';
  const W = 320, H = 300, cx = W / 2, cy = H / 2 + 4, R = 105, ang = i => -Math.PI / 2 + i * 2 * Math.PI / n, pt = (i, v) => [cx + R * v / 10 * Math.cos(ang(i)), cy + R * v / 10 * Math.sin(ang(i))];
  let g = [2, 4, 6, 8, 10].map(v => `<polygon points="${spheres.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" class="vgrid"/>`).join('');
  g += spheres.map((s, i) => { const [x, y] = pt(i, 10), [lx, ly] = pt(i, 12.3); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="vgrid"/><text x="${lx}" y="${ly}" class="vax" text-anchor="${Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end'}" dominant-baseline="middle">${esc(s.length > 14 ? s.slice(0, 13) + '…' : s)}</text>`; }).join('');
  for (const se of series) {
    const pts = spheres.map((s, i) => pt(i, +se.vals[s] || 0));
    g += `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="${se.color}" fill-opacity="${se.fill || 0.15}" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="4 3"' : ''}/>`;
    g += pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${se.color}" stroke="var(--card)" stroke-width="2" data-tip="${esc(spheres[i] + '|' + se.name + ': ' + (se.vals[spheres[i]] || '—'))}"/>`).join('');
  }
  return `<div class="viz">${series.length > 1 ? legend(series) : ''}<svg viewBox="-20 0 ${W + 40} ${H}" role="img" aria-label="Колесо баланса">${g}</svg></div>`;
}
function charWheel() {
  const G = gameCfg(), L = gameData(), wk = S.wheelWeek || weekKey(today()), cur = (L.wheel[wk] || {}).s || {}, prevK = dAdd(wk, -7), prev = (L.wheel[prevK] || {}).s || {};
  const hist = Object.keys(L.wheel).sort().slice(-8);
  const M = S.primeM || mkey(today()), prRec = (L.prime[M] || {}).s || {}, ps = primeScore({ s: prRec });
  const low = G.spheres.filter(s => cur[s] && cur[s] < 4);
  return `<h2>🎡 Колесо баланса <span class="sub">· неделя с ${dRu2(wk).slice(0, 5)}</span></h2>
    <div class="card vcard">${radar(G.spheres, [{ name: 'Эта неделя', color: 'var(--c1)', vals: cur, fill: 0.18 }, ...(Object.keys(prev).length ? [{ name: 'Прошлая', color: 'var(--c2)', vals: prev, fill: 0, dash: true }] : [])])}
      <div class="mrow"><button class="mini-btn" data-wk="-7">‹ неделя</button><span class="sub">Оценка 1–10 · лучше по воскресеньям</span><button class="mini-btn" data-wk="7">неделя ›</button></div></div>
    ${low.length ? `<div class="warn">⚠ Проседает: ${low.map(esc).join(', ')} — возьми квест баланса на эту сферу</div>` : ''}
    <div class="card">${G.spheres.map(s => `<div class="row" style="display:block"><div class="mrow"><span>${esc(s)}</span><b>${cur[s] || '—'}${prev[s] && cur[s] ? ` <span class="sub ${cur[s] > prev[s] ? 'pos' : cur[s] < prev[s] ? 'neg' : ''}">${cur[s] > prev[s] ? '▲' : cur[s] < prev[s] ? '▼' : '='}</span>` : ''}</b></div>
      <div class="scale10">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => `<button class="${cur[s] === k ? 'on' : ''}" data-wh="${esc(s)}|${k}">${k}</button>`).join('')}</div></div>`).join('')}</div>
    ${hist.length > 1 ? `<details class="card" style="padding:4px 12px"><summary style="font-weight:600">История по неделям</summary><table class="t tsm"><tr><th>Сфера</th>${hist.map(k => `<th>${dRu2(k).slice(0, 5)}</th>`).join('')}</tr>${G.spheres.map(s => `<tr><td>${esc(s)}</td>${hist.map(k => `<td>${((L.wheel[k] || {}).s || {})[s] || '·'}</td>`).join('')}</tr>`).join('')}</table></details>` : ''}
    <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Изменить сферы</summary><textarea class="in" rows="6" id="whSph">${esc(G.spheres.join('\n'))}</textarea><button class="btn small" id="whSave" style="margin-bottom:8px">Сохранить сферы</button></details>
    <h2>👑 Прайм <span class="sub">· ${mlabel(M)} · ${fmtHalf(ps.v)}/${ps.n}${ps.full ? ' 👑' : ''}</span></h2>
    ${G.prime.length ? `<div class="card">${G.prime.map(p => `<div class="row"><span style="min-width:0">${p.icon || ''} ${esc(p.name)}${p.cond ? `<div class="sub">${esc(p.cond)}</div>` : ''}</span><span class="mst">${[[0, 'нет'], [0.5, '◐'], [1, '✅']].map(([v, l]) => `<button class="${(+prRec[p.id] || 0) === v ? 'on' : ''}" data-pr="${p.id}|${v}">${l}</button>`).join('')}</span></div>`).join('')}
      <div class="mrow" style="padding:6px 0"><button class="mini-btn" data-pm="-1">‹ месяц</button><span class="sub">Проверка раз в месяц, в день замеров. 6 из 6 — опыт ×1,25</span><button class="mini-btn" data-pm="1">месяц ›</button></div></div>`
      : '<div class="muted">Прайм — твоё лучшее состояние из нескольких составляющих. Добавь их ниже.</div>'}
    <details class="card" style="padding:4px 12px"><summary class="muted" style="font-weight:600">Изменить составляющие Прайма</summary><div class="muted">По строке: значок название = условие</div><textarea class="in" rows="6" id="prList">${esc(G.prime.map(p => `${p.icon || ''} ${p.name}${p.cond ? ' = ' + p.cond : ''}`.trim()).join('\n'))}</textarea><button class="btn small" id="prSave" style="margin-bottom:8px">Сохранить</button></details>`;
}
function bindWheel() {
  const G = gameCfg(), L = gameData(), wk = S.wheelWeek || weekKey(today()), M = S.primeM || mkey(today());
  document.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => { const n = dAdd(wk, +b.dataset.wk); if (n <= weekKey(today())) { S.wheelWeek = n; rer(); } });
  document.querySelectorAll('[data-wh]').forEach(b => b.onclick = async () => { const [s, k] = b.dataset.wh.split('|'); const rec = JSON.parse(JSON.stringify(L.wheel[wk] || { s: {} })); rec.s = rec.s || {}; rec.s[s] = +k; await putKey('wheel', wk, rec); rer(); });
  $('#whSave').onclick = async () => { const l = $('#whSph').value.split('\n').map(s => s.trim()).filter(Boolean); if (l.length < 3) { toast('Нужно хотя бы 3 сферы'); return; } G.spheres = l; await saveCfg(); rer(); };
  document.querySelectorAll('[data-pr]').forEach(b => b.onclick = async () => { const [id, v] = b.dataset.pr.split('|'); const rec = JSON.parse(JSON.stringify(L.prime[M] || { s: {} })); rec.s = rec.s || {}; rec.s[id] = +v; await putKey('prime', M, rec); rer(); });
  document.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { const n = mshift(M, +b.dataset.pm); if (n <= mkey(today())) { S.primeM = n; rer(); } });
  $('#prSave').onclick = async () => {
    G.prime = $('#prList').value.split('\n').map(s => s.trim()).filter(Boolean).map(l => { const [a, cond] = l.split('='); const m = a.trim().match(/^(\S+)\s+(.+)$/); const isIcon = m && !/[A-Za-zА-Яа-яЁё0-9]/.test(m[1]); const name = isIcon ? m[2].trim() : a.trim(); const old = G.prime.find(p => p.name === name); return { id: old ? old.id : 'p' + lid(), icon: isIcon ? m[1] : '', name, cond: (cond || '').trim() }; });
    await saveCfg(); rer();
  };
}
