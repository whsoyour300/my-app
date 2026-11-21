// SQL 실행 전 검사. AI 가 쓴 SQL 이든 내가 쓴 SQL 이든 같은 함수를 거친다.
// 통과 조건: 문장 하나, SELECT 또는 WITH 로 시작, 쓰기·파일·확장 관련 키워드와 함수 없음.
(function (root) {
  var BANNED_WORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'MERGE',
    'ATTACH', 'DETACH', 'COPY', 'EXPORT', 'IMPORT', 'INSTALL', 'LOAD', 'PRAGMA',
    'CALL', 'EXECUTE', 'VACUUM', 'CHECKPOINT', 'USE', 'GRANT', 'REVOKE', 'COMMIT',
    'ROLLBACK', 'BEGIN', 'DESCRIBE', 'SUMMARIZE'
  ];
  // 파일 · 네트워크를 읽는 함수. 데이터는 이미 올라와 있는 테이블로만 읽는다.
  var BANNED_FUNCS = [
    'read_csv', 'read_csv_auto', 'read_parquet', 'parquet_scan', 'read_json', 'read_json_auto',
    'read_ndjson', 'read_text', 'read_blob', 'glob', 'sniff_csv', 'read_xlsx', 'iceberg_scan',
    'delta_scan', 'query', 'query_table', 'duckdb_secrets', 'getenv', 'current_setting'
  ];
  var ID = '[A-Za-z0-9_]';

  // 문자열 안과 주석 안의 글자는 SQL 이 아니므로 키워드 검사에서 뺀다.
  // keep 가 배열이면 큰따옴표 식별자("내 테이블")의 내용을 거기에 모으고 글자에는 "§번호" 로 남긴다(테이블 이름 추출용).
  function mask(sql, keep) {
    var out = '', i = 0, n = sql.length;
    while (i < n) {
      var c = sql[i], d = sql[i + 1];
      if (c === '-' && d === '-') { while (i < n && sql[i] !== '\n') i++; out += ' '; continue; }
      if (c === '/' && d === '*') {
        var e = sql.indexOf('*/', i + 2);
        if (e < 0) return { err: '닫히지 않은 주석(/*)이 있습니다.' };
        i = e + 2; out += ' '; continue;
      }
      if (c === "'") {
        var j = i + 1;
        while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; }
        if (j >= n) return { err: '닫히지 않은 문자열(\')이 있습니다.' };
        out += "''"; i = j + 1; continue;
      }
      if (c === '"') {
        var k = i + 1;
        while (k < n) { if (sql[k] === '"') { if (sql[k + 1] === '"') { k += 2; continue; } break; } k++; }
        if (k >= n) return { err: '닫히지 않은 따옴표(")가 있습니다.' };
        if (keep) { keep.push(sql.slice(i + 1, k).replace(/""/g, '"')); out += '"§' + (keep.length - 1) + '"'; }
        else out += '"x"';
        i = k + 1; continue;
      }
      out += c; i++;
    }
    return { text: out };
  }

  function checkSql(sql) {
    if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'SQL 이 비어 있습니다.' };
    if (sql.length > 20000) return { ok: false, reason: 'SQL 이 너무 깁니다(2만 자 초과).' };

    // 파일 경로를 테이블처럼 읽는 형태: FROM 'a.csv'
    if (/\b(from|join)\s+'/i.test(sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' '))) {
      return { ok: false, reason: '파일 경로를 직접 읽는 SQL 은 실행하지 않습니다.' };
    }
    var m = mask(sql);
    if (m.err) return { ok: false, reason: m.err };
    var t = m.text.trim().replace(/;+\s*$/, '').trim();

    if (t.indexOf(';') >= 0) return { ok: false, reason: '문장이 여러 개입니다. 한 번에 한 문장만 실행합니다.' };
    var first = (t.match(/^\(*\s*([A-Za-z]+)/) || [])[1];
    if (!first || !/^(select|with)$/i.test(first)) {
      return { ok: false, reason: '읽기(SELECT · WITH)만 실행합니다. ' + (first ? first.toUpperCase() + ' 문은 막았습니다.' : '문장이 SELECT 나 WITH 로 시작하지 않습니다.') };
    }
    var i, re;
    for (i = 0; i < BANNED_WORDS.length; i++) {
      re = new RegExp('(^|[^A-Za-z0-9_])' + BANNED_WORDS[i] + '(?![A-Za-z0-9_])', 'i');
      if (re.test(t)) return { ok: false, reason: BANNED_WORDS[i] + ' 는 쓸 수 없습니다. 읽기(SELECT · WITH)만 실행합니다.' };
    }
    for (i = 0; i < BANNED_FUNCS.length; i++) {
      re = new RegExp('(^|[^A-Za-z0-9_])' + BANNED_FUNCS[i] + '\\s*\\(', 'i');
      if (re.test(t)) return { ok: false, reason: BANNED_FUNCS[i] + '() 는 파일이나 환경을 읽는 함수라 막았습니다.' };
    }
    // 검사에 쓴 t 는 문자열과 주석을 지운 사본이다. 실행에는 원본에서 끝의 세미콜론만 뗀 SQL 을 쓴다.
    return { ok: true, sql: sql.trim().replace(/;+\s*$/, '').trim() };
  }

  // SQL 이 읽는 테이블 이름(소문자). CTE(WITH 이름)와 함수(FROM f(...))는 뺀다. 산출 근거 대조에 쓴다.
  function tablesOf(sql) {
    var quoted = [];
    var m = mask(String(sql || ''), quoted);
    if (m.err) return [];
    var t = m.text.replace(/\bextract\s*\(\s*[A-Za-z_]+\s+from/gi, 'extract(x,');
    var nameOf = function (q, id) { return String(q !== undefined ? quoted[Number(q)] : id).toLowerCase(); };
    var ctes = {}, mm;
    // 올린 파일의 테이블 이름에는 한글이 올 수 있고, AI 는 그런 이름을 큰따옴표로 감싸 쓴다. 둘 다 읽는다.
    var NAME = '(?:"§(\\d+)"|([\\p{L}_][\\p{L}\\p{N}_]*))';
    var cteRe = new RegExp('(?:\\bwith|,)\\s*(?:recursive\\s+)?' + NAME + '\\s*(?:\\([^)]*\\)\\s*)?as\\s*(?:not\\s+materialized\\s*|materialized\\s*)?\\(', 'giu');
    while ((mm = cteRe.exec(t))) ctes[nameOf(mm[1], mm[2])] = 1;
    var out = [], seen = {};
    var re = new RegExp('\\b(?:from|join)\\s+' + NAME + '(?![\\p{L}\\p{N}_])(?!\\s*\\()', 'giu');
    while ((mm = re.exec(t))) {
      var n = nameOf(mm[1], mm[2]);
      if (ctes[n] || seen[n]) continue;
      seen[n] = 1;
      out.push(n);
    }
    return out;
  }

  var api = { checkSql: checkSql, tablesOf: tablesOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SqlGuard = api;
})(typeof window !== 'undefined' ? window : globalThis);
