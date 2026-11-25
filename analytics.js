'use strict';
/* Жизнь — Финансы: аналитика и графики.
   Подключается после app.js и пользуется его функциями (S, live, validate, opBase, balances, totals, budget, pocketState, goals…).
   Графики — свой SVG без библиотек (работают без интернета). Цвета — проверенная палитра (--c1…--c8), текст — цвета текста.
   Подсказки: наведение или нажатие на столбик / сектор / точку показывает точные суммы. */

const MS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dRu2 = d => d ? d.split('-').reverse().join('.') : '';
const mEnd = M => dIso(new Date(+M.slice(0, 4), +M.slice(5, 7), 0));
const mStart = M => M + '-01';
const mShort = (M, withYear) => MS[+M.slice(5, 7) - 1] + (withYear ? ' ' + M.slice(2, 4) : '');
function monthsBetween(from, to) { const out = []; let M = mkey(from); const last = mkey(to); while (M <= last && out.length < 240) { out.push(M); M = mshift(M, 1); } return out; }
// Короткие суммы для осей: 12 тыс, 1,2 млн
function kfmt(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + (+(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)).toLocaleString('ru-RU') + ' млн';
  if (a >= 1e3) return s + Math.round(a / 1e3).toLocaleString('ru-RU') + ' тыс';
  return s + Math.round(a).toLocaleString('ru-RU');
}
// Изменение в ₸ и % (для расходов рост — плохо, для доходов — хорошо)
function deltaHtml(cur, prev, goodUp) {
  if (!prev && !cur) return '<span class="sub">–</span>';
  const d = r2(cur - prev), p = prev ? d / Math.abs(prev) : null;
  if (!d) return '<span class="sub">без изменений</span>';
  const good = goodUp ? d > 0 : d < 0;
  return `<span class="${good ? 'pos' : 'neg'}">${d > 0 ? '▲ +' : '▼ −'}${money(Math.abs(d))}${p !== null ? ' (' + (d > 0 ? '+' : '−') + Math.abs(Math.round(p * 100)) + '%)' : ''}</span>`;
}

// ---------- Период и фильтры ----------
function anState() {
  if (!S.an) S.an = { p: '6m', from: '', to: '', cat: '', acc: '', cmp: 'prev', y: '', open: {} };
  return S.an;
}
const PRESETS = [['m', 'Месяц'], ['3m', '3 мес'], ['6m', '6 мес'], ['y', 'Год'], ['all', 'Всё время'], ['custom', 'Свои даты']];
function anRange() {
  const a = anState(), t = today(), cur = mkey(t);
  let from, to;
  if (a.p === 'm') { const M = S.month || cur; from = mStart(M); to = mEnd(M); }
  else if (a.p === '3m' || a.p === '6m') { const n = a.p === '3m' ? 3 : 6; from = mStart(mshift(cur, -(n - 1))); to = mEnd(cur); }
  else if (a.p === 'y') { const y = a.y || t.slice(0, 4); from = y + '-01-01'; to = y + '-12-31'; }
  else if (a.p === 'all') { from = S.cfg.startDate; to = mEnd(cur); }
  else { from = a.from || mStart(cur); to = a.to || t; if (to < from) [from, to] = [to, from]; }
  return { from, to };
}
// Период для сравнения: такой же длины перед выбранным или тот же период год назад
function anCmpRange(r) {
  const a = anState();
  const yShift = (d, k) => (+d.slice(0, 4) + k) + d.slice(4);
  if (a.cmp === 'year') return { from: yShift(r.from, -1), to: yShift(r.to, -1) };
  const wholeMonths = r.from.endsWith('-01') && r.to === mEnd(mkey(r.to));
  if (wholeMonths) { const n = monthsBetween(r.from, r.to).length; return { from: mStart(mshift(mkey(r.from), -n)), to: mEnd(mshift(mkey(r.from), -1)) }; }
  const len = dDiff(r.to, r.from) + 1; return { from: dAdd(r.from, -len), to: dAdd(r.from, -1) };
}
const accOK = o => { const a = anState().acc; return !a || o.account === a || o.to === a; };
const catOK = o => { const c = anState().cat; return !c || o.type !== 'Расход' || o.cat === c; };
function opsIn(from, to) { return live().filter(o => !isPocketOp(o) && o.date >= from && o.date <= to && !validate(o) && accOK(o) && catOK(o)); }
function sumsIn(from, to) {
  const s = { inc: 0, help: 0, exp: 0, loanIn: 0, back: 0, loanOut: 0, repay: 0 };
  for (const o of opsIn(from, to)) {
    const v = opBase(o);
    if (o.type === 'Доход') s.inc += v; else if (o.type === 'Помощь') s.help += v; else if (o.type === 'Расход') s.exp += v;
    else if (o.type === 'Заём получен') s.loanIn += v; else if (o.type === 'Мне вернули долг') s.back += v;
    else if (o.type === 'Заём выдан') s.loanOut += v; else if (o.type === 'Я вернула долг') s.repay += v;
  }
  for (const k in s) s[k] = r2(s[k]);
  s.saldo = r2(s.inc + s.help - s.exp); s.rate = s.inc + s.help ? s.saldo / (s.inc + s.help) : null;
  return s;
}
function byMonth(from, to) {
  return monthsBetween(from, to).map(M => {
    const f = M + '-01' < from ? from : M + '-01', t = mEnd(M) > to ? to : mEnd(M);
    return { M, ...sumsIn(f, t) };
  });
}
// Цвет категории — по сумме за всё время (стабилен при смене фильтров): 7 крупнейших получают свой цвет, остальные — «Другое»
function catColors() {
  const tot = {};
  for (const o of live()) if (o.type === 'Расход' && !validate(o)) tot[o.cat] = (tot[o.cat] || 0) + opBase(o);
  const order = S.cfg.exp.map(c => c.cat).sort((a, b) => (tot[b] || 0) - (tot[a] || 0));
  const m = {}; order.forEach((c, i) => { m[c] = i < 7 ? `var(--c${i + 1})` : 'var(--cOther)'; });
  return m;
}

