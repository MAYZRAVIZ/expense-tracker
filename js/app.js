(function () {
  'use strict';

  var STORAGE_KEY = 'ph-expense-tracker-v1';
  var TZ = 'Asia/Manila';

  var DEFAULT_CATEGORIES = [
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

  var CHART_COLORS = ['#0f766e', '#14b8a6', '#0284c7', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#059669', '#64748b', '#e11d48'];

  var state = loadState();
  var entryType = 'expense';
  var selectedCategory = state.categories[0] ? state.categories[0].id : 'others';
  var selectedPay = 'Cash';
  var period = 'day';
  var showAll = false;
  var editingCatId = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function manilaParts(d) {
    try {
      var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      var parts = fmt.formatToParts(d);
      var map = {};
      for (var i = 0; i < parts.length; i++) {
        map[parts[i].type] = parts[i].value;
      }
      if (map.year && map.month && map.day) {
        return { y: map.year, m: map.month, day: map.day, iso: map.year + '-' + map.month + '-' + map.day };
      }
      // Fallback if formatToParts unavailable/odd
      var s = fmt.format(d);
      var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) return { y: m[1], m: m[2], day: m[3], iso: m[1] + '-' + m[2] + '-' + m[3] };
    } catch (e) { /* fall through */ }
    // Last resort: local date parts (may be wrong if device TZ != Manila)
    var dt = d instanceof Date ? d : new Date();
    var y = dt.getFullYear();
    var mo = String(dt.getMonth() + 1);
    if (mo.length < 2) mo = '0' + mo;
    var da = String(dt.getDate());
    if (da.length < 2) da = '0' + da;
    return { y: String(y), m: mo, day: da, iso: y + '-' + mo + '-' + da };
  }

  function todayISO() {
    return manilaParts(new Date()).iso;
  }

  /** Parse amount typed on PH keyboards (commas, spaces, peso sign). */
  function parseAmount(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    s = s.replace(/[₱\s]/g, '');
    // 1,234.56 or 1.234,56 — prefer last separator as decimal if both present
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.indexOf(',') >= 0) {
      // If exactly one comma and 1-2 digits after → decimal; else thousands
      var parts = s.split(',');
      if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
        s = parts[0].replace(/\./g, '') + '.' + parts[1];
      } else {
        s = s.replace(/,/g, '');
      }
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function formatMoney(n) {
    var v = Number(n) || 0;
    try {
      return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
      return '₱' + v.toFixed(2);
    }
  }

  function formatDateLabel(iso) {
    try {
      var bits = iso.split('-');
      var y = Number(bits[0]), m = Number(bits[1]), d = Number(bits[2]);
      // Use noon UTC so Asia/Manila (UTC+8) stays on the same calendar day
      var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      return dt.toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function uid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'e_' + crypto.randomUUID();
      }
    } catch (e) { /* ignore */ }
    return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function cloneCategories(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push({ id: list[i].id, name: list[i].name, icon: list[i].icon });
    }
    return out;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { entries: [], categories: cloneCategories(DEFAULT_CATEGORIES), budget: 0, theme: '' };
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.categories) || !parsed.categories.length) {
        parsed.categories = cloneCategories(DEFAULT_CATEGORIES);
      }
      if (!Array.isArray(parsed.entries)) parsed.entries = [];
      if (typeof parsed.budget !== 'number' || !isFinite(parsed.budget)) parsed.budget = Number(parsed.budget) || 0;
      if (typeof parsed.theme !== 'string') parsed.theme = '';
      return parsed;
    } catch (e) {
      return { entries: [], categories: cloneCategories(DEFAULT_CATEGORIES), budget: 0, theme: '' };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save (storage full?)');
    }
  }

  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function catById(id) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return { id: 'others', name: 'Others', icon: '📦' };
  }

  function prefersDark() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      return false;
    }
  }

  function applyTheme() {
    if (state.theme === 'light' || state.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', state.theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function setTab(name) {
    $$('.tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      if (on) t.classList.add('active'); else t.classList.remove('active');
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel').forEach(function (p) {
      var on = p.id === 'tab-' + name;
      if (on) p.classList.add('active'); else p.classList.remove('active');
      p.hidden = !on;
    });
    if (name === 'add') {
      if (!$('#editId').value) resetForm();
    }
    if (name === 'stats') renderStats();
    if (name === 'more') {
      renderCatEdit();
      $('#budgetInput').value = state.budget ? String(state.budget) : '';
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
    $$('.type-btn').forEach(function (b) {
      if (b.getAttribute('data-type') === 'expense') b.classList.add('active');
      else b.classList.remove('active');
    });
    $('#saveBtn').textContent = 'Save expense';
    $('#cancelEditBtn').hidden = true;
    $('#categoryField').hidden = false;
    $('#paymentField').hidden = false;
    renderCatGrid();
    renderPayChips();
  }

  function renderCatGrid() {
    var grid = $('#catGrid');
    grid.innerHTML = '';
    state.categories.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn' + (c.id === selectedCategory ? ' active' : '');
      btn.innerHTML = '<span class="ico">' + c.icon + '</span><span>' + escapeHtml(c.name) + '</span>';
      btn.addEventListener('click', function () {
        selectedCategory = c.id;
        renderCatGrid();
      });
      grid.appendChild(btn);
    });
  }

  function renderPayChips() {
    $$('#payRow .chip').forEach(function (c) {
      if (c.getAttribute('data-pay') === selectedPay) c.classList.add('active');
      else c.classList.remove('active');
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function filteredEntries() {
    var q = ($('#searchInput').value || '').trim().toLowerCase();
    var cat = $('#filterCategory').value;
    var typ = $('#filterType').value;
    var today = todayISO();
    var list = state.entries.slice();
    if (!showAll) {
      list = list.filter(function (e) { return e.date === today; });
    }
    if (cat) list = list.filter(function (e) { return e.categoryId === cat; });
    if (typ) list = list.filter(function (e) { return e.type === typ; });
    if (q) {
      list = list.filter(function (e) {
        var catName = catById(e.categoryId).name.toLowerCase();
        return (e.note || '').toLowerCase().indexOf(q) !== -1 ||
          catName.indexOf(q) !== -1 ||
          (e.payment || '').toLowerCase().indexOf(q) !== -1 ||
          String(e.amount).indexOf(q) !== -1;
      });
    }
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }

  function sumFor(dateISO, type) {
    var s = 0;
    for (var i = 0; i < state.entries.length; i++) {
      var e = state.entries[i];
      if (e.date === dateISO && e.type === type) s += Number(e.amount) || 0;
    }
    return s;
  }

  function monthKey(iso) { return iso.slice(0, 7); }

  function monthSpend(ym) {
    var s = 0;
    for (var i = 0; i < state.entries.length; i++) {
      var e = state.entries[i];
      if (e.type === 'expense' && monthKey(e.date) === ym) s += Number(e.amount) || 0;
    }
    return s;
  }

  function renderSummary() {
    var today = todayISO();
    $('#todayLabel').textContent = formatDateLabel(today);
    $('#todaySpent').textContent = formatMoney(sumFor(today, 'expense'));
    $('#todayIncome').textContent = formatMoney(sumFor(today, 'income'));

    var ym = today.slice(0, 7);
    var spent = monthSpend(ym);
    var budget = Number(state.budget) || 0;
    var leftEl = $('#budgetLeft');
    var fill = $('#budgetFill');
    if (budget > 0) {
      var left = budget - spent;
      leftEl.textContent = formatMoney(left);
      var pct = Math.min(100, (spent / budget) * 100);
      fill.style.width = pct + '%';
      fill.className = 'budget-fill' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '');
      if (left < 0) leftEl.style.color = 'var(--danger)';
      else if (pct >= 80) leftEl.style.color = 'var(--warn)';
      else leftEl.style.color = '';
    } else {
      leftEl.textContent = 'Not set';
      leftEl.style.color = 'var(--muted)';
      fill.style.width = '0%';
      fill.className = 'budget-fill';
    }
  }

  function renderFilterCats() {
    var sel = $('#filterCategory');
    var cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>';
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.icon + ' ' + c.name;
      sel.appendChild(opt);
    });
    sel.value = cur;
  }

  function bindTap(el, handler) {
    if (!el) return;
    var locked = false;
    var recentTouch = false;
    function run(ev) {
      if (locked) return;
      locked = true;
      try { handler(ev); } catch (e) { console.error(e); }
      setTimeout(function () { locked = false; }, 500);
    }
    el.addEventListener('touchend', function (ev) {
      recentTouch = true;
      setTimeout(function () { recentTouch = false; }, 700);
      try { ev.preventDefault(); } catch (e) {}
      run(ev);
    }, { passive: false });
    el.addEventListener('click', function (ev) {
      if (recentTouch) return; // swallow iOS ghost click
      run(ev);
    });
  }

  function renderList() {
    var list = filteredEntries();
    var ul = $('#entryList');
    var empty = $('#emptyState');
    ul.innerHTML = '';
    empty.hidden = list.length > 0;
    $('#showAllBtn').textContent = showAll ? 'Show today' : 'Show all';
    $('.list-head h2').textContent = showAll ? 'All entries' : 'Today';
    var today = todayISO();

    list.forEach(function (e) {
      var cat = catById(e.categoryId);
      var li = document.createElement('li');
      li.className = 'entry';
      li.setAttribute('data-id', e.id);
      var sign = e.type === 'income' ? '+' : '−';
      var metaParts = [];
      if (showAll || e.date !== today) metaParts.push(e.date);
      if (e.type === 'expense') metaParts.push(e.payment || 'Cash');
      if (e.note) metaParts.push(e.note);

      var actions = document.createElement('div');
      actions.className = 'entry-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit';
      editBtn.setAttribute('aria-label', 'Edit entry');
      editBtn.textContent = '✎ Edit';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'del';
      delBtn.setAttribute('aria-label', 'Delete entry');
      delBtn.textContent = 'Delete';
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      li.innerHTML =
        '<div class="entry-icon">' + cat.icon + '</div>' +
        '<div class="entry-main">' +
          '<div class="entry-title">' + escapeHtml(e.type === 'income' ? 'Income' : cat.name) + '</div>' +
          '<div class="entry-meta">' + escapeHtml(metaParts.join(' · ') || '—') + '</div>' +
        '</div>' +
        '<div class="entry-amt ' + e.type + '">' + sign + formatMoney(e.amount) + '</div>';
      li.appendChild(actions);

      bindTap(editBtn, function () { startEdit(e); });
      bindTap(delBtn, function () {
        if (window.confirm('Delete this entry?')) {
          state.entries = state.entries.filter(function (x) { return x.id !== e.id; });
          saveState();
          refresh();
          toast('Deleted');
        }
      });
      // Tapping the row body also opens edit (discoverable)
      bindTap(li.querySelector('.entry-main'), function () { startEdit(e); });
      bindTap(li.querySelector('.entry-icon'), function () { startEdit(e); });
      bindTap(li.querySelector('.entry-amt'), function () { startEdit(e); });

      ul.appendChild(li);
    });
  }

  function startEdit(e) {
    setTab('add');
    $('#editId').value = e.id;
    entryType = e.type;
    $$('.type-btn').forEach(function (b) {
      if (b.getAttribute('data-type') === e.type) b.classList.add('active');
      else b.classList.remove('active');
    });
    $('#amount').value = String(e.amount);
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
    try { $('#amount').focus(); } catch (err) { /* ignore */ }
  }

  function addDaysISO(iso, delta) {
    var bits = iso.split('-');
    var y = Number(bits[0]), m = Number(bits[1]), d = Number(bits[2]);
    var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return manilaParts(dt).iso;
  }

  function weekdayMon0(iso) {
    var bits = iso.split('-');
    var y = Number(bits[0]), m = Number(bits[1]), d = Number(bits[2]);
    var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    var wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(dt);
    var map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return map[wd] != null ? map[wd] : 0;
  }

  function periodRange() {
    var today = todayISO();
    if (period === 'day') return { start: today, end: today, days: [today] };
    if (period === 'week') {
      var offset = weekdayMon0(today);
      var start = addDaysISO(today, -offset);
      var days = [];
      for (var i = 0; i < 7; i++) days.push(addDaysISO(start, i));
      return { start: days[0], end: days[6], days: days };
    }
    var ym = today.slice(0, 7);
    var y = Number(ym.slice(0, 4));
    var m = Number(ym.slice(5, 7));
    var last = new Date(Date.UTC(y, m, 0, 12, 0, 0)); // day 0 of next month
    var end = manilaParts(last).iso;
    var dim = Number(end.slice(8, 10));
    var daysM = [];
    for (var j = 1; j <= dim; j++) {
      var dd = String(j);
      if (dd.length < 2) dd = '0' + dd;
      daysM.push(ym + '-' + dd);
    }
    return { start: ym + '-01', end: end, days: daysM };
  }

  function entriesInRange(start, end) {
    return state.entries.filter(function (e) { return e.date >= start && e.date <= end; });
  }

  function renderStats() {
    var range = periodRange();
    var list = entriesInRange(range.start, range.end);
    var spent = 0, income = 0;
    list.forEach(function (e) {
      if (e.type === 'expense') spent += Number(e.amount) || 0;
      else income += Number(e.amount) || 0;
    });
    $('#periodSpent').textContent = formatMoney(spent);
    $('#periodIncome').textContent = formatMoney(income);
    $('#periodNet').textContent = formatMoney(income - spent);

    var byCat = {};
    list.forEach(function (e) {
      if (e.type !== 'expense') return;
      byCat[e.categoryId] = (byCat[e.categoryId] || 0) + (Number(e.amount) || 0);
    });
    var catEntries = Object.keys(byCat).map(function (id) {
      return { id: id, amount: byCat[id], cat: catById(id) };
    }).sort(function (a, b) { return b.amount - a.amount; });
    renderDonut($('#catChart'), catEntries, spent);

    var days = range.days || [range.start];
    var points;
    if (period === 'month' && days.length > 14) {
      points = [];
      for (var i = 0; i < days.length; i += 7) {
        var slice = days.slice(i, i + 7);
        var amt = 0;
        slice.forEach(function (d) {
          list.forEach(function (e) {
            if (e.date === d && e.type === 'expense') amt += Number(e.amount) || 0;
          });
        });
        points.push({ label: slice[0].slice(8), amount: amt });
      }
    } else {
      points = days.map(function (d) {
        var amt = 0;
        list.forEach(function (e) {
          if (e.date === d && e.type === 'expense') amt += Number(e.amount) || 0;
        });
        return { label: d.slice(8), amount: amt };
      });
    }
    renderBars($('#trendChart'), points);

    var ul = $('#breakdownList');
    ul.innerHTML = '';
    if (!catEntries.length) {
      ul.innerHTML = '<li><span>No expenses in this period</span><strong>₱0.00</strong></li>';
      return;
    }
    catEntries.forEach(function (row) {
      var li = document.createElement('li');
      var pct = spent ? ((row.amount / spent) * 100).toFixed(0) : '0';
      li.innerHTML = '<span>' + row.cat.icon + ' ' + escapeHtml(row.cat.name) + ' · ' + pct + '%</span><strong>' + formatMoney(row.amount) + '</strong>';
      ul.appendChild(li);
    });
  }

  function renderDonut(box, rows, total) {
    var w = 280, h = 180, cx = 90, cy = 90, r = 62, stroke = 22;
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
    if (!rows.length || total <= 0) {
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#cbd5e1" stroke-width="' + stroke + '"/>';
      svg += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="12" fill="currentColor">No data</text></svg>';
      box.innerHTML = svg;
      return;
    }
    var circ = 2 * Math.PI * r;
    var offset = 0;
    rows.forEach(function (row, i) {
      var len = (row.amount / total) * circ;
      var color = CHART_COLORS[i % CHART_COLORS.length];
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      offset += len;
    });
    svg += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="11" fill="currentColor">Spent</text>';
    svg += '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">' + formatMoney(total) + '</text>';
    var ly = 24;
    rows.slice(0, 6).forEach(function (row, i) {
      var color = CHART_COLORS[i % CHART_COLORS.length];
      svg += '<rect x="170" y="' + ly + '" width="10" height="10" rx="2" fill="' + color + '"/>';
      svg += '<text x="186" y="' + (ly + 9) + '" font-size="11" fill="currentColor">' + escapeHtml(row.cat.name) + '</text>';
      ly += 18;
    });
    svg += '</svg>';
    box.innerHTML = svg;
  }

  function renderBars(box, points) {
    var w = 320, h = 160, pad = 28, gap = 4;
    var max = 1;
    points.forEach(function (p) { if (p.amount > max) max = p.amount; });
    var barW = Math.max(6, (w - pad * 2 - gap * Math.max(points.length - 1, 0)) / Math.max(points.length, 1));
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
    svg += '<line x1="' + pad + '" y1="' + (h - 24) + '" x2="' + (w - 8) + '" y2="' + (h - 24) + '" stroke="#cbd5e1"/>';
    points.forEach(function (p, i) {
      var bh = ((h - 40) * p.amount) / max;
      var x = pad + i * (barW + gap);
      var y = h - 24 - bh;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(1, bh) + '" rx="3" fill="#14b8a6"/>';
      if (points.length <= 10 || i % 2 === 0) {
        svg += '<text x="' + (x + barW / 2) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="9" fill="currentColor">' + escapeHtml(p.label) + '</text>';
      }
    });
    svg += '</svg>';
    box.innerHTML = svg;
  }

  var ICON_PRESETS = ['🍜','🚌','💡','📱','🛒','🛍️','💊','💼','📦','☕','🏠','🎓','🎮','✈️','🐾','🎁','🧾','⛽','🎬','🧃'];

  function openCatsScreen() {
    editingCatId = null;
    $('#catEditor').hidden = true;
    $('#catAddBlock').hidden = false;
    renderCatManage();
    $('#catsScreen').hidden = false;
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
  }

  function closeCatsScreen() {
    $('#catsScreen').hidden = true;
    editingCatId = null;
    try { document.body.style.overflow = ''; } catch (e) {}
    renderCatGrid();
    renderFilterCats();
  }

  function fillIconPick(container, inputEl, current) {
    container.innerHTML = '';
    ICON_PRESETS.forEach(function (ico) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = ico;
      if (ico === current) b.className = 'active';
      bindTap(b, function () {
        inputEl.value = ico;
        fillIconPick(container, inputEl, ico);
      });
      container.appendChild(b);
    });
  }

  function renderCatManage() {
    var ul = $('#catManageList');
    if (!ul) return;
    ul.innerHTML = '';
    state.categories.forEach(function (c) {
      var li = document.createElement('li');
      var icoBtn = document.createElement('button');
      icoBtn.type = 'button';
      icoBtn.className = 'cat-ico';
      icoBtn.textContent = c.icon;
      icoBtn.setAttribute('aria-label', 'Edit ' + c.name);
      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'cat-name';
      nameBtn.textContent = c.name;
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'cat-edit-btn';
      editBtn.textContent = '✎ Edit';
      function openEditor() { openCatEditor(c.id); }
      bindTap(icoBtn, openEditor);
      bindTap(nameBtn, openEditor);
      bindTap(editBtn, openEditor);
      li.appendChild(icoBtn);
      li.appendChild(nameBtn);
      li.appendChild(editBtn);
      ul.appendChild(li);
    });
  }

  function openCatEditor(id) {
    var c = catById(id);
    editingCatId = c.id;
    $('#catEditor').hidden = false;
    $('#catAddBlock').hidden = true;
    $('#catEditorTitle').textContent = 'Edit “' + c.name + '”';
    $('#catEditName').value = c.name;
    $('#catEditIcon').value = c.icon;
    fillIconPick($('#iconPick'), $('#catEditIcon'), c.icon);
    try { $('#catEditName').focus(); } catch (e) {}
  }

  function renderCatEdit() {
    // Back-compat alias used by setTab('more')
    renderCatManage();
  }

  function updateBudgetHint() {
    var ym = todayISO().slice(0, 7);
    var spent = monthSpend(ym);
    var budget = Number(state.budget) || 0;
    if (!budget) {
      $('#budgetHint').textContent = 'Set a monthly budget to see remaining amount and warnings on Home.';
      return;
    }
    var left = budget - spent;
    $('#budgetHint').textContent = 'This month spent ' + formatMoney(spent) + ' of ' + formatMoney(budget) +
      (left >= 0 ? (' · ' + formatMoney(left) + ' left') : (' · over by ' + formatMoney(-left)));
  }

  function refresh() {
    renderSummary();
    renderList();
    if ($('#tab-stats').classList.contains('active')) renderStats();
  }

  function downloadBlob(blob, name) {
    // Prefer Web Share Level 2 on iOS (download attr often ignored in Safari/PWA)
    try {
      if (navigator.share && navigator.canShare) {
        var file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).then(function () {
            toast('Shared ' + name);
          }).catch(function () {
            fallbackDownload(blob, name);
          });
          return;
        }
      }
    } catch (e) { /* fall through */ }
    fallbackDownload(blob, name);
  }

  function fallbackDownload(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      URL.revokeObjectURL(url);
    }, 1500);
    toast('Exported ' + name);
  }

  function exportCSV() {
    var headers = ['id', 'type', 'date', 'amount', 'category', 'payment', 'note'];
    var rows = [headers.join(',')];
    var sorted = state.entries.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    sorted.forEach(function (e) {
      var cat = catById(e.categoryId).name;
      var cells = [e.id, e.type, e.date, e.amount, cat, e.payment || '', e.note || ''].map(function (v) {
        var s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? '"' + s + '"' : s;
      });
      rows.push(cells.join(','));
    });
    // BOM helps Excel on Windows; harmless elsewhere
    var bom = '\uFEFF';
    downloadBlob(new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8' }), 'expenses-' + todayISO() + '.csv');
  }

  function exportJSON() {
    var payload = {
      app: 'ph-expense-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      timezone: TZ,
      data: state
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'expenses-backup-' + todayISO() + '.json');
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var data = parsed.data || parsed;
        if (!data || !Array.isArray(data.entries) || !Array.isArray(data.categories)) {
          throw new Error('Invalid backup');
        }
        if (!window.confirm('Replace all current data with this backup?')) return;
        state = {
          entries: data.entries,
          categories: data.categories,
          budget: typeof data.budget === 'number' ? data.budget : 0,
          theme: typeof data.theme === 'string' ? data.theme : state.theme
        };
        saveState();
        applyTheme();
        selectedCategory = state.categories[0] ? state.categories[0].id : 'others';
        renderFilterCats();
        renderCatGrid();
        refresh();
        toast('Backup imported');
      } catch (err) {
        toast('Import failed');
      }
    };
    reader.onerror = function () { toast('Import failed'); };
    reader.readAsText(file);
  }

  function loadSample() {
    if (state.entries.length && !window.confirm('Add sample entries on top of existing data?')) return;
    var today = todayISO();
    var yest = addDaysISO(today, -1);
    var samples = [
      { type: 'expense', amount: 120, categoryId: 'food', payment: 'GCash', note: 'Lunch — carinderia', date: today },
      { type: 'expense', amount: 50, categoryId: 'transport', payment: 'Cash', note: 'Jeepney', date: today },
      { type: 'expense', amount: 299, categoryId: 'load', payment: 'GCash', note: 'Globe promo', date: today },
      { type: 'income', amount: 500, categoryId: 'others', payment: '', note: 'Side gig', date: today },
      { type: 'expense', amount: 850, categoryId: 'groceries', payment: 'Maya', note: 'SM groceries', date: yest },
      { type: 'expense', amount: 1500, categoryId: 'bills', payment: 'Bank', note: 'Meralco', date: yest }
    ];
    samples.forEach(function (s) {
      state.entries.push({
        id: uid(),
        createdAt: Date.now(),
        type: s.type,
        amount: s.amount,
        categoryId: s.categoryId,
        payment: s.payment,
        note: s.note,
        date: s.date
      });
    });
    if (!state.budget) state.budget = 15000;
    saveState();
    refresh();
    toast('Sample data loaded');
  }

  function bind() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); });
    });

    $$('.type-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        entryType = b.getAttribute('data-type');
        $$('.type-btn').forEach(function (x) {
          if (x === b) x.classList.add('active'); else x.classList.remove('active');
        });
        $('#categoryField').hidden = entryType === 'income';
        $('#paymentField').hidden = entryType === 'income';
        $('#saveBtn').textContent = ($('#editId').value ? 'Update ' : 'Save ') + (entryType === 'income' ? 'income' : 'expense');
      });
    });

    $$('#payRow .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        selectedPay = c.getAttribute('data-pay');
        renderPayChips();
      });
    });

    $$('.period-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        period = b.getAttribute('data-period');
        $$('.period-btn').forEach(function (x) {
          if (x === b) x.classList.add('active'); else x.classList.remove('active');
        });
        renderStats();
      });
    });

    $('#entryForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var amount = parseAmount($('#amount').value);
      if (!(amount > 0)) {
        toast('Enter a valid amount');
        try { $('#amount').focus(); } catch (e) {}
        return;
      }
      var date = $('#date').value || todayISO();
      // Guard against empty/invalid date from Safari date picker quirks
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayISO();
      var note = ($('#note').value || '').trim();
      var editId = $('#editId').value;
      var payload = {
        type: entryType,
        amount: Math.round(amount * 100) / 100,
        categoryId: entryType === 'income' ? 'others' : selectedCategory,
        payment: entryType === 'income' ? '' : selectedPay,
        note: note,
        date: date
      };
      if (editId) {
        var idx = -1;
        for (var i = 0; i < state.entries.length; i++) {
          if (state.entries[i].id === editId) { idx = i; break; }
        }
        if (idx >= 0) {
          var prev = state.entries[idx];
          state.entries[idx] = {
            id: prev.id,
            createdAt: prev.createdAt || Date.now(),
            type: payload.type,
            amount: payload.amount,
            categoryId: payload.categoryId,
            payment: payload.payment,
            note: payload.note,
            date: payload.date
          };
        }
        toast('Updated');
      } else {
        state.entries.push({
          id: uid(),
          createdAt: Date.now(),
          type: payload.type,
          amount: payload.amount,
          categoryId: payload.categoryId,
          payment: payload.payment,
          note: payload.note,
          date: payload.date
        });
        toast(entryType === 'income' ? 'Income saved' : 'Expense saved');
      }
      saveState();
      resetForm();
      setTab('home');
      refresh();
    });

    $('#cancelEditBtn').addEventListener('click', function () {
      resetForm();
      setTab('home');
    });

    $('#searchInput').addEventListener('input', function () { renderList(); });
    $('#filterCategory').addEventListener('change', function () { renderList(); });
    $('#filterType').addEventListener('change', function () { renderList(); });
    $('#showAllBtn').addEventListener('click', function () {
      showAll = !showAll;
      renderList();
    });

    $('#themeBtn').addEventListener('click', function () {
      var cur = state.theme || (prefersDark() ? 'dark' : 'light');
      state.theme = cur === 'dark' ? 'light' : 'dark';
      saveState();
      applyTheme();
    });

    $('#menuBtn').addEventListener('click', function () { $('#drawer').hidden = false; });
    $('#drawerClose').addEventListener('click', function () { $('#drawer').hidden = true; });
    $('#drawerBackdrop').addEventListener('click', function () { $('#drawer').hidden = true; });
    $$('.drawer-item[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#drawer').hidden = true;
        setTab(b.getAttribute('data-goto'));
      });
    });
    $('#drawerExport').addEventListener('click', function () {
      $('#drawer').hidden = true;
      exportJSON();
    });

    $('#saveBudgetBtn').addEventListener('click', function () {
      var n = parseAmount($('#budgetInput').value);
      if (!isFinite(n) || n < 0) n = 0;
      state.budget = Math.round(n * 100) / 100;
      saveState();
      updateBudgetHint();
      renderSummary();
      toast('Budget saved');
    });

    function addCategoryFromForm() {
      var name = ($('#newCatName').value || '').trim();
      var icon = ($('#newCatIcon').value || '').trim() || '📌';
      if (!name) {
        toast('Enter a category name');
        return;
      }
      var id = 'c_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!id || id === 'c_') id = 'c_custom';
      id = id + '_' + Math.random().toString(36).slice(2, 5);
      state.categories.push({ id: id, name: name, icon: icon });
      saveState();
      $('#newCatName').value = '';
      $('#newCatIcon').value = icon;
      fillIconPick($('#iconPickNew'), $('#newCatIcon'), icon);
      renderCatManage();
      renderFilterCats();
      renderCatGrid();
      toast('Category added');
    }
    bindTap($('#addCatBtn'), addCategoryFromForm);

    bindTap($('#openCatsBtn'), openCatsScreen);
    bindTap($('#manageCatsFromAdd'), openCatsScreen);
    bindTap($('#catsBackBtn'), closeCatsScreen);
    if ($('#drawerCats')) {
      bindTap($('#drawerCats'), function () {
        $('#drawer').hidden = true;
        openCatsScreen();
      });
    }

    bindTap($('#catSaveBtn'), function () {
      if (!editingCatId) return;
      var c = null;
      for (var i = 0; i < state.categories.length; i++) {
        if (state.categories[i].id === editingCatId) { c = state.categories[i]; break; }
      }
      if (!c) return;
      var name = ($('#catEditName').value || '').trim();
      var icon = ($('#catEditIcon').value || '').trim() || c.icon;
      if (!name) { toast('Enter a name'); return; }
      c.name = name;
      c.icon = icon;
      saveState();
      editingCatId = null;
      $('#catEditor').hidden = true;
      $('#catAddBlock').hidden = false;
      renderCatManage();
      renderFilterCats();
      renderCatGrid();
      toast('Category saved');
    });

    bindTap($('#catDeleteBtn'), function () {
      if (!editingCatId) return;
      if (state.categories.length <= 1) {
        toast('Keep at least one category');
        return;
      }
      var c = catById(editingCatId);
      if (!window.confirm('Delete category “' + c.name + '”? Existing entries keep their amounts.')) return;
      state.categories = state.categories.filter(function (x) { return x.id !== editingCatId; });
      if (selectedCategory === editingCatId) selectedCategory = state.categories[0].id;
      editingCatId = null;
      saveState();
      $('#catEditor').hidden = true;
      $('#catAddBlock').hidden = false;
      renderCatManage();
      renderFilterCats();
      renderCatGrid();
      toast('Category deleted');
    });

    bindTap($('#catCancelBtn'), function () {
      editingCatId = null;
      $('#catEditor').hidden = true;
      $('#catAddBlock').hidden = false;
    });

    $('#exportCsvBtn').addEventListener('click', exportCSV);
    $('#exportJsonBtn').addEventListener('click', exportJSON);
    $('#importJsonBtn').addEventListener('click', function () {
      var input = $('#importFile');
      // Reset so choosing the same file again still fires change
      input.value = '';
      input.click();
    });
    $('#importFile').addEventListener('change', function () {
      var f = $('#importFile').files && $('#importFile').files[0];
      if (f) importJSON(f);
    });
    $('#sampleBtn').addEventListener('click', loadSample);
    $('#clearBtn').addEventListener('click', function () {
      if (!window.confirm('Clear ALL entries, categories reset to defaults, and budget?')) return;
      state = { entries: [], categories: cloneCategories(DEFAULT_CATEGORIES), budget: 0, theme: state.theme };
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

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      // Update on reload: if a new worker is waiting, activate it
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // New version ready — activate immediately
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      // Periodic update check when app becomes visible
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          try { reg.update(); } catch (e) {}
        }
      });
    }).catch(function () { /* optional */ });

    var hadController = !!navigator.serviceWorker.controller;
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      if (!hadController) { hadController = true; return; }
      refreshing = true;
      // Soft reload once so home-screen / Safari users pick up the new cache
      window.location.reload();
    });
  }

  function init() {
    applyTheme();
    $('#date').value = todayISO();
    renderFilterCats();
    renderCatGrid();
    renderPayChips();
    bind();
    if ($('#iconPickNew') && $('#newCatIcon')) {
      $('#newCatIcon').value = '📌';
      fillIconPick($('#iconPickNew'), $('#newCatIcon'), '📌');
    }
    refresh();
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
