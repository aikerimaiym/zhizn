'use strict';
/* Жизнь — игра, часть 2: шкалы потребностей и баффы, навыки и звания, награды за ⭐ с фондом радости, День нового уровня, аватар.
   Подключается после character.js. Всё считается из фактов дня (трекеры, план, отчёт) и настраивается любым человеком. */

// ---------- Настройки по умолчанию (общие) ----------
function defaultGame2() {
  return {
    gauges: [
      { id: 'sleep', name: 'Сон', icon: '😴', drop: 40, rules: [{ t: 'sleepH', tr: 'sleep', min: 7, max: 9, pts: 40 }, { t: 'ok', tr: 'sleep', pts: 10 }] },
      { id: 'food', name: 'Питание', icon: '🍽', drop: 35, rules: [{ t: 'manual', pts: 12, label: 'приём пищи' }] },
      { id: 'water', name: 'Вода', icon: '💧', drop: 50, rules: [{ t: 'per', tr: 'water', pts: 7 }] },
      { id: 'move', name: 'Движение', icon: '🏃', drop: 15, rules: [{ t: 'ok', tr: 'workout', pts: 40 }, { t: 'ok', tr: 'steps', pts: 15 }] },
      { id: 'care', name: 'Уход', icon: '🧴', drop: 20, rules: [{ t: 'opt', tr: 'care', pts: 12 }] },
      { id: 'social', name: 'Общение', icon: '💬', drop: 10, rules: [{ t: 'manual', pts: 15, label: 'тёплый разговор' }] },
      { id: 'joy', name: 'Радость', icon: '🎈', drop: 15, rules: [{ t: 'manual', pts: 15, label: 'радость' }] },
    ],
    energyFrom: ['sleep', 'food', 'move'],
    buffs: [
      { id: 'flow', name: 'В потоке', icon: '🔥', type: 'planStreak', n: 3, pct: 0.9, days: 2, mult: 1.5, text: 'XP ×1.5' },
      { id: 'iron', name: 'Железная леди', icon: '🛡', type: 'combo', trs: ['sleep', 'workout', 'water'], mult: 1.1, text: 'Сон + тренировка + вода за день: XP ×1.1' },
      { id: 'mode', name: 'Режим', icon: '🌙', type: 'trackerStreak', tr: 'sleep', n: 3, energy: 15, text: 'Отбой вовремя 3 дня: энергия +15' },
      { id: 'owl', name: 'Сова', icon: '🦉', type: 'sleepAfter', time: '02:00', energy: -20, debuff: true, text: 'Легла после 02:00: энергия −20 на день' },
      { id: 'burn', name: 'Выгорание', icon: '🥀', type: 'gaugeLow', g: 'energy', below: 20, n: 2, mult: 0.5, debuff: true, text: 'Энергия ниже 20 два дня: XP ×0.5 — нужен день отдыха' },
    ],
    skills: [], titles: [],
    rewards: [
      { id: 'r1', name: 'Вечер сериала', icon: '📺', stars: 30, money: 0 },
      { id: 'r2', name: 'Час без плана', icon: '🛋', stars: 20, money: 0 },
      { id: 'r3', name: 'День без будильника', icon: '😴', stars: 120, money: 0 },
      { id: 'r4', name: 'Долгая прогулка', icon: '🚶', stars: 40, money: 0 },
    ],
    cards: [
      { id: 'k1', name: 'Прогулка по новому маршруту', icon: '🗺', money: 0 },
      { id: 'k2', name: 'Фильм, который давно хотела посмотреть', icon: '🎬', money: 0 },
      { id: 'k3', name: 'Ванна с маской', icon: '🛁', money: 0 },
      { id: 'k4', name: 'Приготовить новое блюдо', icon: '🍳', money: 0 },
      { id: 'k5', name: 'Фотопрогулка', icon: '📷', money: 0 },
      { id: 'k6', name: 'Час любимого хобби', icon: '🎨', money: 0 },
    ],
    fund: { limit: 0, cat: '', sub: '', account: '' },
  };
}
function g2() {
  const G = gameCfg(), D = defaultGame2();
  for (const k of ['gauges', 'buffs', 'skills', 'titles', 'rewards', 'cards', 'energyFrom']) if (!Array.isArray(G[k])) G[k] = D[k];
  if (!G.fund) G.fund = D.fund;
  return G;
}
function g2data() { const L = gameData(); for (const k of ['buys', 'skillLog']) if (!Array.isArray(L[k])) L[k] = []; if (!L.lvl || typeof L.lvl !== 'object') L.lvl = {}; return L; }

