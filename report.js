'use strict';
/* Жизнь — Финансы: месячный отчёт.
   Экран отчёта (сохраняется в PDF через печать браузера) и файл Excel (.xlsx), который собирается прямо на устройстве, без библиотек.
   Подключается после app.js и analytics.js. */

function reportData(M) {
  const from = mStart(M), to = mEnd(M), s = sumsIn(from, to, true), pv = sumsIn(mStart(mshift(M, -1)), mEnd(mshift(M, -1)), true);
  const b = budget(M), ops = opsIn(from, to, true).sort((x, y) => x.date.localeCompare(y.date));
  const ppl = {};
  for (const o of ops) if (o.person && TYPE[o.type] && TYPE[o.type].sign > 0) { const p = ppl[o.person] = ppl[o.person] || {}; p[o.type] = (p[o.type] || 0) + opBase(o); }
  const cur = mkey(today()), end = M >= cur ? today() : to;
  const bal = balances(M), ps = pocketState(M > cur ? cur : M);
  const gl = goals().filter(g => !g.archived).map(g => goalInfo(g, pocketState(cur)));
  return { M, from, to, s, pv, b, ops, ppl, bal, tot: totals(bal), ps, gl, cap: capital(end), top: ops.filter(o => o.type === 'Расход').sort((x, y) => opBase(y) - opBase(x)).slice(0, 10) };
}

