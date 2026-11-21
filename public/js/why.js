// «왜» 계산 모듈 (순수 함수만. 브라우저와 node 둘 다에서 돈다).
//  ① checkBasis: AI 가 돌려준 산출 근거를 SQL 과 대조해 어긋나면 '확인 필요'로 표시한다.
//  ② biggestChunk: 쪼갠 결과 표에서 가장 큰 덩어리와 비중을 계산한다. AI 가 말한 숫자는 쓰지 않는다.
(function (root) {
  // 지표별로 SQL 에 꼭 있어야 하는 것. 데이터 사전의 지표 정의에서 온 규칙이다.
  var METRIC_RULES = {
    'fail률': { word: 'attempt', msg: 'fail률은 첫 시도(attempt = 1) 기준인데 SQL 에 attempt 조건이 없습니다.' },
    '재시험률': { word: 'attempt', msg: '재시험률은 attempt 로 첫 시도와 재시험을 나눠야 하는데 SQL 에 attempt 가 없습니다.' },
    '재시험 통과율': { word: 'attempt', msg: '재시험 통과율은 attempt = 2 기준인데 SQL 에 attempt 조건이 없습니다.' },
    '불량 수량': { word: 'attempt', msg: '불량 수량은 attempt 조건을 먼저 걸어야 재시험 수량이 이중으로 들어가지 않는데 SQL 에 attempt 가 없습니다.' }
  };

  function lower(s) { return String(s).toLowerCase(); }
  function words(sql, mask) {
    var set = {}, m = String(mask || sql).match(/[\p{L}_][\p{L}\p{N}_]*/gu) || [];
    m.forEach(function (w) { set[w.toLowerCase()] = 1; });
    return set;
  }

  // sql: 실행할 SQL, basis: {tables, conditions, metrics}, schema: schema.json, tablesOf: SqlGuard.tablesOf
  function checkBasis(sql, basis, schema, tablesOf, stripText) {
    var items = [];
    function add(level, text) { items.push({ level: level, text: text }); }
    if (!basis || typeof basis !== 'object') {
      return { items: [{ level: 'warn', text: 'AI 가 산출 근거를 돌려주지 않았습니다.' }], needsCheck: true };
    }
    var known = {}, colSet = {};
    (schema.tables || []).forEach(function (t) {
      known[lower(t.name)] = t;
      (t.columns || []).forEach(function (c) { colSet[lower(c.name)] = 1; });
    });
    var sqlTables = tablesOf(sql);
    var claimed = (basis.tables || []).map(lower);
    var text = stripText ? stripText(sql) : sql;
    var sqlWords = words(text);

    // 읽은 테이블
    var unknown = sqlTables.filter(function (t) { return !known[t]; });
    var notClaimed = sqlTables.filter(function (t) { return claimed.indexOf(t) < 0; });
    var notRead = claimed.filter(function (t) { return sqlTables.indexOf(t) < 0; });
    if (!sqlTables.length) add('warn', 'SQL 에서 읽는 테이블을 찾지 못했습니다.');
    if (unknown.length) add('warn', 'schema 에 없는 테이블을 읽습니다: ' + unknown.join(', '));
    if (notClaimed.length) add('warn', 'SQL 은 읽는데 근거에는 없는 테이블: ' + notClaimed.join(', '));
    if (notRead.length) add('warn', '근거에는 있는데 SQL 이 읽지 않는 테이블: ' + notRead.join(', '));
    if (sqlTables.length && !unknown.length && !notClaimed.length && !notRead.length) {
      add('ok', '읽은 테이블: ' + sqlTables.join(', ') + ' (SQL 과 일치)');
    }

    // 조건: 조건에 나온 컬럼 이름이 SQL 에 실제로 있는지만 본다. 값까지는 확인하지 않는다.
    (basis.conditions || []).forEach(function (c) {
      var cols = (String(c).match(/[\p{L}_][\p{L}\p{N}_]*/gu) || []).map(lower).filter(function (w) { return colSet[w]; });
      var missing = cols.filter(function (w, i) { return cols.indexOf(w) === i && !sqlWords[w]; });
      if (missing.length) add('warn', '조건 "' + c + '" 의 컬럼 ' + missing.join(', ') + ' 이(가) SQL 에 없습니다.');
      else add('ok', '조건: ' + c);
    });

    // 지표 정의
    var defs = {};
    (schema.metrics || []).forEach(function (m) { defs[m.name] = m; });
    (basis.metrics || []).forEach(function (name) {
      var d = defs[name];
      if (!d) { add('warn', '데이터 사전에 없는 지표 정의입니다: ' + name); return; }
      var rule = METRIC_RULES[name];
      if (rule && !sqlWords[rule.word]) add('warn', rule.msg);
      else add('ok', '지표 정의 «' + name + '»: ' + d.definition);
    });
    if (!(basis.metrics || []).length) add('ok', '데이터 사전의 지표 정의를 쓰지 않은 질문입니다.');

    return { items: items, needsCheck: items.some(function (i) { return i.level === 'warn'; }) };
  }

  // 결과 표(columns, rows)에서 valueCol 합계 대비 가장 큰 행을 찾는다.
  function biggestChunk(columns, rows, valueCol, labelCols) {
    var vi = columns.indexOf(valueCol);
    if (vi < 0) return { ok: false, reason: '합계 기준 컬럼 "' + valueCol + '" 이 결과에 없어 주요 원인을 계산하지 못했습니다.' };
    var total = 0, best = -1, bestV = -Infinity;
    rows.forEach(function (r, i) {
      var v = r[vi];
      if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return;
      v = Number(v);
      total += v;
      if (v > bestV) { bestV = v; best = i; }
    });
    if (best < 0) return { ok: false, reason: '"' + valueCol + '" 에 숫자 값이 없어 주요 원인을 계산하지 못했습니다.' };
    if (total <= 0) return { ok: false, reason: '"' + valueCol + '" 의 합계가 0 이라 비중을 계산할 수 없습니다.' };
    var idx = (labelCols || []).map(function (c) { return columns.indexOf(c); }).filter(function (i) { return i >= 0 && i !== vi; });
    if (!idx.length) { // AI 가 구분 컬럼을 말하지 않았으면 문자 컬럼을 구분 컬럼으로 본다
      columns.forEach(function (c, i) {
        if (i === vi) return;
        var allText = rows.length > 0 && rows.every(function (r) { return r[i] === null || typeof r[i] === 'string'; });
        if (allText) idx.push(i);
      });
    }
    var labelOf = function (r) { return idx.map(function (i) { return columns[i] + '=' + r[i]; }).join(' · ') || '(구분 컬럼 없음)'; };
    // 값이 같은 행이 여러 개면(동률) 하나만 고르지 않고 모두 돌려준다.
    var ties = rows.filter(function (r) { return r[vi] !== null && r[vi] !== '' && Number(r[vi]) === bestV; }).map(labelOf);
    return { ok: true, label: labelOf(rows[best]), ties: ties, valueCol: valueCol, value: bestV, total: total, share: bestV / total, row: best };
  }

  function fmt(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }
  // truncated: 쪼개기 SQL 의 LIMIT 에 걸려 결과가 잘렸을 수 있으면 true. 그러면 합계가 전체가 아닐 수 있다고 알린다.
  function chunkLine(c, truncated) {
    var head = c.ties && c.ties.length > 1
      ? '주요 원인(동률 ' + c.ties.length + '곳): ' + c.ties.join(' / ')
      : '주요 원인: ' + c.label;
    var tail = ' — ' + c.valueCol + ' ' + fmt(c.value) + (c.ties && c.ties.length > 1 ? ' 각각' : '') + ' (표의 합계 ' + fmt(c.total) + ' 중 ' + pct(c.share) + ')';
    return head + tail + (truncated ? ' ※ 결과가 LIMIT 에서 잘렸을 수 있어 합계가 전체와 다를 수 있습니다.' : '');
  }
  // SQL 의 마지막 LIMIT 값과 결과 행 수가 같으면 잘렸을 수 있다고 본다.
  function maybeTruncated(sql, rowCount) {
    var m = String(sql || '').match(/\blimit\s+(\d+)\s*;?\s*$/i);
    return !!m && rowCount >= Number(m[1]);
  }

  var api = { checkBasis: checkBasis, biggestChunk: biggestChunk, chunkLine: chunkLine, maybeTruncated: maybeTruncated };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Why = api;
})(typeof window !== 'undefined' ? window : globalThis);
