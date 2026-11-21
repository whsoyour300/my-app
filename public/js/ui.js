// 화면 공용 도구. AI 나 파일에서 온 글자는 textContent 로만 넣는다.
(function (root) {
  function renderTable(box, columns, rows, limit, decimals) {
    box.textContent = '';
    var table = document.createElement('table'), head = document.createElement('tr');
    columns.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; head.appendChild(th); });
    table.appendChild(head);
    rows.slice(0, limit).forEach(function (r) {
      var tr = document.createElement('tr');
      r.forEach(function (v, ci) {
        var td = document.createElement('td');
        var dec = decimals ? decimals[ci] : null;
        td.textContent = v === null || v === undefined ? '' : (typeof v === 'number' && dec !== null && dec !== undefined ? v.toFixed(dec) : String(v));
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

  // 결과 표: 비율 컬럼(0~1)은 %로 바꿔 소수점 첫째 자리까지 반올림해 보이고, 단위는 컬럼 이름에만 [%]로 붙인다.
  // 계산한 값(rows)은 바꾸지 않는다.
  function renderResultTable(box, columns, rows, limit) {
    var rate = root.Charts ? root.Charts.rateColumns(columns, rows) : [];
    var cols = columns.map(function (n, i) { return rate[i] && !/[%％]/.test(n) ? n + ' [%]' : n; });
    var dec = columns.map(function (n, i) { return rate[i] ? 1 : null; });
    var shown = rows.map(function (r) { return r.map(function (v, i) { return rate[i] && typeof v === 'number' ? Math.round(v * 1000) / 10 : v; }); });
    renderTable(box, cols, shown, limit, dec);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  // 2026-11-21 14:03:07 (이 브라우저의 시간대)
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  root.UI = { renderTable: renderTable, renderResultTable: renderResultTable, stamp: stamp };
})(typeof window !== 'undefined' ? window : globalThis);
