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
        // 주의 · 모순 밑에: 이 문장 그대로 실행하면 어떻게 되는지(예상 결과)와 어떻게 고치면 되는지(수정 예시)
        if (i.expected) { var e1 = el('div', 'check-sub'); e1.appendChild(el('span', 'sub-tag', '예상 결과')); e1.appendChild(document.createTextNode(i.expected)); li.appendChild(e1); }
        if (i.fix) { var e2 = el('div', 'check-sub fix'); e2.appendChild(el('span', 'sub-tag', '수정 예시')); e2.appendChild(document.createTextNode(i.fix)); li.appendChild(e2); }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    renderFacts(res.facts);
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

  // 브라우저가 실제 데이터에서 센 값(나누기 전 전체 기준). AI 가 쓴 말이 아니라 계산한 숫자다.
  function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
  function renderFacts(f) {
    if (!f) return;
    var lines = [];
    if (f.period) {
      var rg = root.Builder && root.Builder.range;
      var t = f.period.from + ' ~ ' + f.period.to + ' 기간의 시험: 첫 시도 ' + fmt(f.first_try) + '건 (모든 시도 ' + fmt(f.tests_all) + '건)';
      if (!f.first_try) t += ' → 이 기간에는 읽을 데이터가 없어 결과가 비어 나옵니다' + (rg && rg.min ? ' (데이터 범위 ' + rg.min + ' ~ ' + rg.max + ')' : '');
      lines.push(t);
    }
    if (f.numerator && f.denominator) {
      var t2 = '정의대로 전체를 한 값으로 세면: ' + f.numerator.name + ' ' + fmt(f.numerator.value) + ' ÷ ' + f.denominator.name + ' ' + fmt(f.denominator.value);
      if (f.ratio_percent === null || f.ratio_percent === undefined) t2 += ' → 분모가 0이라 계산되지 않습니다';
      else {
        t2 += ' = ' + f.ratio_percent.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
        if (f.ratio_percent > 100) t2 += ' → 100%를 넘습니다. 분자와 분모의 범위가 맞지 않는다는 뜻입니다';
      }
      lines.push(t2);
    }
    if (f.join_without_step && f.join_without_step.multiplier) {
      lines.push('설비로 나누면서 공정을 정하지 않으면 시험 ' + fmt(f.join_without_step.rows_before) + '행이 ' + fmt(f.join_without_step.rows_after) + '행(약 ' + f.join_without_step.multiplier + '배)으로 늘어나 건수가 부풀려집니다');
    }
    if (!lines.length) return;
    var fb = el('div', 'check-facts');
    fb.appendChild(el('div', 'lbl', '현재 조건으로 실행하면 (실제 데이터를 센 값, 나누기 전 전체 기준)'));
    var ul = el('ul', 'check-list');
    lines.forEach(function (l) { ul.appendChild(el('li', null, l)); });
    fb.appendChild(ul);
    box.appendChild(fb);
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
    // 조건 도우미로 만든 문장 그대로일 때만, 그 조건으로 데이터를 세어 본 값(facts)을 함께 보낸다.
    var cur = root.Builder && root.Builder.current;
    var factsP = cur && cur.text.trim() === text ? root.Builder.facts(cur.state).catch(function () { return null; }) : Promise.resolve(null);
    factsP.then(function (facts) {
      return fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, data_range: range, facts: facts, extra_tables: extra }) })
        .then(function (r) { return r.json().then(function (j) { j.facts = facts; return { ok: r.ok, j: j }; }); });
    })
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