function renderReport() {
  const R = reportData(S.month), s = R.s, pv = R.pv;
  const row = (l, v, p, goodUp) => `<tr><td>${l}</td><td>${money(v)}</td><td>${money(p)}</td><td>${deltaHtml(v, p, goodUp)}</td></tr>`;
  const cats = R.b.cats.filter(c => c.plan || c.fact).sort((x, y) => y.fact - x.fact);
  $('#view').innerHTML = `<div class="noprint" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
      <button class="btn small light" id="rpBack" style="margin:0">‹ Назад</button>
      <button class="btn small" id="rpPdf" style="margin:0">🖨 Сохранить PDF</button>
      <button class="btn small" id="rpXlsx" style="margin:0">⬇ Скачать Excel</button></div>
    <div class="muted noprint">Месяц выбирается стрелками вверху. PDF: в окне печати выбери «Сохранить как PDF».</div>
    <div class="report">
    <h1 class="rp-title">Финансовый отчёт · ${mlabel(R.M)}</h1>
    <div class="muted">Период ${dRu2(R.from)} — ${dRu2(R.to)} · составлен ${dRu2(today())} · приложение «Жизнь»</div>
    <h2>Итоги месяца</h2>
    <div class="card"><table class="t tsm"><tr><th></th><th>${mShort(R.M, true)}</th><th>${mShort(mshift(R.M, -1), true)}</th><th>Изменение</th></tr>
      ${row('Доходы (свои)', s.inc, pv.inc, true)}${row('Помощь', s.help, pv.help, true)}${row('Расходы', s.exp, pv.exp, false)}${row('Сальдо', s.saldo, pv.saldo, true)}
      <tr><td>Отложено от поступлений</td><td>${pct(s.rate)}</td><td>${pct(pv.rate)}</td><td></td></tr></table></div>
    <h2>Бюджет по категориям</h2>
    <div class="card"><table class="t tsm"><tr><th>Категория</th><th>План</th><th>Факт</th><th>Остаток</th></tr>
      ${cats.map(c => `<tr><td>${esc(c.cat)}</td><td>${money(c.plan)}</td><td>${money(c.fact)}</td><td class="${c.diff < 0 ? 'neg' : ''}">${money(c.diff)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Нет плана и расходов</td></tr>'}
      <tr><th>Итого</th><th>${money(R.b.plan)}</th><th>${money(R.b.fact)}</th><th class="${R.b.diff < 0 ? 'neg' : ''}">${money(R.b.diff)}</th></tr></table></div>
    <h2>Крупные расходы</h2>
    <div class="card"><table class="t tsm">${R.top.map(o => `<tr><td style="white-space:normal">${dRu2(o.date).slice(0, 5)} · ${esc(o.cat)} · ${esc(o.sub)}${o.comment ? ' · ' + esc(o.comment) : ''}</td><td>${money(opBase(o))}</td></tr>`).join('') || '<tr><td class="muted">Расходов нет</td></tr>'}</table></div>
    ${Object.keys(R.ppl).length ? `<h2>Деньги от людей</h2><div class="card"><table class="t tsm">${Object.entries(R.ppl).map(([n, p]) => `<tr><td>${esc(n)}<div class="sub">${Object.entries(p).map(([t, v]) => esc(t) + ': ' + money(v)).join(' · ')}</div></td><td>${money(Object.values(p).reduce((a, v) => a + v, 0))}</td></tr>`).join('')}</table></div>` : ''}
    <h2>Счета на конец месяца</h2>
    <div class="card"><table class="t tsm">${S.cfg.accounts.filter(a => !a.closed || r2(R.bal[a.name])).map(a => `<tr><td>${esc(a.name)}</td><td>${fmt(R.bal[a.name], accCur(a))}</td></tr>`).join('')}<tr><th>Всего</th><th>${money(R.tot.total)}</th></tr>
      <tr><td>из них накопления</td><td>${money(R.tot.sav)}</td></tr><tr><td>Чистый капитал</td><td>${money(R.cap.net)}</td></tr></table></div>
    <h2>Карманы</h2>
    <div class="card"><table class="t tsm">${R.ps.list.filter(p => p.bal || p.plan).map(p => `<tr><td>${esc(p.label || p.name)}</td><td class="${p.bal < 0 ? 'neg' : ''}">${money(p.bal)}</td></tr>`).join('')}<tr><td>Свободно</td><td>${money(R.ps.free)}</td></tr></table></div>
    ${R.gl.length ? `<h2>Цели</h2><div class="card"><table class="t tsm">${R.gl.map(i => `<tr><td>${esc(i.g.name)}${i.g.deadline ? '<div class="sub">срок ' + dRu2(i.g.deadline) + '</div>' : ''}</td><td>${money(i.saved)} из ${money(i.target)}<div class="sub">${pct(i.pct)}</div></td></tr>`).join('')}</table></div>` : ''}
    <p class="muted">Это личный учёт, а не финансовая или инвестиционная рекомендация.</p></div>`;
  $('#rpBack').onclick = () => setTab('analytics');
  $('#rpPdf').onclick = () => { const t = document.title; document.title = `Финансовый отчёт ${R.M}`; window.print(); setTimeout(() => { document.title = t; }, 1000); };
  $('#rpXlsx').onclick = () => { downloadBlob(`Финансовый отчёт ${R.M}.xlsx`, reportXlsx(R)); toast('Файл Excel сохранён в «Загрузки»'); };
}

function reportXlsx(R) {
  const B = v => ({ v, b: true }), n = v => r2(v), s = R.s, pv = R.pv;
  const sum = [[B(`Финансовый отчёт · ${mlabel(R.M)}`)], [`Период ${dRu2(R.from)} — ${dRu2(R.to)}, составлен ${dRu2(today())}`], [],
    [B('Итоги'), B(mlabel(R.M)), B(mlabel(mshift(R.M, -1))), B('Изменение')],
    ...[['Доходы (свои)', s.inc, pv.inc], ['Помощь', s.help, pv.help], ['Расходы', s.exp, pv.exp], ['Сальдо (пришло − потрачено)', s.saldo, pv.saldo]].map(([l, a, b]) => [l, n(a), n(b), n(a - b)]),
    ['Отложено от поступлений, %', s.rate === null ? '' : Math.round(s.rate * 100), pv.rate === null ? '' : Math.round(pv.rate * 100)], [],
    [B('Категория'), B('План'), B('Факт'), B('Остаток')],
    ...R.b.cats.filter(c => c.plan || c.fact).sort((x, y) => y.fact - x.fact).map(c => [c.cat, n(c.plan), n(c.fact), n(c.diff)]),
    [B('Итого'), B(n(R.b.plan)), B(n(R.b.fact)), B(n(R.b.diff))], [],
    [B('Деньги от людей'), B('Сумма'), B('Из них')],
    ...Object.entries(R.ppl).map(([nm, p]) => [nm, n(Object.values(p).reduce((a, v) => a + v, 0)), Object.entries(p).map(([t, v]) => t + ': ' + r2(v)).join('; ')]), [],
    [B('Счёт (конец месяца)'), B('Остаток'), B('Валюта')], ...S.cfg.accounts.filter(a => !a.closed || r2(R.bal[a.name])).map(a => [a.name, n(R.bal[a.name]), accCur(a)]),
    [B('Всего, ' + baseCur()), B(n(R.tot.total))], ['Накопления', n(R.tot.sav)], ['Чистый капитал', n(R.cap.net)], [],
    [B('Карман'), B('Остаток')], ...R.ps.list.filter(p => p.bal || p.plan).map(p => [p.label || p.name, n(p.bal)]), ['Свободно', n(R.ps.free)],
    ...(R.gl.length ? [[], [B('Цель'), B('Накоплено'), B('Сумма цели'), B('Срок')], ...R.gl.map(i => [i.g.name, n(i.saved), n(i.target), i.g.deadline ? dRu2(i.g.deadline) : ''])] : [])];
  const opsRows = [[B('Дата'), B('Тип'), B('Счёт'), B('Категория'), B('Подкатегория'), B('Сумма'), B('Сумма, ' + baseCur()), B('Человек'), B('Где или что')],
    ...R.ops.map(o => [dRu2(o.date), o.type, o.account + (o.to ? ' → ' + o.to : ''), o.cat || '', o.sub || '', n(o.amount), n(opBase(o)), o.person || '', o.comment || ''])];
  return xlsxBlob([{ name: 'Итоги', rows: sum, widths: [34, 18, 18, 18] }, { name: 'Операции', rows: opsRows, widths: [11, 20, 22, 18, 20, 13, 14, 14, 26] }]);
}

function downloadBlob(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }

// ---------- Мини-генератор .xlsx: ZIP без сжатия + XML листов ----------
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) { let c = (crc ^ buf[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ -1) >>> 0;
}
function zipStore(files, type) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), d = enc.encode(f.text), crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + d.length;
  }
  const csize = central.reduce((t, p) => t + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type });
}
function xlsxBlob(sheets) {
  const x = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = i => { let t = ''; i++; while (i) { const m = (i - 1) % 26; t = String.fromCharCode(65 + m) + t; i = Math.floor((i - 1) / 26); } return t; };
  const cell = (c, ref) => {
    if (c === null || c === undefined || c === '') return '';
    const o = typeof c === 'object' ? c : { v: c }, isN = typeof o.v === 'number' && isFinite(o.v), st = (o.b ? 1 : 0) + (isN ? 2 : 0);
    return isN ? `<c r="${ref}" s="${st}"><v>${o.v}</v></c>` : `<c r="${ref}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${x(o.v)}</t></is></c>`;
  };
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const NS = 'http://schemas.openxmlformats.org', REL = NS + '/officeDocument/2006/relationships';
  const sheetXml = sh => H + `<worksheet xmlns="${NS}/spreadsheetml/2006/main">${sh.widths ? '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : ''}<sheetData>${sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => cell(c, col(ci) + (ri + 1))).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', text: H + `<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: H + `<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: H + `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${sheets.map((sh, i) => `<sheet name="${x(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: H + `<Relationships xmlns="${NS}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: H + `<styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sh) })),
  ];
  return zipStore(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