// ---------- Подсказка (одна на всё приложение) ----------
function vizTipInit() {
  if (window.__vizTip) return; window.__vizTip = true;
  const tip = document.createElement('div'); tip.id = 'vizTip'; tip.className = 'viztip'; document.body.appendChild(tip);
  let pinned = null;
  const show = (el, x, y) => {
    tip.innerHTML = el.dataset.tip.split('|').map((l, i) => i === 0 ? `<b>${l}</b>` : `<div>${l}</div>`).join('');
    tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
    tip.style.top = (y - h - 14 < 8 ? y + 18 : y - h - 14) + 'px';
    document.querySelectorAll('.viz .hl').forEach(e => e.classList.remove('hl')); el.classList.add('hl');
  };
  const hide = () => { tip.classList.remove('on'); pinned = null; document.querySelectorAll('.viz .hl').forEach(e => e.classList.remove('hl')); };
  document.addEventListener('pointermove', e => { if (pinned || e.pointerType !== 'mouse') return; const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
  document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { pinned = el; show(el, e.clientX, e.clientY); } else hide(); });
  addEventListener('scroll', hide, { passive: true });
}
const tipAttr = lines => ` data-tip="${esc(lines.join('|'))}"`;
const legend = items => `<div class="vlegend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('')}</div>`;