// ---------- Симуляция дней: шкалы и баффы ----------
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
function sleepHours(v) { const b = tmin(v && v.bed), w = tmin(v && v.wake); if (b === null || w === null) return null; let m = w - b; if (m <= 0) m += 1440; return m / 60; }
function ruleGain(r, d) {
  const tr = lifeCfg().trackers.find(x => x.id === r.tr), v = d.t[r.tr];
  switch (r.t) {
    case 'per': return (+v || 0) * r.pts;
    case 'ok': return tr && tr.on && trackerOk(tr, v) ? r.pts : 0;
    case 'opt': return Array.isArray(v) ? v.length * r.pts : 0;
    case 'sleepH': { const h = sleepHours(v); return h !== null && h >= r.min && h <= r.max ? r.pts : h !== null && h >= r.min - 1 ? Math.round(r.pts / 2) : 0; }
    case 'manual': return 0;
    default: return 0;
  }
}
let SIM = null;
function simulate() {
  if (SIM) return SIM;
  const G = g2(), t = today(), out = {}, start = dAdd(G.start, -14) < S.cfg.startDate ? G.start : dAdd(G.start, -14);
  let cur = Object.fromEntries(G.gauges.map(g => [g.id, 60]));
  let flowLeft = 0;
  const hist = [];
  for (let d = start; d <= t; d = dAdd(d, 1)) {
    const dd = day(d), prev = hist[hist.length - 1], active = [];
    // баффы, которые зависят от прошлых дней
    for (const b of G.buffs) {
      if (b.type === 'planStreak') {
        const ok = k => { const x = hist[hist.length - k]; return x && x.planPct >= b.pct && x.planTot >= 3; };
        if ([...Array(b.n)].every((_, i) => ok(i + 1))) flowLeft = Math.max(flowLeft, b.days || 1);
        if (flowLeft > 0) active.push(b);
      } else if (b.type === 'trackerStreak') {
        const tr = lifeCfg().trackers.find(x => x.id === b.tr);
        if (tr && [...Array(b.n)].every((_, i) => { const x = hist[hist.length - 1 - i]; return x && trackerOk(tr, x.t[b.tr]); })) active.push(b);
      } else if (b.type === 'gaugeLow') {
        if ([...Array(b.n)].every((_, i) => { const x = hist[hist.length - 1 - i]; return x && x.g[b.g] !== undefined && x.g[b.g] < b.below; })) active.push(b);
      } else if (b.type === 'sleepAfter') {
        const bed = tmin(dd.t.sleep && dd.t.sleep.bed), lim = tmin(b.time);
        if (bed !== null && lim !== null && bed >= lim && bed < 12 * 60) active.push(b);
      } else if (b.type === 'combo') {
        const trs = lifeCfg().trackers;
        if ((b.trs || []).length && b.trs.every(id => { const tr = trs.find(x => x.id === id); return tr && trackerOk(tr, dd.t[id]); })) active.push(b);
      } else if (b.type === 'trackerAbove') {
        if ((+dd.t[b.tr] || 0) > b.above) active.push(b);
      }
    }
    if (flowLeft > 0 && active.some(b => b.type === 'planStreak')) flowLeft--;
    // шкалы
    const g = {};
    for (const ga of G.gauges) {
      let gain = ga.rules.reduce((a, r) => a + ruleGain(r, dd), 0);
      const man = (dd.g || {})[ga.id] || 0, mr = ga.rules.find(r => r.t === 'manual'); if (man && mr) gain += man * mr.pts;
      g[ga.id] = clamp(cur[ga.id] - (d === t ? ga.drop * Math.min(1, nowMin() / 1440 + 0.25) : ga.drop) + gain);
    }
    const ef = G.energyFrom.filter(id => g[id] !== undefined);
    let en = ef.length ? ef.reduce((a, id) => a + g[id], 0) / ef.length : 60;
    const etr = dd.t.energy; if (etr) en = (en + etr * 20) / 2;
    en += active.reduce((a, b) => a + (b.energy || 0), 0);
    g.energy = clamp(en);
    const bl = blocksFor(d), tk = liveTasks().filter(x => x.date === d), tot = bl.length + tk.length, dn = bl.filter(b => dd.blocks && dd.blocks[b.id]).length + tk.filter(x => x.done).length;
    const rec = { d, g, t: dd.t, active, planTot: tot, planPct: tot ? dn / tot : 0 };
    hist.push(rec); out[d] = rec; cur = g; void prev;
  }
  SIM = out; setTimeout(() => { SIM = null; }, 0);
  return out;
}
function buffMult(date) { const r = simulate()[date]; if (!r) return 1; return r.active.reduce((m, b) => m * (b.mult || 1), 1); }

