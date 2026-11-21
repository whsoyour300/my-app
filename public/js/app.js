// 탭 전환과 서버 상태 표시. 이후 단계의 모듈(db, ask, why, files)이 여기에 연결된다.
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  var names = tabs.map(function (t) { return t.dataset.tab; });

  function show(name) {
    if (names.indexOf(name) < 0) name = names[0];
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      document.getElementById('panel-' + t.dataset.tab).hidden = !on;
    });
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () {
      location.hash = t.dataset.tab;
    });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      location.hash = next.dataset.tab;
      e.preventDefault();
    });
  });

  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  show(location.hash.slice(1));

  // 서버 상태: /api/health 가 있으면 AI 사용 가능 여부를 보여 준다. 4단계 전에는 없을 수 있다.
  var st = document.getElementById('server-status');
  fetch('/api/health').then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (j) {
      st.textContent = j.ai ? 'AI 연결됨 (' + j.model + ')' : 'AI 키 없음 (.env 에 GEMINI_API_KEY 필요)';
      st.className = j.ai ? 'ok' : 'warn';
    })
    .catch(function () {
      st.textContent = '화면 서버만 실행 중 (AI 기능은 4단계 이후)';
    });
})();
