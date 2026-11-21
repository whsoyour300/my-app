// «테이블» 탭: 지금 이 브라우저의 DuckDB 에 올라와 있는 테이블의 이름 · 컬럼 이름 · 타입 · 행 수.
// 기본 테이블은 schema.json 의 컬럼 뜻을 함께 보여 주고, 올린 파일의 테이블은 뜻이 없다.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var base = null;              // 소문자 이름 → schema.json 의 테이블 설명
  var order = [];               // 기본 테이블 순서
  var busy = false, again = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      if (!base) {
        var s = await fetch('schema.json').then(function (r) { return r.json(); });
        base = {};
        (s.tables || []).forEach(function (t) { base[t.name.toLowerCase()] = t; order.push(t.name.toLowerCase()); });
      }
      var cols = await window.Db.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='main' ORDER BY table_name, ordinal_position");
      var tables = {};
      cols.rows.forEach(function (r) {
        var k = String(r[0]).toLowerCase();
        (tables[k] = tables[k] || { name: String(r[0]), columns: [] }).columns.push({ name: String(r[1]), type: String(r[2]) });
      });
      var keys = Object.keys(tables);
      keys.sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a < b ? -1 : 1;
      });
      for (var i = 0; i < keys.length; i++) tables[keys[i]].rows = await window.Db.count(tables[keys[i]].name);
      render(keys.map(function (k) { return tables[k]; }));
    } catch (e) {
      $('tables-list').textContent = '';
      $('tables-list').appendChild(el('div', 'empty', '테이블 목록을 읽지 못했습니다: ' + (e && e.message ? e.message : e)));
    }
    busy = false;
    if (again) { again = false; refresh(); }
  }

  function render(list) {
    var box = $('tables-list');
    box.textContent = '';
    $('tables-count').textContent = '(' + list.length + '개)';
    list.forEach(function (t) {
      var k = t.name.toLowerCase();
      var up = window.Files && window.Files.isUploaded(t.name);
      var meta = up ? null : base[k];
      var art = el('article', 'pcard');
      art.id = 'tbl-' + k;
      var head = el('div', 'phead');
      head.appendChild(el('h3', 'ptitle mono', t.name));
      if (up) head.appendChild(el('span', 'badge warn', base[k] ? '올린 파일로 바꿈' : '올린 파일'));
      else head.appendChild(el('span', 'badge ok', '기본'));
      head.appendChild(el('span', 'muted', t.rows.toLocaleString('ko-KR') + '행 · 컬럼 ' + t.columns.length + '개'));
      art.appendChild(head);
      if (meta && meta.grain) art.appendChild(el('p', 'pq', '한 행 = ' + meta.grain));
      if (up) {
        var f = window.Files.uploaded().filter(function (u) { return u.name.toLowerCase() === k; })[0];
        art.appendChild(el('p', 'pq', '파일 ' + (f ? f.file : '') + ' (' + (f ? f.at : '') + ' 에 올림). 컬럼 뜻은 없습니다.'));
      }
      var mean = {};
      if (meta) (meta.columns || []).forEach(function (c) { mean[c.name.toLowerCase()] = c.meaning; });
      var tw = el('div', 'tw');
      var table = document.createElement('table');
      var h = document.createElement('tr');
      ['컬럼', '타입', '뜻'].forEach(function (x) { h.appendChild(el('th', null, x)); });
      table.appendChild(h);
      t.columns.forEach(function (c) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', 'mono', c.name));
        tr.appendChild(el('td', 'muted', c.type));
        var m = mean[c.name.toLowerCase()];
        var td = el('td', null, m || '');
        td.style.whiteSpace = 'normal';
        tr.appendChild(td);
        table.appendChild(tr);
      });
      tw.appendChild(table);
      art.appendChild(tw);
      box.appendChild(art);
    });
  }

  window.addEventListener('db-status', function (e) { if (e.detail.state === 'ready') refresh(); });
  window.addEventListener('data-changed', refresh);
  if (window.Db && window.Db.state === 'ready') refresh();
  window.Tables = { refresh: refresh };
})();