// ---------- Графики (SVG) ----------
const W = 340;
// Столбики по месяцам (несколько рядов рядом) + необязательная линия. Одна ось — все ряды в тенге.
function barChart(labels, series, line, opt = {}) {
  const H = opt.h || 190, L = 44, R = 6, T = 10, B = 24, pw = W - L - R, ph = H - T - B, n = labels.length;
  if (!n) return '<div class="muted">Нет данных за период</div>';
  const all = [...series.flatMap(s => s.vals), ...(line ? line.vals : []), 0];
  let max = Math.max(...all), min = Math.min(...all); if (max === min) max = min + 1;
  const pad = (max - min) * 0.08; max += max > 0 ? pad : 0; min -= min < 0 ? pad : 0;
  const y = v => T + ph - (v - min) / (max - min) * ph, gw = pw / n, bw = Math.max(3, Math.min(18, (gw - 6) / series.length - 2));
  const ticks = [min < 0 ? min : 0, (max + Math.max(0, min)) / 2, max].map(v => Math.round(v));
  let g = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="vgrid"/><text x="${L - 4}" y="${y(v) + 3}" class="vax" text-anchor="end">${kfmt(v)}</text>`).join('');
  g += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="vbase"/>`;
  const every = Math.ceil(n / 8);
  labels.forEach((lb, i) => {
    const x0 = L + i * gw, cx = x0 + gw / 2, start = cx - (series.length * (bw + 2) - 2) / 2;
    series.forEach((s, k) => {
      const v = s.vals[i] || 0; if (!v) return;
      const yv = y(v), y0 = y(0), top = Math.min(yv, y0), h = Math.max(1, Math.abs(yv - y0)), x = start + k * (bw + 2), r = Math.min(4, bw / 2, h);
      // скругление только у конца столбика (не у оси)
      g += v >= 0 ? `<path d="M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y0}Z" fill="${s.color}" class="vmark"/>`
        : `<path d="M${x},${y0}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + bw - r}Q${x + bw},${top + h} ${x + bw},${top + h - r}V${y0}Z" fill="${s.color}" class="vmark"/>`;
    });
    if (i % every === 0 || i === n - 1) g += `<text x="${cx}" y="${H - 7}" class="vax" text-anchor="middle">${esc(lb)}</text>`;
  });
  if (line) {
    const pts = line.vals.map((v, i) => [L + i * gw + gw / 2, y(v)]);
    if (pts.length > 1) g += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${line.color}" stroke-width="2" stroke-linejoin="round"/>`;
    g += pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${line.color}" stroke="var(--card)" stroke-width="2"/>`).join('');
  }
  // зоны нажатия — весь столбец месяца (больше самих столбиков)
  labels.forEach((lb, i) => {
    const lines = [opt.tipTitle ? opt.tipTitle[i] : lb, ...series.map(s => `${s.name}: ${money(s.vals[i] || 0)}`), ...(line ? [`${line.name}: ${money(line.vals[i] || 0)}`] : [])];
    g += `<rect x="${L + i * gw}" y="${T}" width="${gw}" height="${ph}" class="vhit"${tipAttr(lines)}/>`;
  });
  const leg = series.length + (line ? 1 : 0) > 1 ? legend([...series, ...(line ? [line] : [])]) : '';
  return `<div class="viz">${leg}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || 'График')}">${g}</svg></div>`;
}
// Линии (одна ось). Точки — на каждом месяце, подсказка по колонке.
function lineChart(labels, series, opt = {}) {
  const H = opt.h || 180, L = 44, R = 8, T = 10, B = 24, pw = W - L - R, ph = H - T - B, n = labels.length;
  if (!n) return '<div class="muted">Нет данных за период</div>';
  const all = series.flatMap(s => s.vals.filter(v => v !== null));
  let max = Math.max(...all, 0), min = Math.min(...all, 0); if (max === min) max = min + 1;
  const y = v => T + ph - (v - min) / (max - min) * ph, x = i => n === 1 ? L + pw / 2 : L + i * pw / (n - 1);
  let g = [min, (min + max) / 2, max].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="vgrid"/><text x="${L - 4}" y="${y(v) + 3}" class="vax" text-anchor="end">${kfmt(v)}</text>`).join('');
  const every = Math.ceil(n / 8);
  labels.forEach((lb, i) => { if (i % every === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 7}" class="vax" text-anchor="middle">${esc(lb)}</text>`; });
  for (const s of series) {
    const segs = []; let cur = [];
    s.vals.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); }); if (cur.length) segs.push(cur);
    g += segs.map(p => p.length > 1 ? `<polyline points="${p.map(q => q.join(',')).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '').join('');
    g += s.vals.map((v, i) => v === null ? '' : `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="var(--card)" stroke-width="2"/>`).join('');
  }
  const cw = n === 1 ? pw : pw / (n - 1);
  labels.forEach((lb, i) => {
    const lines = [opt.tipTitle ? opt.tipTitle[i] : lb, ...series.filter(s => s.vals[i] !== null).map(s => `${s.name}: ${money(s.vals[i])}`)];
    g += `<rect x="${Math.max(L, x(i) - cw / 2)}" y="${T}" width="${Math.min(cw, W - R - Math.max(L, x(i) - cw / 2))}" height="${ph}" class="vhit"${tipAttr(lines)}/>`;
  });
  return `<div class="viz">${series.length > 1 ? legend(series) : ''}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || 'График')}">${g}</svg></div>`;
}
// Кольцо: доли целого. Между секторами — зазор цвета фона карточки. В центре — итог.
function donut(items, center, sub) {
  const tot = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (!tot) return '<div class="muted">Нет данных за период</div>';
  const cx = 80, cy = 80, R = 74, r = 48; let a0 = -Math.PI / 2, g = '';
  const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  for (const it of items) {
    if (!(it.value > 0)) continue;
    const frac = it.value / tot, a1 = a0 + frac * Math.PI * 2, big = frac > 0.5 ? 1 : 0;
    const tip = tipAttr([it.label, `${money(it.value)} · ${Math.round(frac * 100)}%`]);
    if (frac > 0.9999) g += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${it.color}" stroke-width="${R - r}" class="vmark"${tip}/>`;
    else { const [x1, y1] = pt(R, a0), [x2, y2] = pt(R, a1), [x3, y3] = pt(r, a1), [x4, y4] = pt(r, a0);
      g += `<path d="M${x1},${y1}A${R},${R} 0 ${big} 1 ${x2},${y2}L${x3},${y3}A${r},${r} 0 ${big} 0 ${x4},${y4}Z" fill="${it.color}" stroke="var(--card)" stroke-width="2" class="vmark"${tip}/>`; }
    a0 = a1;
  }
  g += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="vcenter">${esc(kfmt(tot))}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" class="vax">${esc(center || '')}</text>`;
  const list = items.filter(i => i.value > 0).map(i => `<div class="vli"><span><i style="background:${i.color}"></i>${esc(i.label)}</span><b>${money(i.value)}</b><span class="sub">${Math.round(i.value / tot * 100)}%</span></div>`).join('');
  return `<div class="viz vdonut"><svg viewBox="0 0 160 160" role="img" aria-label="Кольцевая диаграмма">${g}</svg><div class="vlist">${list}${sub || ''}</div></div>`;
}
// Горизонтальные полоски (HTML): одна величина, без легенды
function hbars(rows, color) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return rows.length ? rows.map(r => `<div class="hb"${tipAttr([r.label, money(r.value), ...(r.extra || [])])}><div class="hbt"><span>${esc(r.label)}</span><b>${money(r.value)}</b></div><div class="hbbar"><i style="width:${Math.max(1, r.value / max * 100)}%;background:${r.color || color}"></i></div>${r.note ? `<div class="sub">${r.note}</div>` : ''}</div>`).join('') : '<div class="muted">Нет данных за период</div>';
}