// ---------- Навыки и звания ----------
const RANKS = [[90, 'Легенда'], [70, 'Магистр'], [45, 'Мастер'], [25, 'Подмастерье'], [10, 'Ученица'], [1, 'Новичок']];
const rankOf = L => (RANKS.find(([n]) => L >= n) || [1, 'Новичок'])[1];
function skillLevel(xp) { let L = 1, x = xp; while (L < 100 && x >= 20 * L) { x -= 20 * L; L++; } return { L, into: Math.round(x), need: 20 * L }; }
function skillXP(sk) {
  const G = g2(), t = today(), words = (sk.words || []).map(w => w.toLowerCase()).filter(Boolean), ev = [];
  const trs = lifeCfg().trackers;
  for (let d = G.start; d <= t; d = dAdd(d, 1)) {
    const dd = day(d); let x = 0;
    for (const id of sk.trs || []) { const tr = trs.find(z => z.id === id); if (!tr) continue; const v = dd.t[id]; if (tr.kind === 'minutes') x += Math.round((+v || 0) / 6); else if (trackerOk(tr, v)) x += 10; }
    if (words.length) {
      for (const b of blocksFor(d)) if (dd.blocks && dd.blocks[b.id] && words.some(w => b.title.toLowerCase().includes(w))) { const f = tmin(b.from), e = tmin(b.to); x += Math.max(5, e !== null && f !== null ? Math.round((e - f) / 6) : 10); }
      for (const k of liveTasks()) if (k.done && (k.doneAt || k.date) === d && words.some(w => k.title.toLowerCase().includes(w))) x += 10;
    }
    if (x) ev.push({ d, x });
  }
  for (const l of g2data().skillLog) if (l.skill === sk.id && !l.deleted) ev.push({ d: l.date, x: Math.round((+l.min || 0) / 6) });
  const total = ev.reduce((a, e) => a + e.x, 0);
  return { total, ...skillLevel(total), week: ev.filter(e => e.d > dAdd(t, -7)).reduce((a, e) => a + e.x, 0) };
}
function titlesState() {
  const G = g2(), lv = Object.fromEntries(G.skills.map(s => [s.id, skillXP(s).L]));
  return G.titles.map(ti => ({ ...ti, open: (ti.req || []).length > 0 && ti.req.every(r => (lv[r.skill] || 0) >= (+r.level || 1)), lv }));
}

// ---------- Звёзды и фонд радости ----------
function starsBalance() { const earned = gameState().stars, spent = g2data().buys.filter(b => !b.deleted).reduce((a, b) => a + (+b.stars || 0), 0); return { earned, spent, bal: earned - spent }; }
function fundSpent(M) { return r2(g2data().buys.filter(b => !b.deleted && mkey(b.date) === M).reduce((a, b) => a + (+b.money || 0), 0)); }
async function addFundExpense(money, comment) {
  const F = g2().fund, now = Date.now();
  const op = { id: uid(), type: 'Расход', date: today(), account: F.account, cat: F.cat, sub: F.sub, amount: r2(money), person: '', to: '', comment, rate: 0, amountTo: 0, createdAt: now, updatedAt: now, device: DEVICE, deleted: false };
  if (validate(op)) throw new Error('настрой категорию и счёт фонда радости: ' + validate(op));
  S.ops.push(op); await DB.put(op); Sync.soon(); return op.id;
}

// ---------- Аватар ----------
function avatarHtml(level, big) {
  const G = gameCfg(), pr = primeScore(primeAt(mkey(today()))), tier = level >= 20 ? 'rainbow' : level >= 10 ? 'gold' : level >= 5 ? 'silver' : 'lilac';
  const inner = G.avatar ? `<img src="${G.avatar}" alt="">` : `<span>${esc((G.name || '★').trim()[0] || '★')}</span>`;
  return `<div class="ava ${tier} ${big ? 'big' : ''} ${pr.full ? 'prime' : ''}">${pr.full ? '<i class="crown">👑</i>' : ''}<div class="ava-in">${inner}</div><b class="ava-lvl">${level}</b></div>`;
}
function resizeImage(file, size) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; const s = Math.min(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => rej(new Error('не картинка')); img.src = url;
  });
}

