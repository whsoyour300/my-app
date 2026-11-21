// Q&A 탭의 질문 도우미: 기간 · 기준 · 비교 · 정의를 고르면 질문 문장을 자동으로 만들어 질문 칸에 넣는다.
// 문장은 언제든 직접 고칠 수 있고, 직접 고친 뒤에는 옵션을 바꿔도 덮어쓰지 않는다("문장 다시 만들기"를 눌러야 옵션대로 다시 만든다).
// 여기서는 SQL 을 만들지 않는다. 만든 문장을 기존 "SQL 만들기"(AI)가 읽는다.
(function (root) {
  // ---- 선택지 ----
  var DIMS = [
    { key: 'product',    ko: '제품',     col: 'product' },
    { key: 'equip_id',   ko: '설비명',   col: 'equip_id' },
    { key: 'equip_type', ko: '설비군',   col: 'equip_type' },
    { key: 'vendor',     ko: '설비사',   col: 'vendor' },
    { key: 'step',       ko: '공정',     col: 'step' },
    { key: 'test_item',  ko: 'test 항목', col: 'test_item' }
  ];
  var CMPS = [
    { key: 'none', label: '비교 없음',                   text: '없음' },
    { key: 'mom',  label: '전월 대비 (월별 추이)',        text: '월별로 나눠 전월 대비 증감 컬럼을 함께 보여줘 (비율이면 %p 차이)' },
    { key: 'prev', label: '직전 같은 길이의 기간 대비',    text: '직전 같은 길이의 기간과 비교해 증감 컬럼을 함께 보여줘' },
    { key: 'avg',  label: '전체 평균 대비',               text: '전체 평균과의 차이 컬럼을 함께 보여줘' },
    { key: 'rank', label: '값이 큰 순서로 순위 비교',      text: '값이 큰 순서로 정렬하고 순위 컬럼을 함께 보여줘' }
  ];
  // 분자 · 분모. def 는 질문 문장에 같이 적혀 AI 가 같은 뜻으로 센다.
  var NUMS = {
    fail1:   { ko: '첫 시도 fail 건수',    def: "attempt = 1, result = 'fail'" },
    retry:   { ko: '재시험 진행 건수',     def: "첫 시도가 fail 인 (lot_id, test_item) 중 attempt = 2 행이 있는 건" },
    pass2:   { ko: '재시험 pass 건수',     def: "attempt = 2, result = 'pass'" },
    failAll: { ko: 'fail 건수(모든 시도)', def: "result = 'fail', attempt 조건 없음" },
    defect:  { ko: '불량 수량 합계',       def: 'defect_qty 의 합, attempt = 1' }
  };
  var DENS = {
    try1:   { ko: '첫 시도 시험 건수',     def: 'attempt = 1' },
    fail1:  { ko: '첫 시도 fail 건수',     def: "attempt = 1, result = 'fail'" },
    try2:   { ko: '재시험 시험 건수',      def: 'attempt = 2' },
    tryAll: { ko: '전체 시험 건수(모든 시도)', def: 'attempt 조건 없음' }
  };
  var COMBOS = [
    { id: 'fail',  name: '첫 시도 fail률', num: 'fail1', den: 'try1' },
    { id: 'retry', name: '재시험률',       num: 'retry', den: 'fail1' },
    { id: 'pass',  name: '재시험 통과율',  num: 'pass2', den: 'try2' }
  ];
  var DEFAULT_STEPS = [];

  function comboOf(num, den) { return COMBOS.filter(function (c) { return c.num === num && c.den === den; })[0] || null; }

  // ---- 날짜 ----
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function addMonths(iso, n) {
    var p = iso.split('-').map(Number);
    var t = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    var last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(p[2], last));
  }
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  // ---- 문장 만들기 (순수 함수) ----
  // state: { from, to, dims:[key], step:'*'|값, cmp, num, den }
  function compose(st) {
    if (!ISO.test(st.from || '') || !ISO.test(st.to || '')) return { error: '기간(FROM, TO)을 정해 주세요.' };
    if (st.from > st.to) return { error: '시작일(FROM)이 종료일(TO)보다 늦습니다.' };
    var N = NUMS[st.num], D = DENS[st.den];
    if (!N || !D) return { error: '정의의 분자와 분모를 골라 주세요.' };

    var on = DIMS.filter(function (d) { return st.dims.indexOf(d.key) >= 0; });
    var stepFixed = st.dims.indexOf('step') >= 0 && st.step && st.step !== '*' ? st.step : null;
    var groups = on.filter(function (d) { return !(d.key === 'step' && stepFixed); });
    var bits = [];
    if (groups.length) bits.push(groups.map(function (d) { return d.ko + '(' + d.col + ')'; }).join(', ') + '별로 나눠서');
    if (stepFixed) bits.push("공정(step) = '" + stepFixed + "' 공정만");
    var basis = bits.length ? bits.join(', ') : '나누지 않고 전체로';

    var combo = comboOf(st.num, st.den);
    var label = combo ? combo.name : N.ko + ' ÷ ' + D.ko + ' 비율';
    var cmp = CMPS.filter(function (c) { return c.key === st.cmp; })[0] || CMPS[0];

    var lines = [
      '기간: ' + st.from + ' ~ ' + st.to + ' (양 끝 날짜 포함, 시험일 test_date 기준)',
      '기준: ' + basis,
      '비교: ' + cmp.text,
      '정의: ' + label + ' = ' + N.ko + '(' + N.def + ') ÷ ' + D.ko + '(' + D.def + ')',
      '위 조건으로 구해줘.'
    ];
    var warn = '';
    var hasEquip = st.dims.some(function (k) { return k === 'equip_id' || k === 'equip_type' || k === 'vendor'; });
    if (hasEquip && st.dims.indexOf('step') < 0) warn = '설비로 나눌 때는 «공정»을 한 공정으로 정해 두면 같은 시험이 여러 공정에 겹쳐 세어지지 않아 더 정확합니다.';
    return { text: lines.join('\n'), warn: warn };
  }

  // ---- 실측 (사전 점검용) ----
  // 고른 기간 · 정의로 지금 올라와 있는 데이터를 세어 본 값. 나누기(기준) 전의 전체 기준이다. 집계 숫자만 만들고 행은 읽어 내보내지 않는다.
  async function facts(st) {
    var Db = root.Db;
    if (!Db || Db.state !== 'ready' || !ISO.test(st.from || '') || !ISO.test(st.to || '') || st.from > st.to) return null;
    var w = "test_date >= DATE '" + st.from + "' AND test_date <= DATE '" + st.to + "'";
    var wa = w.replace(/test_date/g, 'a.test_date');
    var r = await Db.query("SELECT COUNT(*), COUNT(*) FILTER (WHERE attempt = 1), COUNT(*) FILTER (WHERE attempt = 1 AND result = 'fail'), " +
      "COUNT(*) FILTER (WHERE attempt = 2), COUNT(*) FILTER (WHERE attempt = 2 AND result = 'pass'), COUNT(*) FILTER (WHERE result = 'fail'), " +
      "COALESCE(SUM(defect_qty) FILTER (WHERE attempt = 1), 0) FROM test_results WHERE " + w);
    var v = r.rows[0].map(Number);
    var vals = { all: v[0], try1: v[1], fail1: v[2], try2: v[3], pass2: v[4], failAll: v[5], defect: v[6] };
    var rr = await Db.query("SELECT COUNT(*) FROM test_results a WHERE a.attempt = 1 AND a.result = 'fail' AND " + wa +
      " AND EXISTS (SELECT 1 FROM test_results b WHERE b.lot_id = a.lot_id AND b.test_item = a.test_item AND b.attempt = 2)");
    vals.retry = Number(rr.rows[0][0]);
    var N = NUMS[st.num], D = DENS[st.den];
    var nv = vals[st.num], dv = st.den === 'tryAll' ? vals.all : vals[st.den];
    var out = {
      period: { from: st.from, to: st.to },
      tests_all: vals.all, first_try: vals.try1,
      numerator: { name: N.ko, value: nv }, denominator: { name: D.ko, value: dv },
      ratio_percent: dv > 0 ? Math.round(nv / dv * 1000) / 10 : null
    };
    var hasEquip = st.dims.some(function (k) { return k === 'equip_id' || k === 'equip_type' || k === 'vendor'; });
    if (hasEquip && st.dims.indexOf('step') < 0) {
      var j = await Db.query("SELECT COUNT(*) FROM test_results t JOIN process_runs p ON p.lot_id = t.lot_id WHERE t.attempt = 1 AND " + w.replace(/test_date/g, 't.test_date'));
      var after = Number(j.rows[0][0]);
      out.join_without_step = { rows_before: vals.try1, rows_after: after, multiplier: vals.try1 > 0 ? Math.round(after / vals.try1 * 10) / 10 : null };
    }
    return out;
  }

  // ---- 화면 ----
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function init() {
    var host = document.getElementById('builder'), q = document.getElementById('q-input');
    if (!host || !q) return;
    var st = { from: '', to: '', dims: ['test_item'], step: '*', cmp: 'none', num: 'fail1', den: 'try1' };
    var dirty = false, touchedDates = false, steps = DEFAULT_STEPS.slice();

    var from = el('input'), to = el('input');
    from.type = 'date'; to.type = 'date';
    from.setAttribute('aria-label', '기간 시작일(FROM)'); to.setAttribute('aria-label', '기간 종료일(TO)');
    var dateHint = el('p', 'muted small b-hint', '');

    var chips = el('div', 'chip-row'), dimBoxes = {};
    var stepSel = el('select'); stepSel.setAttribute('aria-label', '공정 값');
    var stepWrap = el('label', 'ctl-field b-step'); stepWrap.appendChild(el('span', 'ctl-lbl', '공정(step) 값')); stepWrap.appendChild(stepSel);

    var cmpSel = el('select'); cmpSel.setAttribute('aria-label', '비교');
    var comboSel = el('select'), numSel = el('select'), denSel = el('select');
    comboSel.setAttribute('aria-label', '정의 조합'); numSel.setAttribute('aria-label', '분자'); denSel.setAttribute('aria-label', '분모');

    function opt(sel, v, t) { var o = el('option', null, t); o.value = v; sel.appendChild(o); }
    CMPS.forEach(function (c) { opt(cmpSel, c.key, c.label); });
    COMBOS.forEach(function (c) { opt(comboSel, c.id, c.name + ' = ' + NUMS[c.num].ko + ' ÷ ' + DENS[c.den].ko); });
    opt(comboSel, 'custom', '직접 고르기');
    Object.keys(NUMS).forEach(function (k) { opt(numSel, k, NUMS[k].ko); });
    Object.keys(DENS).forEach(function (k) { opt(denSel, k, DENS[k].ko); });

    DIMS.forEach(function (d) {
      var chip = el('label', 'chip');
      var cb = document.createElement('input'); cb.type = 'checkbox'; dimBoxes[d.key] = cb;
      cb.addEventListener('change', function () {
        st.dims = DIMS.map(function (x) { return x.key; }).filter(function (k) { return dimBoxes[k].checked; });
        sync();
      });
      chip.appendChild(cb); chip.appendChild(el('span', null, d.ko + ' (' + d.col + ')'));
      chips.appendChild(chip);
    });

    function section(title, hint) {
      var s = el('div', 'b-sec');
      s.appendChild(el('div', 'b-title', title));
      if (hint) s.appendChild(el('p', 'muted small', hint));
      return s;
    }
    function field(label, node) { var f = el('label', 'ctl-field'); f.appendChild(el('span', 'ctl-lbl', label)); f.appendChild(node); return f; }

    var card = el('div', 'builder-card');
    var s1 = section('기간', '질문에 쓸 시험일(test_date) 범위입니다. 기본값은 데이터에서 가장 최근 날짜 기준 3달입니다.');
    var r1 = el('div', 'b-row'); r1.appendChild(field('FROM', from)); r1.appendChild(el('span', 'b-tilde', '~')); r1.appendChild(field('TO', to));
    s1.appendChild(r1); s1.appendChild(dateHint);
    var s2 = section('기준', '무엇별로 나눠 볼지 고릅니다(여러 개 가능). 아무것도 고르지 않으면 전체 하나의 값입니다.');
    s2.appendChild(chips); s2.appendChild(stepWrap);
    var s3 = section('비교', '결과에 함께 보여 줄 비교 방식을 고릅니다.');
    s3.appendChild(field('비교 방식', cmpSel));
    var s4 = section('정의', '비율의 분자와 분모를 고릅니다. 자주 쓰는 조합을 고르면 분자·분모가 채워집니다.');
    var r4 = el('div', 'b-row'); r4.appendChild(field('조합', comboSel)); r4.appendChild(field('분자', numSel)); r4.appendChild(el('span', 'b-tilde', '÷')); r4.appendChild(field('분모', denSel));
    s4.appendChild(r4);
    [s1, s2, s3, s4].forEach(function (s) { card.appendChild(s); });

    var bar = el('div', 'b-bar');
    var rebuild = el('button', 'btn small-btn', '문장 다시 만들기'); rebuild.type = 'button';
    var msg = el('span', 'muted small b-msg'); msg.setAttribute('role', 'status');
    bar.appendChild(rebuild); bar.appendChild(msg);
    card.appendChild(bar);
    host.appendChild(card);

    function fillSteps() {
      var cur = st.step;
      stepSel.textContent = '';
      opt(stepSel, '*', '공정별로 나눠서 (전체)');
      steps.forEach(function (s) { opt(stepSel, s, s + ' 공정만'); });
      stepSel.value = steps.indexOf(cur) >= 0 || cur === '*' ? cur : '*';
      st.step = stepSel.value;
    }

    // 화면 값 → 문장. 직접 고친 문장이 있으면 덮어쓰지 않는다.
    function write(force) {
      var r = compose(st);
      msg.textContent = '';
      msg.className = 'muted small b-msg';
      if (r.error) { msg.textContent = r.error; msg.className = 'small b-msg warn'; return; }
      if (dirty && !force) { msg.textContent = '직접 고친 문장이라 옵션을 바꿔도 덮어쓰지 않습니다. 옵션대로 다시 쓰려면 «문장 다시 만들기»를 누르세요.'; return; }
      q.value = r.text;
      dirty = false;
      root.Builder.current = { state: JSON.parse(JSON.stringify(st)), text: r.text };
      q.dispatchEvent(new CustomEvent('builder-write'));   // 이전 점검 · 최종 결정을 무효로 한다
      msg.textContent = r.warn || '옵션대로 문장을 만들었습니다. 필요하면 질문 칸에서 고친 뒤 «SQL 만들기»를 누르세요.';
      if (r.warn) msg.className = 'small b-msg warn';
    }

    function sync() {
      from.value = st.from; to.value = st.to;
      DIMS.forEach(function (d) { dimBoxes[d.key].checked = st.dims.indexOf(d.key) >= 0; });
      stepWrap.hidden = st.dims.indexOf('step') < 0;
      cmpSel.value = st.cmp; numSel.value = st.num; denSel.value = st.den;
      var c = comboOf(st.num, st.den); comboSel.value = c ? c.id : 'custom';
      write(false);
    }

    from.addEventListener('change', function () { st.from = from.value; touchedDates = true; sync(); });
    to.addEventListener('change', function () { st.to = to.value; touchedDates = true; sync(); });
    stepSel.addEventListener('change', function () { st.step = stepSel.value; sync(); });
    cmpSel.addEventListener('change', function () { st.cmp = cmpSel.value; sync(); });
    numSel.addEventListener('change', function () { st.num = numSel.value; sync(); });
    denSel.addEventListener('change', function () { st.den = denSel.value; sync(); });
    comboSel.addEventListener('change', function () {
      var c = COMBOS.filter(function (x) { return x.id === comboSel.value; })[0];
      if (c) { st.num = c.num; st.den = c.den; }
      sync();
    });
    rebuild.addEventListener('click', function () { write(true); });
    q.addEventListener('input', function () { dirty = true; msg.textContent = '직접 고친 문장입니다. 옵션을 바꿔도 덮어쓰지 않습니다.'; msg.className = 'muted small b-msg'; });

    // 데이터의 가장 최근 날짜 기준으로 기본 기간(3달)과 공정 값을 채운다.
    async function loadFromData() {
      if (!root.Db || root.Db.state !== 'ready') return;
      try {
        var r = await root.Db.query('SELECT MIN(test_date), MAX(test_date) FROM test_results');
        var mn = r.rows[0] && r.rows[0][0], mx = r.rows[0] && r.rows[0][1];
        if (mn && mx) {
          dateHint.textContent = '지금 올라와 있는 시험 데이터 범위: ' + mn + ' ~ ' + mx;
          root.Builder.range = { min: String(mn).slice(0, 10), max: String(mx).slice(0, 10) };
          if (!touchedDates) { st.to = String(mx).slice(0, 10); st.from = addMonths(st.to, -3); }
        }
      } catch (e) { dateHint.textContent = ''; }
      try {
        var s = await root.Db.query('SELECT DISTINCT step FROM process_runs ORDER BY step');
        steps = s.rows.map(function (x) { return String(x[0]); });
      } catch (e) { /* 공정 값은 못 읽어도 "공정별로 나눠서"는 쓸 수 있다 */ }
      fillSteps();
      sync();
    }
    fillSteps();
    sync();
    root.addEventListener('db-status', function (e) { if (e.detail && e.detail.state === 'ready') loadFromData(); });
    root.addEventListener('data-changed', loadFromData);
    loadFromData();
  }

  root.Builder = { range: null, current: null, facts: facts, compose: compose, addMonths: addMonths, DIMS: DIMS, CMPS: CMPS, NUMS: NUMS, DENS: DENS, COMBOS: COMBOS };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