// ---------- Мини-дашборд на «Обзоре» ----------
function overviewCharts(M) {
  vizTipInit();
  const b = budget(M), cc = catColors();
  const cats = b.cats.filter(c => c.fact > 0).sort((a, z) => z.fact - a.fact);
  const top = cats.filter(c => cc[c.cat] !== 'var(--cOther)'), rest = cats.filter(c => cc[c.cat] === 'var(--cOther)');
  const items = [...top.map(c => ({ label: c.cat, value: c.fact, color: cc[c.cat] })), ...(rest.length ? [{ label: 'Другое', value: rest.reduce((s, c) => s + c.fact, 0), color: 'var(--cOther)' }] : [])];
  const cur = M, from = mStart(mshift(cur, -5)), bm = byMonth(from < S.cfg.startDate ? mStart(mkey(S.cfg.startDate)) : from, mEnd(cur));
  const ps = pocketState(M), pk = ps.list.filter(p => !p.linkSavings && p.bal > 0);
  return `<h2>Куда ушли деньги · ${mlabel(M)}</h2><div class="card vcard">${donut(items, 'расходы')}</div>
  <h2>Доходы и расходы</h2><div class="card vcard">${barChart(bm.map(x => mShort(x.M, bm.length > 1 && bm[0].M.slice(0, 4) !== bm[bm.length - 1].M.slice(0, 4))),
    [{ name: 'Пришло', color: 'var(--c1)', vals: bm.map(x => x.inc + x.help) }, { name: 'Потрачено', color: 'var(--c2)', vals: bm.map(x => x.exp) }], null, { tipTitle: bm.map(x => mlabel(x.M)), aria: 'Доходы и расходы по месяцам' })}</div>
  ${pk.length ? `<h2>Деньги по карманам</h2><div class="card vcard">${donut(pk.map((p, i) => ({ label: p.label || p.name, value: p.bal, color: i < 7 ? `var(--c${i + 1})` : 'var(--cOther)' })), 'в карманах', ps.free > 0 ? `<div class="vli"><span><i style="background:var(--line)"></i>Свободно (не в кольце)</span><b>${money(ps.free)}</b><span></span></div>` : '')}</div>` : ''}
  <button class="btn" id="goAnalytics">📊 Подробная аналитика ›</button>`;
}
function bindOverviewCharts() { const b = $('#goAnalytics'); if (b) b.onclick = () => setTab('analytics'); }