// ---------- На «Сегодня»: шкалы, баффы, День уровня ----------
function todayGame(t) {
  const G = g2(), r = simulate()[t]; if (!r) return '';
  const col = v => v < 15 ? 'red' : v < 30 ? 'yel' : '';
  const gauges = [...G.gauges, { id: 'energy', name: 'Энергия', icon: '⚡' }];
  const manual = G.gauges.filter(g => g.rules.some(x => x.t === 'manual'));
  const low = gauges.filter(g => r.g[g.id] < 30);
  const lv = levelDayCard(t);
  return `${lv}<div class="card gcard"><b>Шкалы</b><div class="sub" style="margin-top:2px">${r.active.map(b => `<span class="buff ${b.debuff ? 'de' : ''}" title="${esc(b.text || '')}">${b.icon} ${esc(b.name)}</span>`).join(' ') || 'баффов нет'}</div>
    <div class="gauges">${gauges.map(g => `<div class="gauge ${col(r.g[g.id])}" data-tip="${esc(g.name + '|' + r.g[g.id] + ' из 100')}"><span>${g.icon}</span><div class="gbar"><i style="width:${r.g[g.id]}%"></i></div><b>${r.g[g.id]}</b></div>`).join('')}</div>
    ${manual.length ? `<div class="seg" style="margin-top:6px">${manual.map(g => { const rr = g.rules.find(x => x.t === 'manual'); return `<button class="chip" data-gplus="${g.id}">+ ${g.icon} ${esc(rr.label || g.name)}</button>`; }).join('')}</div>` : ''}
    ${low.length ? `<div class="sub" style="margin-top:4px">⚠ Проседает: ${low.map(g => g.icon + ' ' + esc(g.name)).join(', ')}</div>` : ''}
    ${r.active.length ? `<div class="sub">${r.active.map(b => esc(b.icon + ' ' + b.name + ': ' + (b.text || ''))).join(' · ')}</div>` : ''}</div>`;
}
function bindTodayGame(t) {
  document.querySelectorAll('[data-gplus]').forEach(b => b.onclick = () => setDay(t, d => { d.g = d.g || {}; d.g[b.dataset.gplus] = (d.g[b.dataset.gplus] || 0) + 1; }).then(() => { const y = scrollY; renderToday(); scrollTo(0, y); }));
  bindLevelDay(t);
}
// День нового уровня
function levelDayCard(t) {
  const G = g2(), L = g2data(), gs = gameState();
  const pending = []; for (let lv = 2; lv <= gs.level; lv++) if (!L.lvl[lv]) pending.push(lv);
  const todayDay = Object.entries(L.lvl).find(([, x]) => x && x.date === t && !x.skip);
  let html = '';
  if (pending.length) { const lv = pending[pending.length - 1];
    html += `<div class="card lvlcard"><b>🎉 Новый уровень ${lv}${lv % 5 === 0 ? ' — Большой день!' : ''}</b><div class="sub">Выбери ближайший свободный день — в этот день откроются конверты-сюрпризы.</div>
      <div class="grid2" style="margin-top:6px"><input class="in" type="date" id="lvlDate" value="${nextFree(t)}"><button class="btn small" id="lvlPlan" data-lv="${lv}" style="margin:0">Запланировать</button></div>
      <button class="ghost" id="lvlSkip" data-lv="${pending.join(',')}" style="font-size:12px">пропустить</button></div>`; }
  if (todayDay) { const [lv, x] = todayDay, nm = nowMin(), cards = x.cards.map(id => G.cards.find(c => c.id === id) || { id, name: 'Сюрприз', icon: '🎁' });
    html += `<div class="card lvlcard"><b>🎊 Сегодня День уровня ${lv}!</b><div class="sub">Конверты открываются по одному — что дальше, не знает никто.</div><div class="envs">${cards.map((c, i) => {
      const slot = 10 * 60 + i * 120, open = x.opened && x.opened[c.id], can = !open && (i === 0 || (x.opened && x.opened[x.cards[i - 1]])) && nm >= slot;
      return open ? `<div class="env open">${c.icon}<div><b>${esc(c.name)}</b>${c.money ? `<div class="sub">≈ ${money(c.money)} из фонда радости</div>` : ''}</div></div>`
        : `<button class="env ${can ? 'ready' : ''}" ${can ? `data-env="${lv}|${c.id}"` : 'disabled'}>✉️<div class="sub">${can ? 'Открыть' : i && !(x.opened && x.opened[x.cards[i - 1]]) ? 'после предыдущего' : 'с ' + String(Math.floor(slot / 60)).padStart(2, '0') + ':00'}</div></button>`; }).join('')}</div></div>`; }
  return html;
}
function nextFree(t) { for (let i = 1; i < 14; i++) { const d = dAdd(t, i); if (isoWd(d) >= 6) return d; } return dAdd(t, 1); }
function pickCards(lv) {
  const G = g2(), big = lv % 5 === 0, n = big ? 6 : 4, M = mkey(today());
  let budget = Math.max(0, (+G.fund.limit || 0) - fundSpent(M)) * (big ? 1 : 0.5);
  const pool = [...G.cards].sort(() => Math.random() - 0.5), out = [];
  for (const c of pool) { if (out.length >= n) break; if ((+c.money || 0) <= budget) { out.push(c.id); budget -= (+c.money || 0); } }
  return out;
}
function bindLevelDay(t) {
  const L = g2data(), rr = () => { const y = scrollY; renderToday(); scrollTo(0, y); };
  if ($('#lvlPlan')) $('#lvlPlan').onclick = async () => { const lv = $('#lvlPlan').dataset.lv, date = $('#lvlDate').value; if (!date || date < t) { toast('Выбери дату не раньше сегодня'); return; } const cards = pickCards(+lv); if (!cards.length) { toast('Нет карточек — добавь их в «Персонаж → Награды»'); return; } await putKey('lvl', lv, { date, cards, opened: {} });
    for (let k = 2; k < +lv; k++) if (!L.lvl[k]) L.lvl[k] = { skip: true, merged: +lv, updatedAt: Date.now(), device: DEVICE };   // несколько уровней сразу — один праздник
    await saveLife(); toast(`🎉 День уровня ${lv}: ${dRu2(date)}`); rr(); };
  if ($('#lvlSkip')) $('#lvlSkip').onclick = async () => { if (!confirm('Пропустить праздник за эти уровни?')) return; for (const lv of $('#lvlSkip').dataset.lv.split(',')) L.lvl[lv] = { skip: true, updatedAt: Date.now(), device: DEVICE }; await saveLife(); rr(); };
  document.querySelectorAll('[data-env]').forEach(b => b.onclick = async () => { const [lv, id] = b.dataset.env.split('|'), x = JSON.parse(JSON.stringify(L.lvl[lv])); x.opened = x.opened || {}; x.opened[id] = true; await putKey('lvl', lv, x); rr(); });
}

