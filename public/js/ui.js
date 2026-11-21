// 화면 공용 도구. AI 나 파일에서 온 글자는 textContent 로만 넣는다.
(function (root) {
  function renderTable(box, columns, rows, limit) {
    box.textContent = '';
    var table = document.createElement('table'), head = document.createElement('tr');
    columns.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; head.appendChild(th); });
    table.appendChild(head);
    rows.slice(0, limit).forEach(function (r) {
      var tr = document.createElement('tr');
      r.forEach(function (v) {
        var td = document.createElement('td');
        td.textContent = v === null || v === undefined ? '' : String(v);
        if (typeof v === 'number') td.className = 'num';
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    box.appendChild(table);
    if (rows.length > limit) {
      var p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = '앞 ' + limit + '행만 보여 줍니다 (전체 ' + rows.length + '행).';
      box.appendChild(p);
    }
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  // 2026-11-21 14:03:07 (이 브라우저의 시간대)
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  root.UI = { renderTable: renderTable, stamp: stamp };
})(typeof window !== 'undefined' ? window : globalThis);
