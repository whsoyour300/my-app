// Q&A 탭: 질문 문장을 AI 가 사전 점검(모순 찾기)하고, 사용자가 «최종 결정»을 눌러야 «SQL 만들기»가 열린다.
// 서버로 가는 것은 질문 문장 · 테이블 설명(올린 파일은 이름과 컬럼만) · 데이터 날짜 범위(최소·최대 두 개)뿐이다.
(function (root) {
  var $ = function (id) { return document.getElementById(id); };
  var q = $('q-input'), host = $('precheck');
  if (!q || !host) return;

  var decided = false, decidedText = '', seq = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function emit() { root.dispatchEvent(new CustomEvent('question-decision', { detail: { decided: decided, text: decidedText } })); }

  var bar = el('div', 'row');
  var btn = el('button', 'btn', 'AI 사전 점검'); btn.type = 'button';
  var status = el('span', 'muted'); status.setAttribute('role', 'status');
  bar.appendChild(btn); bar.appendChild(status);
  var box = el('div', 'check-box'); box.hidden = true;
  host.appendChild(bar); host.appendChild(box);

  function setStatus(t, cls) { status.textContent = t; status.className = cls || 'muted'; }

  // 질문이 바뀌면(옵션 변경이나 직접 수정) 이전 점검과 결정은 무효다.
  function invalidate() {
    seq++;
    decided = false; decidedText = '';
    box.hidden = true; box.textContent = '';
    btn.disabled = false;
    setStatus('조건을 정하고 문장을 확인한 뒤 «AI 사전 점검» → «최종 결정» 순서로 눌러 주세요.');
    emit();
  }
  q.addEventListener('input', invalidate);
  q.addEventListener('builder-write', invalidate);

  function decide(text, how) {
    q.value = text;               // 프로그램이 넣은 값이라 input 이벤트는 일어나지 않는다
    decided = true; decidedText = text;
    box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var done = el('p', 'check-done', '✓ 최종 결정했습니다 (' + how + '). 이제 «SQL 만들기»를 누를 수 있습니다.');
    box.appendChild(done);
    setStatus('');
    emit();
  }

  function render(res, text) {
    box.textContent = '';
    box.hidden = false;
    var all = res.issues || [];
    var issues = all.filter(function (i) { return i.level !== 'info'; });   // 모순 · 주의만 '확인 필요'로 센다
    var infos = all.filter(function (i) { return i.level === 'info'; });
    var head = el('div', 'check-head');
    var hasErr = issues.some(function (i) { return i.level === 'error'; });
    head.appendChild(el('span', 'badge ' + (issues.length ? (hasErr ? 'bad' : 'warn') : 'ok'), issues.length ? '확인 필요 ' + issues.length + '건' : '모순 없음'));
    if (res.summary) head.appendChild(el('span', 'check-sum', res.summary));
    box.appendChild(head);
    if (all.length) {
      var ul = el('ul', 'check-list');
      issues.concat(infos).forEach(function (i) {
        var li = el('li', i.level);
        li.appendChild(el('b', null, i.level === 'error' ? '모순 ' : i.level === 'info' ? '참고 ' : '주의 '));
        li.appendChild(document.createTextNode(i.text));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    var changed = res.revised && res.revised !== text;
    var acts = el('div', 'row');
    if (changed) {
      box.appendChild(el('div', 'lbl', 'AI 가 정리한 문장'));
      var pre = el('pre', 'check-text', res.revised);
      box.appendChild(pre);
      var b1 = el('button', 'btn primary', 'AI 정리 문장으로 최종 결정'); b1.type = 'button';
      var b2 = el('button', 'btn', '내가 쓴 문장 그대로 최종 결정'); b2.type = 'button';
      b1.addEventListener('click', function () { decide(res.revised, 'AI 정리 문장'); });
      b2.addEventListener('click', function () { decide(text, '내 문장'); });
      acts.appendChild(b1); acts.appendChild(b2);
    } else {
      var b3 = el('button', 'btn primary', issues.length ? '이대로 최종 결정' : '최종 결정'); b3.type = 'button';
      b3.addEventListener('click', function () { decide(text, issues.length ? '내 문장, 확인 필요 항목 있음' : '점검 통과'); });
      acts.appendChild(b3);
      if (issues.length) box.appendChild(el('p', 'muted small', 'AI 가 고칠 문장을 만들지 못했습니다. 위 항목을 보고 질문이나 조건을 직접 고칠 수도 있습니다.'));
    }
    box.appendChild(acts);
  }

  function renderError(msg, text) {
    box.textContent = '';
    box.hidden = false;
    box.appendChild(el('p', 'warn', 'AI 사전 점검을 하지 못했습니다: ' + msg));
    var b = el('button', 'btn', '점검 없이 최종 결정'); b.type = 'button';
    b.addEventListener('click', function () { decide(text, '점검 없이'); });
    var again = el('button', 'btn', '다시 점검'); again.type = 'button';
    again.addEventListener('click', run);
    var r = el('div', 'row'); r.appendChild(again); r.appendChild(b);
    box.appendChild(r);
  }

  function run() {
    var text = q.value.trim();
    if (!text) { setStatus('질문 문장이 비어 있습니다. 조건을 고르거나 질문을 써 주세요.', 'warn'); return; }
    var my = ++seq;
    btn.disabled = true;
    setStatus('AI 가 질문을 점검하는 중입니다…');
    box.hidden = true;
    var range = root.Builder && root.Builder.range && root.Builder.range.min ? root.Builder.range : null;
    var extra = root.Files ? root.Files.describe() : [];
    fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, data_range: range, extra_tables: extra }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (my !== seq) return;       // 점검 도중 질문이 바뀌었으면 결과를 버린다
        if (!res.ok) throw new Error(res.j.error || '요청에 실패했습니다.');
        setStatus('');
        render(res.j, text);
      })
      .catch(function (e) { if (my === seq) { setStatus(''); renderError(e.message, text); } })
      .then(function () { if (my === seq) btn.disabled = false; });
  }
  btn.addEventListener('click', run);

  root.PreCheck = { isDecided: function () { return decided; }, text: function () { return decidedText; } };
  setStatus('조건을 정하고 문장을 확인한 뒤 «AI 사전 점검» → «최종 결정» 순서로 눌러 주세요.');
})(window);