// ---------- Вкладки персонажа ----------
function charSkills() {
  const G = g2(), ts = titlesState(), trs = lifeCfg().trackers;
  const list = G.skills.map(s => ({ s, x: skillXP(s) })).sort((a, b) => b.x.total - a.x.total);
  return `<h2>🛠 Навыки</h2><div class="card">${list.map(({ s, x }) => `<details class="stat"><summary><div class="mrow"><span>${s.icon || '🔹'} <b>${esc(s.name)}</b> <span class="sub">· ${rankOf(x.L)}</span></span><b>${x.L}</b></div><div class="xpbar thin"><i style="width:${Math.round(x.into / x.need * 100)}%"></i></div><div class="sub">${x.into}/${x.need} до ${x.L + 1} ур.${x.week ? ` · за неделю +${x.week}` : ''}</div></summary>
      <div class="sub">Опыт идёт от: ${[...(s.trs || []).map(id => (trs.find(z => z.id === id) || { name: id }).name), ...(s.words || []).map(w => '«' + w + '» в плане и делах')].map(esc).join(', ') || 'только вручную'}</div>
      <div class="grid2" style="margin-top:6px"><input class="in" inputmode="numeric" placeholder="Минут вручную" data-slmin="${s.id}"><button class="btn small" data-sladd="${s.id}" style="margin:0">+ Добавить</button></div>
      <label class="f">Трекеры (через запятую: ${trs.filter(z => z.on).map(z => z.id).join(', ')})</label><input class="in" data-sktrs="${s.id}" value="${esc((s.trs || []).join(', '))}">
      <label class="f">Слова в блоках плана и делах</label><input class="in" data-skwords="${s.id}" value="${esc((s.words || []).join(', '))}">
      <button class="btn small danger" data-skdel="${s.id}">Удалить навык</button></details>`).join('') || '<div class="row muted">Навыков пока нет.</div>'}</div>
    <div class="card" style="padding:10px 12px"><b>+ Навык</b><div class="grid2"><input class="in" id="skName" placeholder="Например: Английский"><input class="in" id="skIcon" placeholder="Значок" maxlength="4"></div>
      <input class="in" id="skWords" placeholder="Слова в плане: английск, english" style="margin-top:6px"><button class="btn small" id="skAdd">Добавить</button></div>
    <div class="muted">Уровень навыка 1–100 (до следующего 20 × уровень опыта навыка). 10 опыта навыка ≈ час занятий. Ранги: Новичок 1 · Ученица 10 · Подмастерье 25 · Мастер 45 · Магистр 70 · Легенда 90.</div>
    <h2>🎖 Звания</h2><div class="card">${ts.map((ti, i) => `<div class="row"><span style="min-width:0">${ti.open ? '🔓' : '🔒'} <b>${esc(ti.name)}</b>${G.title === ti.name ? ' <span class="sub">· главное</span>' : ''}<div class="sub">${(ti.req || []).map(r => { const s = G.skills.find(z => z.id === r.skill); return `${s ? esc(s.name) : '?'} ${ti.lv[r.skill] || 0}/${r.level}`; }).join(' + ')}</div></span>
      <span style="white-space:nowrap">${ti.open && G.title !== ti.name ? `<button class="mini-btn" data-tmain="${i}">сделать главным</button>` : ''}<button class="mini-btn" data-tdel="${i}">✕</button></span></div>`).join('') || '<div class="row muted">Званий пока нет — это комбинации навыков.</div>'}
      <div class="row" style="display:block"><input class="in" id="tiName" placeholder="Название звания"><label class="f">Условия (по строке: навык = уровень)</label><textarea class="in" rows="2" id="tiReq" placeholder="${esc(G.skills.slice(0, 2).map(s => s.name + ' = 10').join('\n') || 'Английский = 10')}"></textarea><button class="btn small" id="tiAdd">Добавить звание</button></div></div>`;
}
function bindSkills() {
  const G = g2(), sv = () => saveCfg().then(rer), sk = id => G.skills.find(s => s.id === id), list = v => v.split(',').map(x => x.trim()).filter(Boolean);
  document.querySelectorAll('[data-sladd]').forEach(b => b.onclick = async () => { const id = b.dataset.sladd, m = Math.round(num(document.querySelector(`[data-slmin="${id}"]`).value)); if (!(m > 0)) return; await putRec('skillLog', { id: lid(), skill: id, date: today(), min: m }); toast(`+${Math.round(m / 6)} к навыку`); rer(); });
  document.querySelectorAll('[data-sktrs]').forEach(el => el.onchange = () => { sk(el.dataset.sktrs).trs = list(el.value); sv(); });
  document.querySelectorAll('[data-skwords]').forEach(el => el.onchange = () => { sk(el.dataset.skwords).words = list(el.value); sv(); });
  document.querySelectorAll('[data-skdel]').forEach(b => b.onclick = () => { const s = sk(b.dataset.skdel); if (confirm(`Удалить навык «${s.name}»?`)) { G.skills.splice(G.skills.indexOf(s), 1); sv(); } });
  $('#skAdd').onclick = () => { const n = $('#skName').value.trim(); if (!n) return; G.skills.push({ id: 'k' + lid(), name: n, icon: $('#skIcon').value.trim() || '🔹', trs: [], words: list($('#skWords').value) }); sv(); };
  document.querySelectorAll('[data-tmain]').forEach(b => b.onclick = () => { G.title = G.titles[+b.dataset.tmain].name; sv(); });
  document.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { if (confirm('Удалить звание?')) { G.titles.splice(+b.dataset.tdel, 1); sv(); } });
  $('#tiAdd').onclick = () => {
    const n = $('#tiName').value.trim(); if (!n) return;
    const req = $('#tiReq').value.split('\n').map(l => l.split('=')).filter(p => p.length === 2).map(([a, b]) => { const s = G.skills.find(z => z.name.toLowerCase() === a.trim().toLowerCase()); return s ? { skill: s.id, level: Math.max(1, Math.round(num(b))) } : null; });
    if (!req.length || req.includes(null)) { toast('Проверь условия: названия навыков должны совпадать'); return; }
    G.titles.push({ id: 't' + lid(), name: n, req }); sv();
  };
}
function charRewards() {
  const G = g2(), L = g2data(), sb = starsBalance(), M = mkey(today()), F = G.fund, fs = fundSpent(M);
  const cats = S.cfg.exp.map(c => c.cat), subs = ((S.cfg.exp.find(c => c.cat === F.cat) || {}).subs || []).map(s => s.name);
  return `<div class="cards"><div class="kpi lilac"><div class="l">⭐ Звёзды</div><div class="v">${sb.bal}</div><div class="s">заработано ${sb.earned} · потрачено ${sb.spent}</div></div>
      <div class="kpi green"><div class="l">🎁 Фонд радости</div><div class="v">${money(Math.max(0, (+F.limit || 0) - fs))}</div><div class="s">осталось в ${mlabel(M).split(' ')[0].toLowerCase()} из ${money(+F.limit || 0)}</div></div></div>
    <h2>Каталог наград</h2><div class="card">${G.rewards.map((r, i) => `<div class="row"><span style="min-width:0">${r.icon || '🎁'} <b>${esc(r.name)}</b><div class="sub">⭐ ${r.stars}${r.money ? ` · ${money(r.money)} из фонда` : ' · бесплатно'}</div></span>
      <span style="white-space:nowrap"><button class="btn small ${sb.bal >= r.stars ? '' : 'light'}" data-rbuy="${i}" style="margin:0">Взять</button><button class="mini-btn" data-rdel="${i}">✕</button></span></div>`).join('') || '<div class="row muted">Каталог пуст</div>'}
      <div class="row" style="display:block"><div class="grid2"><input class="in" id="rwName" placeholder="Награда"><input class="in" id="rwIcon" placeholder="Значок" maxlength="4"></div>
      <div class="grid2" style="margin-top:6px"><input class="in" id="rwStars" inputmode="numeric" placeholder="Цена в ⭐"><input class="in" id="rwMoney" inputmode="decimal" placeholder="₸ из фонда (0 — бесплатно)"></div><button class="btn small" id="rwAdd">Добавить награду</button></div></div>
    ${L.buys.filter(b => !b.deleted).length ? `<h2>Мои награды</h2><div class="card">${L.buys.filter(b => !b.deleted).slice(-10).reverse().map(b => `<div class="row"><span class="sub">${dRu2(b.date).slice(0, 5)} · ${esc(b.name)}</span><span class="sub">−${b.stars} ⭐${b.money ? ' · ' + money(b.money) : ''}</span></div>`).join('')}</div>` : ''}
    <details class="card" style="padding:4px 12px"><summary style="font-weight:600">⚙ Фонд радости</summary><div class="muted">Платные награды и карточки Дня уровня берутся только из фонда, в пределах лимита на месяц. Покупка сама записывает трату в финансы.</div>
      <label class="f">Лимит в месяц, ${esc(CUR[baseCur()].sym)}</label><input class="in" id="fdLim" inputmode="decimal" value="${+F.limit || 0}">
      <div class="grid2"><div><label class="f">Категория</label><select class="in" id="fdCat"><option value="">—</option>${cats.map(c => `<option ${c === F.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div><div><label class="f">Подкатегория</label><select class="in" id="fdSub"><option value="">—</option>${subs.map(s => `<option ${s === F.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div></div>
      <label class="f">Счёт</label><select class="in" id="fdAcc"><option value="">—</option>${openAccs().map(a => `<option ${a.name === F.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><div style="height:8px"></div></details>
    <h2>🎊 Карточки Дня уровня</h2><div class="card">${G.cards.map((c, i) => `<div class="row"><span>${c.icon || '🎁'} ${esc(c.name)}${c.money ? ` <span class="sub">· ${money(c.money)}</span>` : ''}</span><button class="mini-btn" data-cdel="${i}">✕</button></div>`).join('')}
      <div class="row" style="display:block"><div class="grid2"><input class="in" id="cdName" placeholder="Занятие"><input class="in" id="cdMoney" inputmode="decimal" placeholder="₸ (0 — бесплатно)"></div><button class="btn small" id="cdAdd">Добавить карточку</button></div></div>
    <p class="muted">День уровня: 4 случайные карточки (каждый 5-й уровень — 6), платные — в пределах фонда. Конверты открываются по одному с 10:00, каждые 2 часа.</p>`;
}
function bindRewards() {
  const G = g2(), sv = () => saveCfg().then(rer), F = G.fund;
  document.querySelectorAll('[data-rbuy]').forEach(b => b.onclick = async () => {
    const r = G.rewards[+b.dataset.rbuy], sb = starsBalance(), M = mkey(today());
    if (sb.bal < r.stars) { toast(`Не хватает ⭐: нужно ${r.stars}, есть ${sb.bal}`); return; }
    if (r.money && fundSpent(M) + r.money > (+F.limit || 0)) { toast(`Фонд радости в этом месяце: осталось ${money(Math.max(0, (+F.limit || 0) - fundSpent(M)))}`); return; }
    if (!confirm(`Взять «${r.name}» за ${r.stars} ⭐${r.money ? ` и записать трату ${money(r.money)} (${F.cat} → ${F.sub}, ${F.account})` : ''}?`)) return;
    try { const opId = r.money ? await addFundExpense(r.money, 'награда: ' + r.name) : ''; await putRec('buys', { id: lid(), rid: r.id, name: r.name, date: today(), stars: r.stars, money: r.money || 0, opId }); toast(`🎁 ${r.name} — наслаждайся!`); rer(); }
    catch (e) { toast('⚠ ' + e.message); }
  });
  document.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => { if (confirm('Убрать награду из каталога?')) { G.rewards.splice(+b.dataset.rdel, 1); sv(); } });
  $('#rwAdd').onclick = () => { const n = $('#rwName').value.trim(); if (!n) return; G.rewards.push({ id: 'r' + lid(), name: n, icon: $('#rwIcon').value.trim() || '🎁', stars: Math.max(1, Math.round(num($('#rwStars').value)) || 20), money: num($('#rwMoney').value) }); sv(); };
  $('#fdLim').onchange = e => { F.limit = Math.max(0, num(e.target.value)); sv(); };
  $('#fdCat').onchange = e => { F.cat = e.target.value; F.sub = ''; sv(); };
  $('#fdSub').onchange = e => { F.sub = e.target.value; sv(); };
  $('#fdAcc').onchange = e => { F.account = e.target.value; sv(); };
  document.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => { if (confirm('Удалить карточку?')) { G.cards.splice(+b.dataset.cdel, 1); sv(); } });
  $('#cdAdd').onclick = () => { const n = $('#cdName').value.trim(); if (!n) return; const m = n.match(/^(\p{Extended_Pictographic})\s*(.+)$/u); G.cards.push({ id: 'k' + lid(), name: m ? m[2] : n, icon: m ? m[1] : '🎁', money: num($('#cdMoney').value) }); sv(); };
}
function charGauges() {
  const G = g2(), t = today(), sim = simulate(), days = Object.keys(sim).filter(d => d >= dAdd(t, -13)).sort();
  const all = [...G.gauges, { id: 'energy', name: 'Энергия', icon: '⚡' }];
  const RL = { per: 'за единицу', ok: 'если выполнен', opt: 'за отметку', sleepH: 'сон в норме', manual: 'кнопка «+»' };
  return `<h2>📈 Шкалы за 14 дней</h2><div class="card vcard">${lineChart(days.map(d => String(+d.slice(8))), all.slice(0, 3).concat(all.filter(g => g.id === 'energy')).map((g, i) => ({ name: g.icon + ' ' + g.name, color: `var(--c${i + 1})`, vals: days.map(d => sim[d].g[g.id]) })), { tipTitle: days.map(dRu2), aria: 'Шкалы по дням' }).replace(/ ₸/g, '')}</div>
    <h2>Шкалы</h2><div class="card">${G.gauges.map((g, i) => `<div class="row" style="display:block"><div class="mrow"><b>${g.icon} ${esc(g.name)}</b><span class="sub">падает на <input class="mini" style="width:52px" data-gdrop="${i}" value="${g.drop}"> в день</span></div>
      ${g.rules.map((r, k) => `<div class="mrow"><span class="sub">+ ${r.tr ? esc((lifeCfg().trackers.find(z => z.id === r.tr) || { name: r.tr }).name) + ' · ' : ''}${RL[r.t] || r.t}${r.label ? ' «' + esc(r.label) + '»' : ''}${r.t === 'sleepH' ? ` ${r.min}–${r.max} ч` : ''}</span><input class="mini" style="width:52px" data-grule="${i}|${k}" value="${r.pts}"></div>`).join('')}</div>`).join('')}</div>
    <div class="card" style="padding:10px 12px"><b>+ Своя шкала</b> <span class="sub">(пополняется кнопкой «+» на «Сегодня»)</span><div class="grid2"><input class="in" id="ngName" placeholder="Название"><input class="in" id="ngIcon" placeholder="Значок" maxlength="4"></div><div class="grid2" style="margin-top:6px"><input class="in" id="ngDrop" inputmode="numeric" placeholder="Падает в день, напр. 15"><input class="in" id="ngPts" inputmode="numeric" placeholder="+ за нажатие, напр. 15"></div><button class="btn small" id="ngAdd">Добавить</button></div>
    <h2>Баффы и дебаффы</h2><div class="card">${G.buffs.map((b, i) => `<div class="row"><span style="min-width:0">${b.icon} <b>${esc(b.name)}</b>${b.debuff ? ' <span class="sub neg">дебафф</span>' : ''}<div class="sub">${esc(b.text || '')}</div></span><button class="mini-btn" data-bfdel="${i}">✕</button></div>`).join('') || '<div class="row muted">Нет</div>'}</div>
    <p class="muted">Энергия считается из шкал ${G.energyFrom.map(id => (G.gauges.find(g => g.id === id) || { name: id }).name).join(', ')} и трекера «Энергия», плюс влияние баффов. Ниже 30 — жёлтая зона, ниже 15 — красная.</p>`;
}
function bindGauges() {
  const G = g2(), sv = () => saveCfg().then(rer);
  document.querySelectorAll('[data-gdrop]').forEach(el => el.onchange = () => { G.gauges[+el.dataset.gdrop].drop = Math.max(0, Math.round(num(el.value))); sv(); });
  document.querySelectorAll('[data-grule]').forEach(el => el.onchange = () => { const [i, k] = el.dataset.grule.split('|'); G.gauges[+i].rules[+k].pts = Math.max(0, Math.round(num(el.value))); sv(); });
  $('#ngAdd').onclick = () => { const n = $('#ngName').value.trim(); if (!n) return; G.gauges.push({ id: 'g' + lid(), name: n, icon: $('#ngIcon').value.trim() || '◆', drop: Math.round(num($('#ngDrop').value)) || 15, rules: [{ t: 'manual', pts: Math.round(num($('#ngPts').value)) || 15, label: n.toLowerCase() }] }); sv(); };
  document.querySelectorAll('[data-bfdel]').forEach(b => b.onclick = () => { if (confirm('Удалить бафф?')) { G.buffs.splice(+b.dataset.bfdel, 1); sv(); } });
}
// Аватар — блок в «Карточке»
function avatarSettings() {
  return `<details class="card" style="padding:4px 12px"><summary style="font-weight:600">🖼 Аватар</summary><div class="muted">Любая картинка или фото. Уменьшается до 256 px и хранится только у тебя (и в твоём Google Диске при синхронизации). Рамка растёт с уровнем: сиреневая → серебряная (5) → золотая (10) → радужная (20); полный Прайм — корона 👑.</div>
    <label class="btn small light" style="cursor:pointer">Выбрать картинку<input type="file" id="avFile" accept="image/*" hidden></label>${gameCfg().avatar ? '<button class="btn small light" id="avDel">Убрать</button>' : ''}<div style="height:8px"></div></details>`;
}
function bindAvatar() {
  const G = gameCfg();
  if ($('#avFile')) $('#avFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { G.avatar = await resizeImage(f, 256); await saveCfg(); toast('Аватар обновлён ✓'); rer(); } catch (err) { toast('Не удалось: ' + err.message); } };
  if ($('#avDel')) $('#avDel').onclick = async () => { delete G.avatar; await saveCfg(); rer(); };
}