// ---------- Экран «Подробная аналитика» ----------
function renderAnalytics() {
  vizTipInit();
  const a = anState(), r = anRange(), cr = anCmpRange(r), s = sumsIn(r.from, r.to), ps = sumsIn(cr.from, cr.to);
  const cc = catColors(), cur = mkey(today());
  const years = [...new Set([S.cfg.startDate.slice(0, 4), today().slice(0, 4), ...live().map(o => o.date.slice(0, 4))])].filter(Boolean).sort();
  const filt = `<div class="card" style="padding:10px 12px">
    <div class="seg">${PRESETS.map(([k, l]) => `<button class="chip ${a.p === k ? 'on' : ''}" data-anp="${k}">${l}</button>`).join('')}</div>
    ${a.p === 'm' ? `<div class="muted" style="margin-top:6px">Месяц выбирается стрелками вверху: <b>${mlabel(S.month)}</b></div>` : ''}
    ${a.p === 'y' ? `<label class="f">Год</label><select class="in" id="anY">${years.map(y => `<option ${y === (a.y || today().slice(0, 4)) ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}
    ${a.p === 'custom' ? `<div class="grid2"><div><label class="f">С</label><input class="in" type="date" id="anFrom" value="${r.from}"></div><div><label class="f">По</label><input class="in" type="date" id="anTo" value="${r.to}"></div></div>` : ''}
    <div class="grid2"><div><label class="f">Категория расходов</label><select class="in" id="anCat"><option value="">Все</option>${S.cfg.exp.map(c => `<option ${c.cat === a.cat ? 'selected' : ''}>${esc(c.cat)}</option>`).join('')}</select></div>
    <div><label class="f">Счёт</label><select class="in" id="anAcc"><option value="">Все</option>${S.cfg.accounts.map(x => `<option ${x.name === a.acc ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
    <label class="f">Сравнивать с</label><div class="seg">${[['prev', 'прошлым периодом'], ['year', 'тем же периодом год назад']].map(([k, l]) => `<button class="chip ${a.cmp === k ? 'on' : ''}" data-ancmp="${k}">${l}</button>`).join('')}</div>
    <div class="muted" style="margin-top:6px">Период: ${dRu2(r.from)} — ${dRu2(r.to)} · сравнение: ${dRu2(cr.from)} — ${dRu2(cr.to)}</div></div>`;

  // 1) Итоги периода
  const kpi = (l, v, pv, goodUp, cls) => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v ${v < 0 ? 'neg' : ''}">${money(v)}</div><div class="s">${deltaHtml(v, pv, goodUp)}</div></div>`;
  const sumBlock = `<h2>Итоги периода</h2><div class="cards">
    ${kpi('Доходы (свои)', s.inc, ps.inc, true, 'green')}${kpi('Помощь', s.help, ps.help, true, 'blue')}
    ${kpi('Расходы', s.exp, ps.exp, false, 'powder')}${kpi('Сальдо (пришло − потрачено)', s.saldo, ps.saldo, true, 'lilac')}</div>
    <div class="card"><div class="row"><span>Отложено от поступлений</span><b>${pct(s.rate)}</b></div>
    <div class="row"><span class="sub">в периоде для сравнения</span><span class="sub">${pct(ps.rate)}</span></div>
    ${s.loanIn || s.back || s.loanOut || s.repay ? `<div class="row"><span class="sub">Займы и возвраты (не доход и не расход)</span><span class="sub">получила ${money(s.loanIn + s.back)} · отдала ${money(s.loanOut + s.repay)}</span></div>` : ''}</div>`;

  // 2) Динамика: по месяцам (или по дням, если период ≤ 1 месяца)
  const ms = monthsBetween(r.from, r.to);
  let dyn;
  if (ms.length <= 1) {
    const days = []; for (let d = r.from; d <= r.to && days.length < 62; d = dAdd(d, 1)) days.push(d);
    const ex = days.map(d => r2(opsIn(d, d).filter(o => o.type === 'Расход').reduce((x, o) => x + opBase(o), 0)));
    let acc = 0; const cum = ex.map(v => (acc = r2(acc + v)));
    dyn = `<h2>Расходы по дням</h2><div class="card vcard">${barChart(days.map(d => String(+d.slice(8))), [{ name: 'Расходы за день', color: 'var(--c2)', vals: ex }], null, { tipTitle: days.map(dRu2), aria: 'Расходы по дням' })}
      <div class="muted">Нарастающим итогом к концу периода: ${money(cum[cum.length - 1] || 0)}</div></div>`;
  } else {
    const bm = byMonth(r.from, r.to), multiY = bm[0].M.slice(0, 4) !== bm[bm.length - 1].M.slice(0, 4);
    dyn = `<h2>Динамика по месяцам</h2><div class="card vcard">${barChart(bm.map(x => mShort(x.M, multiY)), [{ name: 'Пришло', color: 'var(--c1)', vals: bm.map(x => r2(x.inc + x.help)) }, { name: 'Потрачено', color: 'var(--c2)', vals: bm.map(x => x.exp) }], { name: 'Сальдо', color: 'var(--c7)', vals: bm.map(x => x.saldo) }, { tipTitle: bm.map(x => mlabel(x.M)), aria: 'Доходы, расходы и сальдо по месяцам' })}
      <table class="t"><tr><th>Месяц</th><th>Пришло</th><th>Потрачено</th><th>Сальдо</th></tr>${bm.map(x => `<tr><td>${mShort(x.M, true)}</td><td>${money(x.inc + x.help)}</td><td>${money(x.exp)}</td><td class="${x.saldo < 0 ? 'neg' : ''}">${money(x.saldo)}</td></tr>`).join('')}</table></div>`;
  }

  // 3) Куда уходят деньги: кольцо + категории с подкатегориями
  const catSum = (from, to) => { const m = {}; for (const o of opsIn(from, to)) if (o.type === 'Расход') { const k = o.cat; m[k] = m[k] || { v: 0, subs: {} }; const v = opBase(o); m[k].v += v; m[k].subs[o.sub] = (m[k].subs[o.sub] || 0) + v; } return m; };
  const cs = catSum(r.from, r.to), cps = catSum(cr.from, cr.to);
  const cats = Object.entries(cs).map(([c, x]) => ({ c, v: r2(x.v), subs: x.subs })).sort((p, q) => q.v - p.v);
  const top = cats.filter(x => cc[x.c] !== 'var(--cOther)'), rest = cats.filter(x => cc[x.c] === 'var(--cOther)');
  const dItems = [...top.map(x => ({ label: x.c, value: x.v, color: cc[x.c] })), ...(rest.length ? [{ label: 'Другое', value: rest.reduce((t, x) => t + x.v, 0), color: 'var(--cOther)' }] : [])];
  const totalExp = cats.reduce((t, x) => t + x.v, 0);
  const where = `<h2>Куда уходят деньги</h2><div class="card vcard">${donut(dItems, 'расходы')}</div>
    <div class="card">${cats.length ? cats.map(x => `<details ${a.open['c' + x.c] ? 'open' : ''} data-anopen="c${esc(x.c)}"><summary><span><i class="sw" style="background:${cc[x.c]}"></i>${esc(x.c)}</span><span class="sub" style="float:right">${money(x.v)} · ${pct(x.v / totalExp)}</span></summary>
      <div class="sub" style="margin:-4px 0 6px">к сравнению: ${deltaHtml(x.v, r2((cps[x.c] || {}).v || 0), false)}</div>
      ${hbars(Object.entries(x.subs).sort((p, q) => q[1] - p[1]).map(([sb, v]) => ({ label: sb, value: r2(v), note: pct(v / x.v) + ' категории' })), cc[x.c])}</details>`).join('') : '<div class="row muted">Расходов за период нет</div>'}</div>`;

  // 4) План и факт за период (план суммируется по месяцам периода)
  const pf = S.cfg.exp.filter(c => !a.cat || c.cat === a.cat).map(c => {
    const plan = r2(ms.reduce((t, M) => t + c.subs.reduce((q, sb) => q + planFor(M, c.cat, sb.name), 0), 0));
    return { cat: c.cat, plan, fact: r2((cs[c.cat] || {}).v || 0) };
  }).filter(x => x.plan || x.fact).sort((p, q) => q.fact - p.fact);
  const pfT = pf.reduce((t, x) => ({ plan: t.plan + x.plan, fact: t.fact + x.fact }), { plan: 0, fact: 0 });
  const planFact = `<h2>План и факт · за период</h2><div class="card">${pf.length ? `<div class="row"><b>Всего</b><span>${money(pfT.fact)} <span class="sub">из ${money(pfT.plan)}</span></span></div>` + pf.map(catBar).join('') : '<div class="row muted">Нет плана и расходов</div>'}</div>`;

  // 5) Средние траты за полные месяцы и подсказка плана
  const full = []; for (let k = 1; k <= 12; k++) { const M = mshift(cur, -k); if (M < mkey(S.cfg.startDate) || (M === mkey(S.cfg.startDate) && !S.cfg.startDate.endsWith('-01'))) break; full.push(M); }
  const subAvg = (cat, sub, n) => { const m = full.slice(0, n); if (!m.length) return null; let t = 0; for (const o of live()) if (o.type === 'Расход' && o.cat === cat && o.sub === sub && m.includes(mkey(o.date)) && !validate(o) && accOK(o)) t += opBase(o); return r2(t / m.length); };
  const round100 = v => Math.ceil(v / 100) * 100;
  const avgRows = S.cfg.exp.filter(c => !a.cat || c.cat === a.cat).map(c => {
    const subs = c.subs.map(sb => ({ name: sb.name, base: +sb.base || 0, a3: subAvg(c.cat, sb.name, 3), a6: subAvg(c.cat, sb.name, 6), a12: subAvg(c.cat, sb.name, 12) }));
    const sum = k => subs.some(x => x[k] !== null) ? r2(subs.reduce((t, x) => t + (x[k] || 0), 0)) : null;
    return { cat: c.cat, subs, a3: sum('a3'), a6: sum('a6'), a12: sum('a12'), base: r2(subs.reduce((t, x) => t + x.base, 0)) };
  }).filter(x => x.a12 || x.base);
  const avgBlock = `<h2>Средние траты в месяц</h2><div class="card">
    ${!full.length ? '<div class="row muted">Средние появятся после первого полного месяца учёта.</div>' : `<div class="muted" style="padding:6px 0">По полным месяцам (сейчас их ${full.length}). «Совет» — среднее за 3 месяца, округлённое вверх до 100 ₸; кнопка ставит его в «План в месяц». 6 и 12 месяцев появятся, когда накопится столько данных.</div>
    ${avgRows.length ? avgRows.map(x => `<details ${a.open['a' + x.cat] ? 'open' : ''} data-anopen="a${esc(x.cat)}"><summary>${esc(x.cat)} <span class="sub" style="float:right">${x.a3 !== null ? money(x.a3) : '–'} · план ${money(x.base)}</span></summary>
      <table class="t tsm"><tr><th>Подкатегория</th><th>3 мес</th><th>6 мес</th><th>12 мес</th><th>План</th></tr>
      ${x.subs.filter(sb => sb.a12 || sb.base).map(sb => { const tip = sb.a3 ? round100(sb.a3) : 0; return `<tr><td>${esc(sb.name)}${tip && tip !== sb.base ? `<div><button class="btn small light" style="margin:3px 0 0;padding:3px 8px;font-size:12px" data-anplan="${esc(x.cat)}|${esc(sb.name)}|${tip}">Совет ${money(tip)} → в план</button></div>` : ''}</td><td>${sb.a3 !== null ? kfmt(sb.a3) : '–'}</td><td>${full.length >= 4 && sb.a6 !== null ? kfmt(sb.a6) : '–'}</td><td>${full.length >= 7 && sb.a12 !== null ? kfmt(sb.a12) : '–'}</td><td>${kfmt(sb.base)}</td></tr>`; }).join('')}</table></details>`).join('') : '<div class="row muted">Пока нет расходов за полные месяцы</div>'}`}</div>`;

  // 6) Поступления: источники дохода и деньги от людей
  const ops = opsIn(r.from, r.to), inc = {}, ppl = {};
  for (const o of ops) {
    if (o.type === 'Доход') { const k = o.cat + (o.sub && o.sub !== o.cat ? ' · ' + o.sub : ''); inc[k] = (inc[k] || 0) + opBase(o); }
    if (o.person && ['Помощь', 'Заём получен', 'Мне вернули долг'].includes(o.type)) { const p = ppl[o.person] = ppl[o.person] || { help: 0, loan: 0, back: 0 }; p[o.type === 'Помощь' ? 'help' : o.type === 'Заём получен' ? 'loan' : 'back'] += opBase(o); }
  }
  const pplRows = Object.entries(ppl).map(([n, p]) => ({ n, ...p, t: p.help + p.loan + p.back })).sort((x, y) => y.t - x.t);
  const pmax = Math.max(1, ...pplRows.map(p => p.t));
  const PT = [['help', 'Помощь', 'var(--c1)'], ['loan', 'Заём (в долг)', 'var(--c2)'], ['back', 'Вернули долг', 'var(--c3)']];
  const income = `<h2>Откуда приходят деньги</h2><div class="card vcard"><div class="muted" style="padding-bottom:4px">Свои доходы по источникам</div>${hbars(Object.entries(inc).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ label: k, value: r2(v), note: pct(v / s.inc) + ' своих доходов' })), 'var(--c1)')}</div>
    <div class="card vcard"><div class="muted" style="padding-bottom:4px">Деньги от людей — помощь, займы и возвраты отдельно</div>
    ${pplRows.length ? legend(PT.filter(([k]) => pplRows.some(p => p[k])).map(([, n, c]) => ({ name: n, color: c }))) + pplRows.map(p => `<div class="hb"${tipAttr([p.n, ...PT.filter(([k]) => p[k]).map(([k, n]) => `${n}: ${money(p[k])}`), `Всего: ${money(p.t)}`])}><div class="hbt"><span>${esc(p.n)}</span><b>${money(p.t)}</b></div>
      <div class="hbbar stack" style="width:${Math.max(2, p.t / pmax * 100)}%">${PT.filter(([k]) => p[k]).map(([k, , c]) => `<i style="flex:${p[k]};background:${c}"></i>`).join('')}</div></div>`).join('') : '<div class="muted">За период денег от людей не было</div>'}</div>`;

  // 7) Карманы и цели (на конец периода)
  const endM = mkey(r.to) > cur ? cur : mkey(r.to), pst = pocketState(endM), pk = pst.list.filter(p => !p.linkSavings && p.kind !== 'goal' && p.bal > 0);
  const gl = goals().filter(g => !g.archived).map(g => goalInfo(g, pocketState(cur)));
  const pockGoals = `<h2>Карманы и цели</h2><div class="card vcard"><div class="muted" style="padding-bottom:4px">Деньги по карманам · ${mlabel(endM)}</div>${donut(pk.map((p, i) => ({ label: p.label || p.name, value: p.bal, color: i < 7 ? `var(--c${i + 1})` : 'var(--cOther)' })), 'в карманах', `<div class="vli"><span><i style="background:var(--line)"></i>Свободно</span><b>${money(pst.free)}</b><span></span></div><div class="vli"><span><i style="background:var(--line)"></i>🛡 Подушка</span><b>${money(pst.savings)}</b><span></span></div>`)}</div>
    <div class="card vcard"><div class="muted" style="padding-bottom:4px">Выполнение целей · сейчас</div>${gl.length ? gl.map(i => `<div class="hb"${tipAttr([i.g.name, `Накоплено: ${money(i.saved)} из ${money(i.target)}`, i.g.deadline ? 'Срок: ' + dRu2(i.g.deadline) : 'Без срока', i.need ? `Нужно в месяц: ${money(i.need)}` : ''].filter(Boolean))}><div class="hbt"><span>🎯 ${esc(i.g.name)}</span><b>${pct(i.pct)}</b></div><div class="hbbar"><i style="width:${Math.max(1, i.pct * 100)}%;background:${i.late ? 'var(--red)' : 'var(--c1)'}"></i></div><div class="sub">${money(i.saved)} из ${money(i.target)}${i.late ? ' · срок прошёл' : i.onTrack ? '' : ' · отстаёт'}</div></div>`).join('') : '<div class="muted">Целей пока нет — «Бюджет → Цели»</div>'}</div>`;

  // 8) Накопления и чистый капитал по месяцам (на конец месяца)
  const cm = monthsBetween(r.from < S.cfg.startDate ? S.cfg.startDate : r.from, r.to).filter(M => M <= cur).slice(-24);
  const capRows = cm.map(M => { const end = M === cur ? today() : mEnd(M), c = capital(end), t = totals(balances(M)); return { M, sav: r2(t.sav), money: r2(t.total), net: c.net }; });
  const capBlock = `<h2>Накопления и чистый капитал</h2><div class="card vcard">${capRows.length ? lineChart(capRows.map(x => mShort(x.M, cm.length > 1 && cm[0].slice(0, 4) !== cm[cm.length - 1].slice(0, 4))), [{ name: 'Накопления', color: 'var(--c1)', vals: capRows.map(x => x.sav) }, { name: 'Чистый капитал', color: 'var(--c2)', vals: capRows.map(x => x.net) }], { tipTitle: capRows.map(x => 'Конец: ' + mlabel(x.M)), aria: 'Накопления и чистый капитал' })
    + (capRows.length > 1 ? `<div class="sub" style="margin-top:4px">За период: накопления ${deltaHtml(capRows[capRows.length - 1].sav, capRows[0].sav, true)} · капитал ${deltaHtml(capRows[capRows.length - 1].net, capRows[0].net, true)}</div>` : '') : '<div class="muted">Нет данных за период</div>'}</div>`;

  // 9) Сравнение лет
  const yr = years.map(y => ({ y, ...sumsIn(y + '-01-01', y + '-12-31') })).filter(x => x.inc || x.help || x.exp);
  const ycols = yr.slice(-3), yColor = i => `var(--c${i + 1})`;
  const yearBlock = `<h2>Сравнение лет</h2><div class="card vcard">${yr.length ? `<table class="t tsm"><tr><th>Год</th><th>Доходы</th><th>Расходы</th><th>Отложено</th></tr>${yr.map((x, i) => { const g = i && yr[i - 1].exp ? (x.exp - yr[i - 1].exp) / yr[i - 1].exp : null; return `<tr><td><b>${x.y}</b></td><td>${kfmt(x.inc)}${x.help ? `<div class="sub">+ помощь ${kfmt(x.help)}</div>` : ''}</td><td>${kfmt(x.exp)}${g !== null ? `<div class="sub ${g > 0 ? 'neg' : 'pos'}">${g > 0 ? '▲ +' : '▼ '}${Math.round(g * 100)}%</div>` : ''}</td><td class="${x.saldo < 0 ? 'neg' : ''}">${kfmt(x.saldo)}<div class="sub">${pct(x.rate)}</div></td></tr>`; }).join('')}</table>
    <div class="muted">Доходы — свои; «Отложено» — всё, что пришло (вкл. помощь), минус расходы. ▲ — рост расходов к прошлому году. Не полный год считается по факту.</div>
    <div class="muted" style="margin:8px 0 2px">Расходы по месяцам — годы друг поверх друга</div>
    ${lineChart(MS, ycols.map((x, i) => ({ name: x.y, color: yColor(i), vals: MS.map((_, k) => { const M = x.y + '-' + String(k + 1).padStart(2, '0'); return M < mkey(S.cfg.startDate) || M > cur ? null : sumsIn(mStart(M), mEnd(M)).exp; }) })), { tipTitle: MONTHS, aria: 'Расходы по месяцам разных лет' })}` : '<div class="muted">Пока нет данных</div>'}</div>`;

  // 10) Остатки счетов на конец любого месяца
  const bM = a.balM || cur, bb = balances(bM);
  const balBlock = `<h2>Остатки на конец месяца</h2><div class="card" style="padding:10px 12px"><input class="in" type="month" id="anBalM" value="${bM}" min="${mkey(S.cfg.startDate)}" max="${cur}">
    <table class="t" style="margin-top:6px">${S.cfg.accounts.map(x => `<tr><td>${esc(x.name)}${x.closed ? ' <span class="sub">· закрыт</span>' : ''}</td><td>${fmt(bb[x.name], accCur(x))}</td></tr>`).join('')}<tr><th>Всего</th><th>${money(totals(bb).total)}</th></tr></table>
    <div class="muted">На ${bM === cur ? 'сегодня' : dRu2(mEnd(bM))}. Можно выбрать конец любого месяца или года (декабрь).</div></div>`;

  $('#view').innerHTML = `<button class="ghost" id="anBack" style="font-size:15px;padding:4px 0">‹ Обзор</button>
    <h2 style="margin-top:4px">📊 Подробная аналитика</h2>${filt}${a.cat ? `<div class="info">Фильтр «${esc(a.cat)}» применяется к расходам; доходы показаны полностью.</div>` : ''}
    ${sumBlock}${dyn}${where}${planFact}${avgBlock}${income}${pockGoals}${capBlock}${yearBlock}${balBlock}
    <p class="muted">Суммы в ${esc(CUR[baseCur()].sym)}; счета в другой валюте пересчитаны по курсу операции или текущему курсу. Ошибочные операции в итоги не входят.</p>`;

  $('#anBack').onclick = () => setTab('overview');
  document.querySelectorAll('[data-anp]').forEach(b => b.onclick = () => { a.p = b.dataset.anp; if (a.p === 'm') S.month = S.month || cur; renderAnalytics(); });
  document.querySelectorAll('[data-ancmp]').forEach(b => b.onclick = () => { a.cmp = b.dataset.ancmp; renderAnalytics(); });
  if ($('#anY')) $('#anY').onchange = e => { a.y = e.target.value; renderAnalytics(); };
  if ($('#anFrom')) { $('#anFrom').onchange = e => { a.from = e.target.value; renderAnalytics(); }; $('#anTo').onchange = e => { a.to = e.target.value; renderAnalytics(); }; }
  $('#anCat').onchange = e => { a.cat = e.target.value; renderAnalytics(); };
  $('#anAcc').onchange = e => { a.acc = e.target.value; renderAnalytics(); };
  $('#anBalM').onchange = e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { a.balM = e.target.value; renderAnalytics(); } };
  document.querySelectorAll('[data-anopen]').forEach(d => d.addEventListener('toggle', () => { a.open[d.dataset.anopen] = d.open; }));
  document.querySelectorAll('[data-anplan]').forEach(b => b.onclick = async e => {
    e.preventDefault();
    const [cat, sub, v] = b.dataset.anplan.split('|'), c = S.cfg.exp.find(x => x.cat === cat), sb = c && c.subs.find(x => x.name === sub);
    if (!sb || !confirm(`Поставить «План в месяц» для «${cat} → ${sub}»: ${money(+v)} (было ${money(+sb.base || 0)})?`)) return;
    sb.base = +v; await saveCfg(); toast('План обновлён ✓'); renderAnalytics();
  });
}
