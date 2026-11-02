(function () {
  'use strict';

  const STORAGE_KEY = 'ph-expense-tracker-v1';
  const TZ = 'Asia/Manila';

  const DEFAULT_CATEGORIES = [
    { id: 'food', name: 'Food', icon: '🍜' },
    { id: 'transport', name: 'Transport', icon: '🚌' },
    { id: 'bills', name: 'Bills', icon: '💡' },
    { id: 'load', name: 'Load/Internet', icon: '📱' },
    { id: 'groceries', name: 'Groceries', icon: '🛒' },
    { id: 'shopping', name: 'Shopping', icon: '🛍️' },
    { id: 'health', name: 'Health', icon: '💊' },
    { id: 'business', name: 'Business', icon: '💼' },
    { id: 'others', name: 'Others', icon: '📦' }
  ];

  const PAYMENTS = ['Cash', 'GCash', 'Maya', 'Card', 'Bank'];
  const CHART_COLORS = ['#0f766e', '#14b8a6', '#0284c7', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#059669', '#64748b', '#e11d48'];

  /** @type {{entries: any[], categories: any[], budget: number, theme: string}} */
  let state = loadState();
  let entryType = 'expense';
  let selectedCategory = state.categories[0] ? state.categories[0].id : 'others';
  let selectedPay = 'Cash';
  let period = 'day';
  let showAll = false;
  let expandedId = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function manilaParts(d) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    // en-CA gives YYYY-MM-DD
    const parts = fmt.formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    return { y: get('year'), m: get('month'), day: get('day'), iso: `${get('year')}-${get('month')}-${get('day')}` };
  }

  function todayISO() {
    return manilaParts(new Date()).iso;
  }

  function formatMoney(n) {
    const v = Number(n) || 0;
    return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDateLabel(iso) {
    try {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 4, 0, 0)); // noon-ish Manila offset safe
      return dt.toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function uid() {
    return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { entries: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), budget: 0, theme: '' };
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.categories) || !parsed.categories.length) {
        parsed.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      }
      if (!Array.isArray(parsed.entries)) parsed.entries = [];
      if (typeof parsed.budget !== 'number') parsed.budget = 0;
      if (typeof parsed.theme !== 'string') parsed.theme = '';
      return parsed;
    } catch (e) {
      return { entries: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), budget: 0, theme: '' };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function catById(id) {
    return state.categories.find((c) => c.id === id) || { id: 'others', name: 'Others', icon: '📦' };
  }

  function applyTheme() {
    if (state.theme === 'light' || state.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', state.theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function setTab(name) {
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel').forEach((p) => {
      const on = p.id === 'tab-' + name;
      p.classList.toggle('active', on);
      p.hidden = !on;
    });
    if (name === 'add') {
      if (!$('#editId').value) resetForm();
    }
    if (name === 'stats') renderStats();
    if (name === 'more') {
      renderCatEdit();
      $('#budgetInput').value = state.budget || '';
      updateBudgetHint();
    }
  }

  function resetForm() {
    $('#editId').value = '';
    $('#amount').value = '';
    $('#note').value = '';
    $('#date').value = todayISO();
    entryType = 'expense';
    selectedCategory = state.categories[0] ? state.categories[0].id : 'others';
    selectedPay = 'Cash';
    $$('.type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === 'expense'));
    $('#saveBtn').textContent = 'Save expense';
    $('#cancelEditBtn').hidden = true;
    $('#categoryField').hidden = false;
    $('#paymentField').hidden = false;
    renderCatGrid();
    renderPayChips();
  }

  function renderCatGrid() {
    const grid = $('#catGrid');
    grid.innerHTML = '';
    state.categories.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn' + (c.id === selectedCategory ? ' active' : '');
      btn.innerHTML = '<span class="ico">' + c.icon + '</span><span>' + escapeHtml(c.name) + '</span>';
      btn.addEventListener('click', () => {
        selectedCategory = c.id;
        renderCatGrid();
      });
      grid.appendChild(btn);
    });
  }

  function renderPayChips() {
    $$('#payRow .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.pay === selectedPay);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function filteredEntries() {
    const q = ($('#searchInput').value || '').trim().toLowerCase();
    const cat = $('#filterCategory').value;
    const typ = $('#filterType').value;
    const today = todayISO();
    let list = state.entries.slice();
    if (!showAll) list = list.filter((e) => e.date === today);
    if (cat) list = list.filter((e) => e.categoryId === cat);
    if (typ) list = list.filter((e) => e.type === typ);
    if (q) {
      list = list.filter((e) => {
        const catName = catById(e.categoryId).name.toLowerCase();
        return (e.note || '').toLowerCase().includes(q) ||
          catName.includes(q) ||
          (e.payment || '').toLowerCase().includes(q) ||
          String(e.amount).includes(q);
      });
    }
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }

  function sumFor(dateISO, type) {
    return state.entries
      .filter((e) => e.date === dateISO && e.type === type)
      .reduce((s, e) => s + Number(e.amount), 0);
  }

  function monthKey(iso) {
    return iso.slice(0, 7);
  }

  function monthSpend(ym) {
    return state.entries
      .filter((e) => e.type === 'expense' && monthKey(e.date) === ym)
      .reduce((s, e) => s + Number(e.amount), 0);
  }

  function renderSummary() {
    const today = todayISO();
    $('#todayLabel').textContent = formatDateLabel(today);
    $('#todaySpent').textContent = formatMoney(sumFor(today, 'expense'));
    $('#todayIncome').textContent = formatMoney(sumFor(today, 'income'));

    const ym = today.slice(0, 7);
    const spent = monthSpend(ym);
    const budget = Number(state.budget) || 0;
    const leftEl = $('#budgetLeft');
    const fill = $('#budgetFill');
    if (budget > 0) {
      const left = budget - spent;
      leftEl.textContent = formatMoney(left);
      const pct = Math.min(100, (spent / budget) * 100);
      fill.style.width = pct + '%';
      fill.classList.toggle('warn', pct >= 80 && pct < 100);
      fill.classList.toggle('over', pct >= 100);
      if (left < 0) leftEl.style.color = 'var(--danger)';
      else if (pct >= 80) leftEl.style.color = 'var(--warn)';
      else leftEl.style.color = '';
    } else {
      leftEl.textContent = 'Not set';
      leftEl.style.color = 'var(--muted)';
      fill.style.width = '0%';
      fill.classList.remove('warn', 'over');
    }
  }

  function renderFilterCats() {
    const sel = $('#filterCategory');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>';
    state.categories.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.icon + ' ' + c.name;
      sel.appendChild(opt);
    });
    sel.value = cur;
  }

  function renderList() {
    const list = filteredEntries();
    const ul = $('#entryList');
    const empty = $('#emptyState');
    ul.innerHTML = '';
    empty.hidden = list.length > 0;
    $('#showAllBtn').textContent = showAll ? 'Show today' : 'Show all';
    $('.list-head h2').textContent = showAll ? 'All entries' : 'Today';

    list.forEach((e) => {
      const cat = catById(e.categoryId);
      const li = document.createElement('li');
      li.className = 'entry';
      li.dataset.id = e.id;
      const sign = e.type === 'income' ? '+' : '−';
      const metaParts = [];
      if (showAll || e.date !== todayISO()) metaParts.push(e.date);
      if (e.type === 'expense') metaParts.push(e.payment || 'Cash');
      if (e.note) metaParts.push(e.note);
      li.innerHTML =
        '<div class="entry-icon">' + cat.icon + '</div>' +
        '<div class="entry-main">' +
          '<div class="entry-title">' + escapeHtml(e.type === 'income' ? 'Income' : cat.name) + '</div>' +
          '<div class="entry-meta">' + escapeHtml(metaParts.join(' · ') || '—') + '</div>' +
        '</div>' +
        '<div class="entry-amt ' + e.type + '">' + sign + formatMoney(e.amount) + '</div>';

      if (expandedId === e.id) {
        const actions = document.createElement('div');
        actions.className = 'entry-actions';
        actions.innerHTML = '<button type="button" class="edit">Edit</button><button type="button" class="del">Delete</button>';
        actions.querySelector('.edit').addEventListener('click', (ev) => {
          ev.stopPropagation();
          startEdit(e);
        });
        actions.querySelector('.del').addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (confirm('Delete this entry?')) {
            state.entries = state.entries.filter((x) => x.id !== e.id);
            saveState();
            expandedId = null;
            refresh();
            toast('Deleted');
          }
        });
        li.appendChild(actions);
      }

      li.addEventListener('click', () => {
        expandedId = expandedId === e.id ? null : e.id;
        renderList();
      });
      ul.appendChild(li);
    });
  }

  function startEdit(e) {
    setTab('add');
    $('#editId').value = e.id;
    entryType = e.type;
    $$('.type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === e.type));
    $('#amount').value = e.amount;
    $('#note').value = e.note || '';
    $('#date').value = e.date;
    selectedCategory = e.categoryId || (state.categories[0] && state.categories[0].id);
    selectedPay = e.payment || 'Cash';
    $('#categoryField').hidden = e.type === 'income';
    $('#paymentField').hidden = e.type === 'income';
    $('#saveBtn').textContent = e.type === 'income' ? 'Update income' : 'Update expense';
    $('#cancelEditBtn').hidden = false;
    renderCatGrid();
    renderPayChips();
    $('#amount').focus();
  }

  function periodRange() {
    const today = todayISO();
    if (period === 'day') return { start: today, end: today };
    if (period === 'week') {
      const [y, m, d] = today.split('-').map(Number);
      // Find Monday of current week in Manila by iterating
      const base = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
      const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(base);
      const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const offset = map[wd] || 0;
      const startDate = new Date(base);
      startDate.setUTCDate(startDate.getUTCDate() - offset);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const dd = new Date(startDate);
        dd.setUTCDate(startDate.getUTCDate() + i);
        days.push(manilaParts(dd).iso);
      }
      return { start: days[0], end: days[6], days };
    }
    // month
    const ym = today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0, 4, 0, 0));
    const end = manilaParts(lastDay).iso;
    const days = [];
    const dim = Number(end.slice(8, 10));
    for (let i = 1; i <= dim; i++) {
      days.push(ym + '-' + String(i).padStart(2, '0'));
    }
    return { start: ym + '-01', end, days };
  }

  function entriesInRange(start, end) {
    return state.entries.filter((e) => e.date >= start && e.date <= end);
  }

  function renderStats() {
    const range = periodRange();
    const list = entriesInRange(range.start, range.end);
    const spent = list.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0);
    const income = list.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0);
    $('#periodSpent').textContent = formatMoney(spent);
    $('#periodIncome').textContent = formatMoney(income);
    $('#periodNet').textContent = formatMoney(income - spent);

    // Category pie-ish donut via SVG
    const byCat = {};
    list.filter((e) => e.type === 'expense').forEach((e) => {
      byCat[e.categoryId] = (byCat[e.categoryId] || 0) + Number(e.amount);
    });
    const catEntries = Object.keys(byCat).map((id) => ({ id, amount: byCat[id], cat: catById(id) }))
      .sort((a, b) => b.amount - a.amount);
    renderDonut($('#catChart'), catEntries, spent);

    // Trend bars
    let days = range.days;
    if (!days) days = [range.start];
    if (period === 'month' && days.length > 14) {
      // weekly buckets for month view readability
      const buckets = [];
      for (let i = 0; i < days.length; i += 7) {
        const slice = days.slice(i, i + 7);
        buckets.push({
          label: slice[0].slice(8),
          amount: slice.reduce((s, d) => s + list.filter((e) => e.date === d && e.type === 'expense').reduce((a, e) => a + Number(e.amount), 0), 0)
        });
      }
      renderBars($('#trendChart'), buckets);
    } else {
      const points = days.map((d) => ({
        label: d.slice(8),
        amount: list.filter((e) => e.date === d && e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0)
      }));
      renderBars($('#trendChart'), points);
    }

    const ul = $('#breakdownList');
    ul.innerHTML = '';
    if (!catEntries.length) {
      ul.innerHTML = '<li><span>No expenses in this period</span><strong>₱0.00</strong></li>';
      return;
    }
    catEntries.forEach((row) => {
      const li = document.createElement('li');
      const pct = spent ? ((row.amount / spent) * 100).toFixed(0) : '0';
      li.innerHTML = '<span>' + row.cat.icon + ' ' + escapeHtml(row.cat.name) + ' · ' + pct + '%</span><strong>' + formatMoney(row.amount) + '</strong>';
      ul.appendChild(li);
    });
  }

  function renderDonut(box, rows, total) {
    const w = 280, h = 180, cx = 90, cy = 90, r = 62, stroke = 22;
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
    if (!rows.length || total <= 0) {
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="' + stroke + '"/>';
      svg += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="12" fill="currentColor">No data</text></svg>';
      box.innerHTML = svg;
      return;
    }
    const circ = 2 * Math.PI * r;
    let offset = 0;
    rows.forEach((row, i) => {
      const len = (row.amount / total) * circ;
      const color = CHART_COLORS[i % CHART_COLORS.length];
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      offset += len;
    });
    svg += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="11" fill="currentColor">Spent</text>';
    svg += '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">' + formatMoney(total) + '</text>';
    let ly = 24;
    rows.slice(0, 6).forEach((row, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      svg += '<rect x="170" y="' + ly + '" width="10" height="10" rx="2" fill="' + color + '"/>';
      svg += '<text x="186" y="' + (ly + 9) + '" font-size="11" fill="currentColor">' + escapeHtml(row.cat.name) + '</text>';
      ly += 18;
    });
    svg += '</svg>';
    box.innerHTML = svg;
  }

  function renderBars(box, points) {
    const w = 320, h = 160, pad = 28, gap = 4;
    const max = Math.max(1, ...points.map((p) => p.amount));
    const barW = Math.max(6, (w - pad * 2 - gap * (points.length - 1)) / points.length);
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
    svg += '<line x1="' + pad + '" y1="' + (h - 24) + '" x2="' + (w - 8) + '" y2="' + (h - 24) + '" stroke="var(--border)"/>';
    points.forEach((p, i) => {
      const bh = ((h - 40) * p.amount) / max;
      const x = pad + i * (barW + gap);
      const y = h - 24 - bh;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(1, bh) + '" rx="3" fill="#14b8a6"/>';
      if (points.length <= 10 || i % 2 === 0) {
        svg += '<text x="' + (x + barW / 2) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="9" fill="currentColor">' + escapeHtml(p.label) + '</text>';
      }
    });
    svg += '</svg>';
    box.innerHTML = svg;
  }

  function renderCatEdit() {
    const ul = $('#catEditList');
    ul.innerHTML = '';
    state.categories.forEach((c) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="ico">' + c.icon + '</span>';
      const input = document.createElement('input');
      input.value = c.name;
      input.addEventListener('change', () => {
        c.name = input.value.trim() || c.name;
        saveState();
        renderFilterCats();
        renderCatGrid();
        toast('Category updated');
      });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.title = 'Remove';
      rm.addEventListener('click', () => {
        if (state.categories.length <= 1) {
          toast('Keep at least one category');
          return;
        }
        if (!confirm('Remove category “' + c.name + '”? Existing entries keep the old name until edited.')) return;
        state.categories = state.categories.filter((x) => x.id !== c.id);
        if (selectedCategory === c.id) selectedCategory = state.categories[0].id;
        saveState();
        renderCatEdit();
        renderFilterCats();
        renderCatGrid();
      });
      li.appendChild(input);
      li.appendChild(rm);
      ul.appendChild(li);
    });
  }

  function updateBudgetHint() {
    const ym = todayISO().slice(0, 7);
    const spent = monthSpend(ym);
    const budget = Number(state.budget) || 0;
    if (!budget) {
      $('#budgetHint').textContent = 'Set a monthly budget to see remaining amount and warnings on Home.';
      return;
    }
    const left = budget - spent;
    $('#budgetHint').textContent = 'This month spent ' + formatMoney(spent) + ' of ' + formatMoney(budget) +
      (left >= 0 ? (' · ' + formatMoney(left) + ' left') : (' · over by ' + formatMoney(-left)));
  }

  function refresh() {
    renderSummary();
    renderList();
    if ($('#tab-stats').classList.contains('active')) renderStats();
  }

  function exportCSV() {
    const headers = ['id', 'type', 'date', 'amount', 'category', 'payment', 'note'];
    const rows = [headers.join(',')];
    state.entries.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach((e) => {
      const cat = catById(e.categoryId).name;
      const cells = [e.id, e.type, e.date, e.amount, cat, e.payment || '', e.note || ''].map((v) => {
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? '"' + s + '"' : s;
      });
      rows.push(cells.join(','));
    });
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), 'expenses-' + todayISO() + '.csv');
    toast('CSV exported');
  }

  function exportJSON() {
    const payload = {
      app: 'ph-expense-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      timezone: TZ,
      data: state
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'expenses-backup-' + todayISO() + '.json');
    toast('JSON backup exported');
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.entries) || !Array.isArray(data.categories)) {
          throw new Error('Invalid backup');
        }
        if (!confirm('Replace all current data with this backup?')) return;
        state = {
          entries: data.entries,
          categories: data.categories,
          budget: typeof data.budget === 'number' ? data.budget : 0,
          theme: typeof data.theme === 'string' ? data.theme : state.theme
        };
        saveState();
        applyTheme();
        renderFilterCats();
        renderCatGrid();
        refresh();
        toast('Backup imported');
      } catch (err) {
        toast('Import failed');
      }
    };
    reader.readAsText(file);
  }

  function loadSample() {
    if (state.entries.length && !confirm('Add sample entries on top of existing data?')) return;
    const today = todayISO();
    const [y, m, d] = today.split('-').map(Number);
    const yest = manilaParts(new Date(Date.UTC(y, m - 1, d - 1, 4, 0, 0))).iso;
    const samples = [
      { type: 'expense', amount: 120, categoryId: 'food', payment: 'GCash', note: 'Lunch — carinderia', date: today },
      { type: 'expense', amount: 50, categoryId: 'transport', payment: 'Cash', note: 'Jeepney', date: today },
      { type: 'expense', amount: 299, categoryId: 'load', payment: 'GCash', note: 'Globe promo', date: today },
      { type: 'income', amount: 500, categoryId: 'others', payment: '', note: 'Side gig', date: today },
      { type: 'expense', amount: 850, categoryId: 'groceries', payment: 'Maya', note: 'SM groceries', date: yest },
      { type: 'expense', amount: 1500, categoryId: 'bills', payment: 'Bank', note: 'Meralco', date: yest }
    ];
    samples.forEach((s) => {
      state.entries.push({
        id: uid(),
        createdAt: Date.now(),
        ...s
      });
    });
    if (!state.budget) state.budget = 15000;
    saveState();
    refresh();
    toast('Sample data loaded');
  }

  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

    $$('.type-btn').forEach((b) => b.addEventListener('click', () => {
      entryType = b.dataset.type;
      $$('.type-btn').forEach((x) => x.classList.toggle('active', x === b));
      $('#categoryField').hidden = entryType === 'income';
      $('#paymentField').hidden = entryType === 'income';
      $('#saveBtn').textContent = ($('#editId').value ? 'Update ' : 'Save ') + (entryType === 'income' ? 'income' : 'expense');
    }));

    $$('#payRow .chip').forEach((c) => c.addEventListener('click', () => {
      selectedPay = c.dataset.pay;
      renderPayChips();
    }));

    $$('.period-btn').forEach((b) => b.addEventListener('click', () => {
      period = b.dataset.period;
      $$('.period-btn').forEach((x) => x.classList.toggle('active', x === b));
      renderStats();
    }));

    $('#entryForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const amount = Number($('#amount').value);
      if (!(amount > 0)) {
        toast('Enter a valid amount');
        $('#amount').focus();
        return;
      }
      const date = $('#date').value || todayISO();
      const note = ($('#note').value || '').trim();
      const editId = $('#editId').value;
      const payload = {
        type: entryType,
        amount: Math.round(amount * 100) / 100,
        categoryId: entryType === 'income' ? 'others' : selectedCategory,
        payment: entryType === 'income' ? '' : selectedPay,
        note,
        date
      };
      if (editId) {
        const idx = state.entries.findIndex((e) => e.id === editId);
        if (idx >= 0) {
          state.entries[idx] = { ...state.entries[idx], ...payload };
        }
        toast('Updated');
      } else {
        state.entries.push({ id: uid(), createdAt: Date.now(), ...payload });
        toast(entryType === 'income' ? 'Income saved' : 'Expense saved');
      }
      saveState();
      resetForm();
      setTab('home');
      refresh();
    });

    $('#cancelEditBtn').addEventListener('click', () => {
      resetForm();
      setTab('home');
    });

    $('#searchInput').addEventListener('input', () => renderList());
    $('#filterCategory').addEventListener('change', () => renderList());
    $('#filterType').addEventListener('change', () => renderList());
    $('#showAllBtn').addEventListener('click', () => {
      showAll = !showAll;
      renderList();
    });

    $('#themeBtn').addEventListener('click', () => {
      const cur = state.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      state.theme = cur === 'dark' ? 'light' : 'dark';
      saveState();
      applyTheme();
    });

    $('#menuBtn').addEventListener('click', () => { $('#drawer').hidden = false; });
    $('#drawerClose').addEventListener('click', () => { $('#drawer').hidden = true; });
    $('#drawerBackdrop').addEventListener('click', () => { $('#drawer').hidden = true; });
    $$('.drawer-item[data-goto]').forEach((b) => b.addEventListener('click', () => {
      $('#drawer').hidden = true;
      setTab(b.dataset.goto);
    }));
    $('#drawerExport').addEventListener('click', () => {
      $('#drawer').hidden = true;
      exportJSON();
    });

    $('#saveBudgetBtn').addEventListener('click', () => {
      state.budget = Math.max(0, Number($('#budgetInput').value) || 0);
      saveState();
      updateBudgetHint();
      renderSummary();
      toast('Budget saved');
    });

    $('#addCatBtn').addEventListener('click', () => {
      const name = ($('#newCatName').value || '').trim();
      const icon = ($('#newCatIcon').value || '').trim() || '📌';
      if (!name) {
        toast('Enter a category name');
        return;
      }
      const id = 'c_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '_' + Math.random().toString(36).slice(2, 5);
      state.categories.push({ id, name, icon });
      saveState();
      $('#newCatName').value = '';
      $('#newCatIcon').value = '';
      renderCatEdit();
      renderFilterCats();
      renderCatGrid();
      toast('Category added');
    });

    $('#exportCsvBtn').addEventListener('click', exportCSV);
    $('#exportJsonBtn').addEventListener('click', exportJSON);
    $('#importJsonBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', () => {
      const f = $('#importFile').files[0];
      if (f) importJSON(f);
      $('#importFile').value = '';
    });
    $('#sampleBtn').addEventListener('click', loadSample);
    $('#clearBtn').addEventListener('click', () => {
      if (!confirm('Clear ALL entries, categories reset to defaults, and budget?')) return;
      state = { entries: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), budget: 0, theme: state.theme };
      saveState();
      selectedCategory = state.categories[0].id;
      renderFilterCats();
      renderCatGrid();
      refresh();
      renderCatEdit();
      updateBudgetHint();
      toast('Data cleared');
    });
  }

  function init() {
    applyTheme();
    $('#date').value = todayISO();
    renderFilterCats();
    renderCatGrid();
    renderPayChips();
    bind();
    refresh();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline-first optional */ });
    }
  }

  init();
})();
