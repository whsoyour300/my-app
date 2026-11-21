// «준비된 질문» 탭: 검증한 질문(presets/questions.json)과 사용자가 저장한 질문을 지금 올라와 있는 데이터로 다시 계산한다.
// 저장한 질문은 이 브라우저(localStorage)에 남기고, JSON 파일로 내려받을 수 있다.
// 어떤 SQL 이든 실행 전과 저장 전에 같은 읽기 전용 검사(SqlGuard)를 거친다.
(function () {
  var Guard = window.SqlGuard, UI = window.UI;
  var KEY = 'savedQuestions.v1';
  var MAX_SHOW_ROWS = 200;
  var $ = function (id) { return document.getElementById(id); };

  var presets = [], defs = {}, saved = [], dbReady = false;
  var results = {};            // id → {columns, rows, ms, at, tables}   (화면 표시와 검산에 쓴다)
  var cards = {};              // id → {button, status, meta, table}

  // ---------- 저장소 ----------
  function validItem(x) {
    return x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.sql === 'string';
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(validItem) : [];
    } catch (e) { return []; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); return true; } catch (e) { return false; }
  }
  saved = load();

  var Saved = {
    list: function () { return saved.slice(); },
    // 이름을 붙여 저장한다. 읽기 전용 검사를 통과한 SQL 만 저장한다. 같은 이름이면 바꾼다.
    add: function (item) {
      var name = String(item.name || '').trim();
      if (!name) return { ok: false, reason: '저장할 이름을 써 주세요.' };
      if (name.length > 60) return { ok: false, reason: '이름은 60자 이하로 써 주세요.' };
      var g = Guard.checkSql(item.sql);
      if (!g.ok) return { ok: false, reason: '저장하지 않았습니다. ' + g.reason };
      var rec = {
        id: 'saved-' + Date.now().toString(36),
        name: name,
        question: String(item.question || '').slice(0, 500),
        sql: g.sql,
        basis: item.basis || null,
        savedAt: UI.stamp()
      };
      var i = saved.findIndex(function (s) { return s.name === name; });
      var replaced = i >= 0;
      if (replaced) { rec.id = saved[i].id; saved[i] = rec; } else saved.push(rec);
      var stored = persist();
      renderSaved();
      return { ok: true, replaced: replaced, stored: stored, item: rec };
    },
    remove: function (id) {
      saved = saved.filter(function (s) { return s.id !== id; });
      delete results[id];
      persist();
      renderSaved();
    },
    exportJson: function () {
      return JSON.stringify({ version: 1, exportedAt: UI.stamp(), questions: saved }, null, 2);
    }
  };

  // ---------- 실행 ----------
  async function execute(item) {
    var g = Guard.checkSql(item.sql);
    if (!g.ok) throw new Error('실행 전에 막았습니다. ' + g.reason);
    var res = await window.Db.query(g.sql);
    var rec = { columns: res.columns, rows: res.rows, ms: res.ms, at: UI.stamp(), tables: Guard.tablesOf(g.sql), sql: g.sql };
    results[item.id] = rec;
    return rec;
  }

  function showResult(card, rec) {
    card.meta.removeAttribute('data-stale');
    card.meta.classList.remove('stale');
    card.meta.textContent = '계산한 시각 ' + rec.at + ' · ' + rec.rows.length + '행 · 읽은 테이블 ' + (rec.tables.join(', ') || '없음') + ' · ' + rec.ms + 'ms';
    card.meta.hidden = false;
    UI.renderTable(card.table, rec.columns, rec.rows, MAX_SHOW_ROWS);
  }

  async function recompute(item) {
    var card = cards[item.id];
    card.button.disabled = true;
    card.status.textContent = '계산 중…';
    card.status.className = 'muted';
    try {
      var rec = await execute(item);
      showResult(card, rec);
      card.status.textContent = '';
    } catch (e) {
      card.status.textContent = (e && e.message ? e.message : String(e));
      card.status.className = 'warn';
    }
    card.button.disabled = !dbReady;
  }

  async function runAll() {
    var all = presets.concat(saved);
    for (var i = 0; i < all.length; i++) await recompute(all[i]);
  }

  // ---------- 화면 ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildCard(item, opts) {
    var art = el('article', 'pcard');
    art.id = 'card-' + item.id;
    var head = el('div', 'phead');
    head.appendChild(el('h3', 'ptitle', opts.title));
    if (opts.tag) head.appendChild(el('span', 'badge', opts.tag));
    art.appendChild(head);
    if (item.question) art.appendChild(el('p', 'pq', item.question));

    if (opts.defs && opts.defs.length) {
      var dl = el('ul', 'pdefs');
      opts.defs.forEach(function (d) {
        var li = el('li');
        var b = el('b', null, '«' + d.name + '» ');
        li.appendChild(b);
        li.appendChild(document.createTextNode(d.definition));
        dl.appendChild(li);
      });
      art.appendChild(dl);
    }

    var row = el('div', 'row');
    var btn = el('button', 'btn primary', '다시 계산');
    btn.type = 'button';
    btn.disabled = !dbReady;
    btn.setAttribute('data-run', item.id);
    btn.addEventListener('click', function () { recompute(item); });
    row.appendChild(btn);
    if (opts.removable) {
      var del = el('button', 'btn', '삭제');
      del.type = 'button';
      del.addEventListener('click', function () { Saved.remove(item.id); });
      row.appendChild(del);
    }
    var status = el('span', 'muted');
    status.setAttribute('role', 'status');
    row.appendChild(status);
    art.appendChild(row);

    var meta = el('p', 'pmeta');
    meta.hidden = true;
    art.appendChild(meta);
    var table = el('div', 'tw');
    art.appendChild(table);

    var det = el('details');
    det.appendChild(el('summary', null, 'SQL 보기'));
    det.appendChild(el('pre', 'sqlpre', item.sql));
    art.appendChild(det);

    if (opts.notes && opts.notes.length) {
      var ul = el('ul', 'pnotes');
      opts.notes.forEach(function (n) { ul.appendChild(el('li', null, n)); });
      art.appendChild(ul);
    }
    cards[item.id] = { button: btn, status: status, meta: meta, table: table };
    if (results[item.id]) showResult(cards[item.id], results[item.id]);
    return art;
  }

  function renderPresets() {
    var box = $('preset-list');
    box.textContent = '';
    presets.forEach(function (p) {
      var d = (p.metrics || []).map(function (n) { return defs[n]; }).filter(Boolean);
      box.appendChild(buildCard(p, { title: p.title, defs: d, notes: p.notes }));
    });
  }

  function renderSaved() {
    var box = $('saved-list');
    box.textContent = '';
    saved.forEach(function (s) { delete cards[s.id]; });
    $('saved-count').textContent = saved.length ? '(' + saved.length + '개)' : '';
    $('saved-download').disabled = !saved.length;
    if (!saved.length) {
      box.appendChild(el('div', 'empty', '아직 저장한 질문이 없습니다. 묻기 탭에서 SQL 을 만든 뒤 이름을 붙여 저장하세요.'));
      return;
    }
    saved.forEach(function (s) {
      box.appendChild(buildCard(s, { title: s.name, tag: '저장 ' + (s.savedAt || ''), removable: true }));
    });
  }

  function download() {
    var blob = new Blob([Saved.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'saved-questions.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function setDb(state) {
    dbReady = state === 'ready';
    Object.keys(cards).forEach(function (id) { cards[id].button.disabled = !dbReady; });
    $('preset-all').disabled = !dbReady;
  }
  window.addEventListener('db-status', function (e) { setDb(e.detail.state); });

  // 내 파일 탭에서 데이터가 바뀌면 이미 계산한 결과에 표시만 붙인다. 자동으로 다시 계산하지 않는다.
  window.addEventListener('data-changed', function (e) {
    var names = (e.detail && e.detail.tables || []).join(', ');
    Object.keys(cards).forEach(function (id) {
      var m = cards[id].meta;
      if (m.hidden || m.getAttribute('data-stale')) return;
      m.setAttribute('data-stale', '1');
      m.classList.add('stale');
      m.textContent += ' · ⚠ 데이터가 바뀌었습니다(' + names + '). 이 결과는 바뀌기 전 데이터 기준입니다. «다시 계산»을 누르세요.';
    });
  });

  $('saved-download').addEventListener('click', download);
  $('preset-all').addEventListener('click', runAll);

  var api = { results: results, saved: Saved, runAll: runAll, ready: false, error: null };
  window.Presets = api;

  Promise.all([
    fetch('presets/questions.json').then(function (r) { if (!r.ok) throw new Error('questions.json ' + r.status); return r.json(); }),
    fetch('schema.json').then(function (r) { return r.json(); })
  ]).then(function (both) {
    (both[1].metrics || []).forEach(function (m) { defs[m.name] = m; });
    presets = (both[0].questions || []).map(function (q) {
      return Object.assign({}, q, { sql: Array.isArray(q.sql) ? q.sql.join('\n') : String(q.sql) });
    });
    renderPresets();
    renderSaved();
    if (window.Db) setDb(window.Db.state);
    api.items = presets;
    api.ready = true;
  }).catch(function (e) {
    api.error = e.message;
    $('preset-list').appendChild(el('div', 'empty', '준비된 질문을 읽지 못했습니다: ' + e.message));
  });
})();
