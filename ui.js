'use strict';
/* Жизнь — внешний вид: компактные экраны и мягкие графики.
   1) Сворачиваемые блоки: каждый заголовок h2 на экране становится блоком, который раскрывается по нажатию.
      В заголовке — короткий итог (атрибут data-sum у h2). Что открыто — запоминается на этом устройстве.
      Формы «+ Новый …» тоже прячутся под кнопку.
   2) Категории — полоски одного цвета с подписями вместо разноцветного кольца.
   Подключается последним. */

// ---------- Сворачиваемые блоки ----------
const FOLD_TABS = ['today', 'overview', 'analytics', 'budget', 'more', 'char', 'report', 'plan'];
// что открыто по умолчанию (пока человек сам не открыл/закрыл)
const FOLD_OPEN = {
  today: t => !/^(Шкалы|Деньги)/.test(t),
  overview: t => /^Внимание/.test(t),
  analytics: t => /^Итоги/.test(t),
  budget: (t, i) => i === 0,
  char: (t, i) => i === 0,
  more: () => false,
  report: () => true,
  plan: () => true,
};
const foldState = { get() { try { return JSON.parse(localStorage.getItem('zhizn-folds') || '{}'); } catch (e) { return {}; } }, set(k, v) { try { const s = this.get(); s[k] = v; localStorage.setItem('zhizn-folds', JSON.stringify(s)); } catch (e) {} } };
const foldKey = (tab, h) => tab + ':' + (S.tab === 'budget' ? (S.btab || 'pockets') + ':' : S.tab === 'char' ? (S.charSeg || 'card') + ':' : '') + h.textContent.split('·')[0].replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 40);
let folding = false;
function autoFold() {
  const view = $('#view'); if (!view || !FOLD_TABS.includes(S.tab)) return;
  folding = true;
  try {
    const st = foldState.get(), rule = FOLD_OPEN[S.tab] || (() => true);
    const hs = [...view.children].filter(el => el.tagName === 'H2' && !el.hasAttribute('data-nofold'));
    hs.forEach((h, i) => {
      const parts = []; let el = h.nextElementSibling;
      while (el && !(el.tagName === 'H2') && !el.hasAttribute('data-nofold')) { parts.push(el); el = el.nextElementSibling; }
      if (!parts.length) return;
      const key = foldKey(S.tab, h), open = key in st ? st[key] : rule(h.textContent.trim(), i);
      const d = document.createElement('details'); d.className = 'fold'; d.dataset.fold = key; if (open) d.open = true;
      const s = document.createElement('summary');
      s.innerHTML = `<span class="fold-t">${h.innerHTML}</span>${h.dataset.sum ? `<span class="fold-s">${h.dataset.sum}</span>` : ''}`;
      d.appendChild(s); h.replaceWith(d); parts.forEach(p => d.appendChild(p));
      s.addEventListener('click', e => { if (e.target.closest('button,a,input,select,label')) e.preventDefault(); });
      d.addEventListener('toggle', () => foldState.set(key, d.open));
    });
    // формы добавления «+ …» — под кнопку
    view.querySelectorAll('.card').forEach(c => {
      const b = c.firstElementChild; if (!b || b.tagName !== 'B' || !/^\s*[+＋]/.test(b.textContent) || c.closest('details.addf')) return;
      const key = 'add:' + S.tab + ':' + b.textContent.trim().slice(0, 30), d = document.createElement('details');
      d.className = 'card addf'; d.dataset.fold = key; if (foldState.get()[key] || c.querySelector('.err:not(:empty)')) d.open = true;
      // форма правки (Изменить …) всегда открыта
      if (/Изменить|Правка/.test(b.textContent)) d.open = true;
      const s = document.createElement('summary'); s.innerHTML = b.innerHTML; b.remove();
      d.appendChild(s); while (c.firstChild) d.appendChild(c.firstChild); c.replaceWith(d);
      d.addEventListener('toggle', () => foldState.set(key, d.open));
    });
  } finally { folding = false; }
}
function foldInit() {
  const view = $('#view'); if (!view || window.__foldObs) return;
  window.__foldObs = new MutationObserver(() => { if (!folding) autoFold(); });
  window.__foldObs.observe(view, { childList: true });
}
document.addEventListener('DOMContentLoaded', foldInit);
if (document.readyState !== 'loading') foldInit();

// ---------- Категории: полоски одного цвета вместо кольца ----------
// (переопределяет donut из analytics.js — у категорий цвет не нужен, подписи и проценты важнее)
function donut(items, center, sub) {
  const list = items.filter(i => i.value > 0), tot = list.reduce((s, i) => s + i.value, 0);
  if (!tot) return '<div class="muted">Нет данных за период</div>';
  const mx = Math.max(...list.map(i => i.value));
  return `<div class="viz cbars"><div class="cb-tot"><b>${money(tot)}</b> <span class="sub">${esc(center || '')}</span></div>
    ${list.map(i => `<div class="cb" data-tip="${esc(i.label + '|' + money(i.value) + ' · ' + Math.round(i.value / tot * 100) + '%')}"><div class="cb-t"><span>${esc(i.label)}</span><span><b>${money(i.value)}</b> <span class="sub">${Math.round(i.value / tot * 100)}%</span></span></div><div class="cb-bar"><i style="width:${Math.max(2, i.value / mx * 100)}%"></i></div></div>`).join('')}
    ${sub ? `<div class="cb-sub">${sub}</div>` : ''}</div>`;
}
// цвет категорий в списках — один, фирменный
function catColors() { const m = {}; for (const c of S.cfg.exp) m[c.cat] = 'var(--c1)'; return m; }
