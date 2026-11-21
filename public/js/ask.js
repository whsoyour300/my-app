// Q&A 탭: 질문 → /api/ask → SQL 검사 → 실행(DuckDB, 브라우저 안) → ① 산출 근거 + ② 원인 한 단계.
// 서버로 가는 것은 질문 · SQL · 집계 결과(50행 이하)뿐이다. 원본 행은 보내지 않는다.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var Guard = window.SqlGuard, Why = window.Why;
  var MAX_SEND_ROWS = 50, MAX_SHOW_ROWS = 100;

  var q = $('q-input'), make = $('q-make'), status = $('q-status');
  var sql = $('sql-input'), note = $('sql-note'), check = $('sql-check');
  var run = $('sql-run'), runStatus = $('run-status'), dbStatus = $('db-status');

  var current = { question: '', genSql: '', basis: null };
  var schemaPromise = fetch('schema.json').then(function (r) { return r.json(); });
  var runSeq = 0;

  function extraTables() { return window.Files ? window.Files.describe() : []; }
  function squash(s) { return String(s || '').replace(/\s+/g, ' ').replace(/;+\s*$/, '').trim(); }

  function showCheck() {
    var r = Guard.checkSql(sql.value);
    if (!sql.value.trim()) { check.className = 'check'; check.textContent = ''; return r; }
    check.className = 'check ' + (r.ok ? 'ok' : 'bad');
    check.textContent = r.ok ? '검사 통과: 읽기(SELECT · WITH) 한 문장입니다.' : '실행 전에 막았습니다. ' + r.reason;
    return r;
  }
  sql.addEventListener('input', showCheck);

  // ---- DuckDB 상태 ----
  function showDb(d) {
    dbStatus.textContent = d.text;
    dbStatus.className = d.state === 'error' ? 'warn' : 'muted';
    run.disabled = d.state !== 'ready';
  }
  window.addEventListener('db-status', function (e) { showDb(e.detail); });
  if (window.Db) showDb({ state: window.Db.state, text: window.Db.text });

  // 표 그리기는 ui.js 의 공용 함수를 쓴다 (AI 가 만든 글자는 textContent 로만 넣는다).
  var renderTable = window.UI.renderTable;

  // ---- 이름 붙여 저장 (저장 전에도 읽기 전용 검사를 거친다) ----
  var saveName = $('save-name'), saveBtn = $('sql-save'), saveStatus = $('save-status');
  saveBtn.addEventListener('click', function () {
    var sameAsGenerated = squash(sql.value) === squash(current.genSql);
    var r = window.Presets.saved.add({
      name: saveName.value,
      question: current.question || q.value.trim(),
      sql: sql.value,
      basis: sameAsGenerated ? current.basis : null
    });
    if (!r.ok) { saveStatus.textContent = r.reason; saveStatus.className = 'warn'; return; }
    saveStatus.className = 'muted';
    saveStatus.textContent = (r.replaced ? '같은 이름이 있어 바꿔 등록했습니다.' : '등록했습니다.') +
      (r.stored ? ' 위의 «자주 쓰는 질문» 목록에 «내 질문»으로 나타나고, 준비된 질문 탭에서도 다시 계산할 수 있습니다.' : ' 이 브라우저에는 저장하지 못했습니다. «내보내기(JSON)»를 쓰세요.');
  });

  function badge(el, level, text) { el.className = 'badge ' + level; el.textContent = text; }
  function show(el, on) { el.hidden = !on; }

  // ---- 질문 → SQL ----
  function decided() { return !!(window.PreCheck && window.PreCheck.isDecided()); }
  // «최종 결정»을 눌러야 SQL 만들기가 열린다. 질문이 바뀌면 다시 잠긴다.
  make.disabled = true;
  window.addEventListener('question-decision', function (e) {
    make.disabled = !e.detail.decided;
    status.textContent = e.detail.decided ? '최종 결정됨. «SQL 만들기»를 누르세요.' : '«AI 사전 점검» 후 «최종 결정»을 누르면 SQL 만들기가 열립니다.';
  });

  function ask() {
    var text = q.value.trim();
    if (!text) { status.textContent = '질문을 먼저 써 주세요.'; return; }
    if (!decided()) { status.textContent = '먼저 «AI 사전 점검»과 «최종 결정»을 눌러 주세요.'; return; }
    make.disabled = true;
    status.textContent = 'AI 가 SQL 을 만드는 중입니다…';
    note.hidden = true;
    // 올린 파일의 테이블 설명(이름 · 컬럼 이름 · 타입 · 행 수)만 더해 보낸다. 파일의 행은 보내지 않는다.
    fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, extra_tables: extraTables() }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || '요청에 실패했습니다.');
        sql.value = res.j.sql;
        current = { question: text, genSql: res.j.sql, basis: res.j.basis || null };
        if (res.j.note) { note.textContent = res.j.note; note.hidden = false; }
        status.textContent = 'SQL 을 만들었습니다. 읽어 본 뒤 실행하세요.';
        showCheck();
      })
      .catch(function (e) { status.textContent = e.message; })
      .then(function () { make.disabled = !decided(); });
  }
  make.addEventListener('click', ask);
  q.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(); });

  // ---- 결과에 대한 AI 한 줄 분석 ----
  // 문장 속 숫자가 결과에서 나온 값(또는 그 값을 %로 바꾼 값)인지 한 번 대조한다. 못 찾으면 참고용 표시만 붙인다.
  function numsOf(text) {
    var t = String(text).replace(/\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?/g, ' ').replace(/[A-Za-z]+[-_]?\d+/g, ' ');
    return (t.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []).map(function (s) { return parseFloat(s.replace(/,/g, '')); });
  }
  function missingNumbers(line, res) {
    var ok = {};
    var add = function (x) { ok[String(Number(x.toFixed(1)))] = 1; ok[String(Number(x.toFixed(0)))] = 1; ok[String(Number(x.toFixed(2)))] = 1; };
    ok[String(res.rows.length)] = 1; ok[String(res.columns.length)] = 1;
    res.rows.forEach(function (r) {
      r.forEach(function (v) {
        if (typeof v === 'number' && isFinite(v)) { add(v); add(v * 100); }
        else if (typeof v === 'string') numsOf(v).forEach(function (n) { ok[String(n)] = 1; });
      });
    });
    return numsOf(line).filter(function (n) { return !ok[String(n)] && !ok[String(Number(n.toFixed(1)))]; });
  }
  var insightSeq = 0;
  function showInsight(execSql, res, seq) {
    var box = $('res-insight');
    var mine = ++insightSeq;
    box.hidden = false;
    box.className = 'insight muted';
    box.textContent = 'AI 한 줄 분석을 만드는 중입니다…';
    var rows = res.rows.slice(0, MAX_SEND_ROWS);
    fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: current.question || q.value.trim() || execSql, sql: execSql, columns: res.columns, rows: rows, extra_tables: extraTables() }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (mine !== insightSeq || seq !== runSeq) return;
        if (!r.ok) throw new Error(r.j.error || '요청에 실패했습니다.');
        box.className = 'insight';
        box.textContent = '';
        var tag = document.createElement('b'); tag.textContent = 'AI 한 줄 분석 ';
        box.appendChild(tag);
        box.appendChild(document.createTextNode(r.j.line));
        var miss = missingNumbers(r.j.line, { rows: rows, columns: res.columns });
        var note = document.createElement('span');
        if (miss.length) { note.className = 'badge warn'; note.textContent = '숫자 확인 필요'; note.title = '결과에서 찾지 못한 숫자: ' + miss.join(', ') + ' (계산해서 만든 값일 수 있습니다)'; }
        else { note.className = 'badge ok'; note.textContent = '숫자 일치'; note.title = '문장 속 숫자가 모두 결과 표에 있는 값입니다.'; }
        box.appendChild(note);
        if (res.rows.length > MAX_SEND_ROWS) { var s = document.createElement('span'); s.className = 'muted small'; s.textContent = ' (앞 ' + MAX_SEND_ROWS + '행만 읽음)'; box.appendChild(s); }
      })
      .catch(function (e) {
        if (mine !== insightSeq || seq !== runSeq) return;
        box.className = 'insight muted';
        box.textContent = 'AI 한 줄 분석을 가져오지 못했습니다: ' + (e && e.message ? e.message : e);
      });
  }

  // ---- 실행 ----
  function resetResult() { ['res', 'why', 'res-insight'].forEach(function (id) { $(id).hidden = true; }); insightSeq++; }

  async function runSql() {
    var g = showCheck();
    if (!g.ok) { runStatus.textContent = ''; return; }
    var seq = ++runSeq;
    run.disabled = true;
    runStatus.textContent = '실행 중…';
    resetResult();
    var res;
    try {
      res = await window.Db.query(g.sql);
    } catch (e) {
      runStatus.textContent = 'SQL 실행 오류: ' + (e && e.message ? e.message : e);
      run.disabled = false;
      return;
    }
    if (seq !== runSeq) return;
    runStatus.textContent = res.rows.length + '행 · ' + res.ms + 'ms';
    $('res-meta').textContent = '(' + res.rows.length + '행)';
    window.UI.renderResultTable($('res-table'), res.columns, res.rows, MAX_SHOW_ROWS);
    show($('res'), true);
    if (window.Charts) window.Charts.render($('res-chart'), res.columns, res.rows, null, { controls: true });
    showInsight(g.sql, res, seq);
    run.disabled = false;

    // 여기서부터는 결과를 그대로 둔 채 ①과 ②만 덧붙인다. 어느 쪽이 실패해도 위의 결과는 지워지지 않는다.
    show($('why'), true);
    var schema = await schemaPromise;
    renderBasis(g.sql, schema);
    await renderCause(g.sql, res, seq);
  }
  run.addEventListener('click', runSql);

  // 자주 쓰는 질문: 저장된 SQL 을 AI 를 거치지 않고 그대로 실행한다(같은 데이터에서는 같은 값).
  window.QA = {
    runStored: function (item) {
      var text = item.question || item.title || '';
      q.value = text;
      q.dispatchEvent(new Event('input', { bubbles: true }));   // 이전 사전 점검 · 최종 결정은 무효
      sql.value = item.sql;
      current = { question: text, genSql: item.sql, basis: item.basis || null };
      note.textContent = '자주 쓰는 질문 «' + (item.title || '') + '»: 저장된 SQL 을 AI 를 거치지 않고 그대로 실행합니다. 같은 데이터에서는 같은 값이 나옵니다.';
      note.hidden = false;
      status.textContent = '';
      showCheck();
      runSql();
      setTimeout(function () { var r = $('res'); if (r && !r.hidden) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 600);
    }
  };

  // ---- ① 산출 근거 ----
  function renderBasis(execSql, schema) {
    var list = $('basis-list'), edited = $('basis-edited');
    list.textContent = '';
    edited.hidden = true;
    var li = function (level, text) {
      var el = document.createElement('li');
      el.className = level;
      el.textContent = (level === 'ok' ? '✓ ' : '⚠ ') + text;
      list.appendChild(el);
    };
    if (!current.basis) {
      badge($('basis-badge'), 'warn', '근거 없음');
      li('warn', 'AI 가 만든 SQL 이 아니어서 산출 근거가 없습니다. (직접 붙여 넣은 SQL)');
      return;
    }
    if (squash(execSql) !== squash(current.genSql)) {
      edited.textContent = 'SQL 을 고쳤습니다. 아래 근거는 AI 가 처음 쓴 SQL 기준이라 어긋날 수 있습니다.';
      edited.hidden = false;
    }
    var merged = window.Files ? window.Files.mergedSchema(schema) : schema;   // 올린 테이블도 아는 테이블로 본다
    var r = Why.checkBasis(execSql, current.basis, merged, Guard.tablesOf);
    r.items.forEach(function (it) { li(it.level, it.text); });
    badge($('basis-badge'), r.needsCheck ? 'warn' : 'ok', r.needsCheck ? '확인 필요' : '근거 일치');
  }

  // ---- ② 원인 한 단계 ----
  function causeReset() {
    ['cause-note', 'cause-chunk', 'cause-sqlbox'].forEach(function (id) { $(id).hidden = true; });
    $('cause-table').textContent = '';
    $('cause-badge').className = 'badge';
    $('cause-badge').textContent = '';
  }

  async function renderCause(execSql, res, seq) {
    causeReset();
    var st = $('cause-status');
    var question = current.question || q.value.trim();
    if (!question) { st.textContent = '질문이 없어 원인 쪼개기를 건너뜁니다. 위 질문 칸에 질문을 써 주세요.'; return; }
    st.textContent = 'AI 가 결과를 쪼개는 SQL 을 쓰는 중입니다…';
    try {
      var r = await fetch('/api/why', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question, sql: execSql, columns: res.columns, rows: res.rows.slice(0, MAX_SEND_ROWS), extra_tables: extraTables() })
      });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || '쪼개기 요청에 실패했습니다.');
      if (seq !== runSeq) return;
      $('cause-sql').textContent = j.cause_sql;
      show($('cause-sqlbox'), true);
      if (j.cause_note) { $('cause-note').textContent = j.cause_note; show($('cause-note'), true); }

      var cg = Guard.checkSql(j.cause_sql);   // 원인 SQL 도 같은 읽기 전용 검사를 거친다
      if (!cg.ok) { badge($('cause-badge'), 'bad', '막힘'); st.textContent = '쪼개기 SQL 을 실행 전에 막았습니다. ' + cg.reason; return; }
      st.textContent = '쪼개기 SQL 실행 중…';
      var cres = await window.Db.query(cg.sql);
      if (seq !== runSeq) return;
      st.textContent = cres.rows.length + '행 · ' + cres.ms + 'ms';
      renderTable($('cause-table'), cres.columns, cres.rows, MAX_SHOW_ROWS);

      // 가장 큰 덩어리와 비중: AI 가 아니라 이 브라우저가 결과 표에서 계산한다.
      var c = Why.biggestChunk(cres.columns, cres.rows, j.value_col, j.label_cols);
      var line = $('cause-chunk');
      line.textContent = c.ok ? Why.chunkLine(c, Why.maybeTruncated(cg.sql, cres.rows.length)) : c.reason;
      line.className = 'chunk' + (c.ok ? '' : ' warn');
      show(line, true);
      badge($('cause-badge'), c.ok ? 'ok' : 'warn', c.ok ? '계산됨' : '확인 필요');
    } catch (e) {
      if (seq !== runSeq) return;
      badge($('cause-badge'), 'bad', '실패');
      st.textContent = '원인 쪼개기에 실패했습니다: ' + (e && e.message ? e.message : e) + ' (위의 결과와 ① 근거는 그대로입니다)';
    }
  }
})();
