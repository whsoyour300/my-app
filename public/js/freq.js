// Q&A 탭: 자주 쓰는 질문 목록(스크롤)과 내보내기 · 가져오기.
// 목록 = 기본 질문(presets/questions.json, 사이트를 여는 누구에게나 같음) + 내가 등록한 질문(이 브라우저의 localStorage).
// «실행»은 저장된 SQL 을 AI 를 거치지 않고 그대로 실행하므로, 같은 데이터에서는 누가 돌려도 같은 값이 나온다.
(function (root) {
  var $ = function (id) { return document.getElementById(id); };
  var list = $('freq-list'), filter = $('freq-filter'), count = $('freq-count');
  if (!list) return;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function dbReady() { return !!(root.Db && root.Db.state === 'ready'); }

  function items() {
    var P = root.Presets;
    var base = ((P && P.items) || []).map(function (p) { return { kind: 'base', id: p.id, title: p.title, question: p.question, sql: p.sql }; });
    var mine = ((P && P.saved) ? P.saved.list() : []).map(function (s) { return { kind: 'mine', id: s.id, title: s.name, question: s.question, sql: s.sql, basis: s.basis, at: s.savedAt }; });
    return base.concat(mine);
  }

  function render() {
    var all = items();
    var kw = (filter.value || '').trim().toLowerCase();
    var shown = all.filter(function (it) { return !kw || (it.title + ' ' + (it.question || '')).toLowerCase().indexOf(kw) >= 0; });
    count.textContent = '(' + (kw ? shown.length + ' / ' : '') + all.length + '개)';
    list.textContent = '';
    if (!shown.length) {
      list.appendChild(el('div', 'empty', all.length ? '찾는 말이 들어간 질문이 없습니다.' : '질문 목록을 읽는 중입니다.'));
      return;
    }
    shown.forEach(function (it) {
      var row = el('div', 'freq-row'); row.setAttribute('role', 'listitem');
      row.appendChild(el('span', 'badge ' + (it.kind === 'base' ? 'ok' : 'mine'), it.kind === 'base' ? '기본' : '내 질문'));
      var main = el('div', 'freq-main');
      main.appendChild(el('div', 'freq-title', it.title));
      var sub = String(it.question || '').split('\n')[0].trim();
      if (sub) main.appendChild(el('div', 'freq-sub', sub.length > 90 ? sub.slice(0, 90) + '…' : sub));
      row.appendChild(main);
      var run = el('button', 'btn small-btn primary', '실행'); run.type = 'button';
      run.disabled = !dbReady();
      run.title = '저장된 SQL 을 그대로 실행합니다';
      run.addEventListener('click', function () { if (root.QA) root.QA.runStored(it); });
      row.appendChild(run);
      if (it.kind === 'mine') {
        var del = el('button', 'btn small-btn', '삭제'); del.type = 'button';
        del.addEventListener('click', function () {
          if (root.confirm('«' + it.title + '» 질문을 목록에서 지울까요? (이 브라우저에서만 지워집니다)')) root.Presets.saved.remove(it.id);
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
  }

  filter.addEventListener('input', render);
  root.addEventListener('saved-changed', render);
  root.addEventListener('presets-ready', render);
  root.addEventListener('db-status', render);

  // ---- 내보내기 · 가져오기 (등록한 질문만) ----
  var ioStatus = $('freq-io-status');
  function say(t, cls) { ioStatus.textContent = t; ioStatus.className = cls || 'muted'; }
  $('freq-export').addEventListener('click', function () {
    var mine = root.Presets.saved.list();
    if (!mine.length) { say('내보낼 «내 질문»이 없습니다. 먼저 등록해 주세요.', 'warn'); return; }
    var blob = new Blob([root.Presets.saved.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'saved-questions.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    say('«내 질문» ' + mine.length + '개를 saved-questions.json 으로 내려받았습니다.');
  });
  $('freq-import').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { say('파일이 너무 큽니다(2MB 이하).', 'warn'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var r = root.Presets.saved.importJson(String(rd.result));
      if (!r.ok) { say('가져오지 못했습니다. ' + r.reason, 'warn'); return; }
      say('가져왔습니다: 새로 ' + r.added + '개, 같은 이름이라 바꾼 것 ' + r.replaced + '개' +
        (r.skipped.length ? ', 건너뜀 ' + r.skipped.length + '개 (' + r.skipped.slice(0, 3).join(' / ') + (r.skipped.length > 3 ? ' …' : '') + ')' : '') + '.', r.skipped.length ? 'warn' : 'muted');
    };
    rd.onerror = function () { say('파일을 읽지 못했습니다.', 'warn'); };
    rd.readAsText(f, 'utf-8');
  });

  render();
})(window);
