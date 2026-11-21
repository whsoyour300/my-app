// 실행 결과(columns, rows)를 차트로 그린다. 데이터는 브라우저 안에서만 쓰고 어디로도 보내지 않는다.
// 차트 종류와 묶음은 결과의 모양으로 자동으로 고르고, 준비된 질문은 questions.json 의 "charts" 로 지정할 수도 있다.
// Chart.js 는 처음 그릴 때 CDN 에서 한 번 불러온다(버전 고정).
(function (root) {
  var CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
  var MAX_LABELS = 40, MAX_SERIES = 8, MAX_CHARTS = 3;
  var COLORS = ['--accent', '#14a39b', '#e69500', '#c2336a', '#7b86b0', '#6f9f2a', '#8a5cc2', '#5b6876'];
  var RATE_NAME = /률|비율|비중|rate|ratio|pct|percent/i;
  var AVG_NAME = /평균|avg|mean|average/i;
  var TIME_LABEL_NAME = /^(연도|연|년|year|월|month|주|주차|week|일|day|분기|quarter)$/i;
  var ROWNO = '\u0000row';   // X축 '행 번호' 선택값
  var libPromise = null;
  var live = new WeakMap();   // 상자 → 그려 둔 Chart 들
  var seqs = new WeakMap();   // 상자 → 가장 최근 요청 번호(늦게 끝난 이전 요청은 버린다)

  function load() {
    if (root.Chart) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise(function (ok, fail) {
        var s = document.createElement('script');
        s.src = CDN;
        s.onload = ok;
        s.onerror = function () { libPromise = null; fail(new Error('차트 라이브러리를 불러오지 못했습니다.')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function color(i) { var c = COLORS[i % COLORS.length]; return c.charAt(0) === '-' ? cssVar(c) : c; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmtNum(v) { return isNum(v) ? v.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : String(v); }
  // 비율은 % 로, 소수점 첫째 자리까지 반올림한다.
  function fmtPct(v) { return isNum(v) ? (Math.round(v * 1000) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : String(v); }
  function fmtPctTick(v) { return isNum(v) ? (Math.round(v * 1000) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%' : String(v); }

  function colInfo(columns, rows) {
    return columns.map(function (name, i) {
      var nums = 0, other = 0, allInt = true, min = Infinity, max = -Infinity;
      rows.forEach(function (r) {
        var v = r[i];
        if (v === null || v === undefined) return;
        if (isNum(v)) { nums++; if (v % 1 !== 0) allInt = false; if (v < min) min = v; if (v > max) max = v; } else other++;
      });
      var numeric = nums > 0 && other === 0;
      var rate = numeric && min >= 0 && max <= 1 && (RATE_NAME.test(name) || (!allInt && !AVG_NAME.test(name)));
      return { name: name, numeric: numeric, rate: rate, allInt: allInt, max: numeric ? Math.max(Math.abs(min), Math.abs(max)) : 0 };
    });
  }

  function colIndex(columns, name) { return columns.indexOf(name); }

  // 앞쪽의 구분 컬럼(문자열이거나 연·월 같은 숫자)을 라벨로 쓴다.
  function labelsOf(columns, rows, info) {
    var idx = [];
    for (var i = 0; i < columns.length && idx.length < 2; i++) {
      if (!info[i].numeric || (TIME_LABEL_NAME.test(columns[i]) && info[i].allInt)) idx.push(i); else break;
    }
    return idx;
  }

  function makeLabels(rows, idx) { return rows.map(function (r) { return idx.map(function (i) { return r[i] === null || r[i] === undefined ? '' : String(r[i]); }).join(' / '); }); }
  function looksTime(labels) { return labels.length > 1 && labels.every(function (l) { return /^\d{4}([-/.]\d{1,2}){1,2}/.test(l) || /^\d{4}$/.test(l); }); }

  function dataOf(rows, i) { return rows.map(function (r) { return isNum(r[i]) ? r[i] : null; }); }

  // 자동: 비율 컬럼끼리, 값(건수 등)은 크기가 10배 넘게 다르면 따로 묶는다.
  function autoGroups(series) {
    var groups = [];
    var rates = series.filter(function (s) { return s.rate; });
    if (rates.length) groups.push({ rate: true, series: rates });
    var vals = series.filter(function (s) { return !s.rate; }).sort(function (a, b) { return b.max - a.max; });
    var cur = null;
    vals.forEach(function (s) {
      if (!cur || (s.max > 0 && cur.top / s.max > 10)) { cur = { rate: false, top: s.max, series: [] }; groups.push(cur); }
      cur.series.push(s);
    });
    return groups;
  }

  function analyze(columns, rows, hints) {
    var info = colInfo(columns, rows);
    var labelIdx = labelsOf(columns, rows, info);
    var labels, oneRow = false;
    if (labelIdx.length) labels = makeLabels(rows, labelIdx);
    else if (rows.length === 1) { oneRow = true; }
    else return { charts: [], note: '' };
    var cut = '';
    if (labels && labels.length > MAX_LABELS) { cut = '앞 ' + MAX_LABELS + '개 구분만 차트로 그립니다 (전체 ' + labels.length + '개).'; }
    var n = labels ? Math.min(labels.length, MAX_LABELS) : 0;
    var time = labels && looksTime(labels);

    function seriesOf(name, extra) {
      var i = colIndex(columns, name);
      if (i < 0 || !info[i].numeric) return null;
      return Object.assign({ name: name, i: i, rate: info[i].rate, max: info[i].max }, extra || {});
    }

    var specs = [];
    // ----- 지정한 차트 -----
    if (hints && hints.length && labels) {
      hints.forEach(function (h) {
        var ds = [];
        if (h.type === 'combo') {
          (h.bar || []).forEach(function (nm) { var s = seriesOf(nm, { kind: 'bar', axis: 'y' }); if (s) ds.push(s); });
          (h.line || []).forEach(function (nm) { var s = seriesOf(nm, { kind: 'line', axis: 'y1' }); if (s) ds.push(s); });
        } else {
          (h.y || []).forEach(function (nm) { var s = seriesOf(nm, { kind: h.type === 'line' ? 'line' : 'bar', axis: 'y' }); if (s) ds.push(s); });
        }
        if (ds.length) specs.push({ title: h.title || ds.map(function (s) { return s.name; }).join(' · '), series: ds, percent: ds.every(function (s) { return s.rate; }) });
      });
      if (specs.length) return finish(specs);
    }

    // ----- 자동 -----
    var series = [];
    for (var i = 0; i < columns.length && series.length < MAX_SERIES; i++) {
      if (labelIdx.indexOf(i) >= 0 || !info[i].numeric) continue;
      series.push({ name: columns[i], i: i, rate: info[i].rate, max: info[i].max });
    }
    if (!series.length) return { charts: [], note: '' };
    if (oneRow) {
      // 한 행: 컬럼 이름이 가로축. 같은 종류끼리만 그린다.
      if (series.length < 2) return { charts: [], note: '' };
      autoGroups(series).forEach(function (g) {
        if (g.series.length < 2) return;
        specs.push({ title: g.series.map(function (s) { return s.name; }).join(' · '), oneRow: true, series: g.series.map(function (s) { return Object.assign({}, s, { kind: 'bar', axis: 'y' }); }), percent: g.rate });
      });
      return finish(specs);
    }
    autoGroups(series).forEach(function (g) {
      specs.push({ title: g.series.map(function (s) { return s.name; }).join(' · '), series: g.series.map(function (s) { return Object.assign({}, s, { kind: time ? 'line' : 'bar', axis: 'y' }); }), percent: g.rate });
    });
    return finish(specs);

    function finish(list) {
      var dropped = list.length > MAX_CHARTS ? list.length - MAX_CHARTS : 0;
      list = list.slice(0, MAX_CHARTS);
      list.forEach(function (sp) {
        sp.labels = sp.oneRow ? sp.series.map(function (s) { return s.name; }) : (labels || []).slice(0, n);
        sp.series.forEach(function (s) { s.data = sp.oneRow ? [rows[0][s.i]] : dataOf(rows, s.i).slice(0, n); });
        sp.time = !!time;
      });
      var note = cut;
      if (dropped) note += (note ? ' ' : '') + '차트는 ' + MAX_CHARTS + '개까지만 그립니다. 나머지는 표에서 확인하세요.';
      return { charts: list, note: note };
    }
  }

  function chartConfig(sp) {
    var fg = cssVar('--fg'), muted = cssVar('--muted'), line = cssVar('--line');
    var fmt = sp.percent ? fmtPct : fmtNum;
    var horizontal = !sp.time && sp.series.every(function (s) { return s.kind === 'bar'; }) && !sp.oneRow &&
      (sp.labels.length > 8 || sp.labels.some(function (l) { return l.length > 12; }));
    var datasets;
    if (sp.oneRow) {
      datasets = [{ label: sp.title, data: sp.series.map(function (s) { return s.data[0]; }), backgroundColor: sp.series.map(function (s, i) { return color(i); }), borderRadius: 6, maxBarThickness: 56 }];
    } else {
      datasets = sp.series.map(function (s, i) {
        var c = color(i), isLine = s.kind === 'line';
        return {
          type: s.kind, label: s.name, data: s.data, yAxisID: s.axis,
          borderColor: c, backgroundColor: isLine ? c : c + 'cc', borderWidth: isLine ? 2.5 : 0,
          pointRadius: isLine ? 3 : 0, pointHoverRadius: 5, tension: 0.25, borderRadius: isLine ? 0 : 6, maxBarThickness: 48,
          order: isLine ? 0 : 1
        };
      });
    }
    var dual = sp.series.some(function (s) { return s.axis === 'y1'; });
    function axisOf(pos, show, isPct, grid) {
      return { position: pos, beginAtZero: true, grid: { display: grid, color: line }, border: { display: false },
        ticks: { color: muted, callback: function (v) { return isPct ? fmtPctTick(v) : fmtNum(v); } },
        title: { display: show, color: muted, text: '' } };
    }
    var scales = {};
    var cat = { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true }, border: { color: line } };
    var onlyY = sp.series.filter(function (s) { return s.axis === 'y'; }), onlyY1 = sp.series.filter(function (s) { return s.axis === 'y1'; });
    if (horizontal) {
      scales.x = axisOf('bottom', false, sp.percent, true);
      scales.y = Object.assign({}, cat, { ticks: { color: fg, autoSkip: false } });
    } else {
      scales.x = cat;
      scales.y = axisOf('left', false, sp.percent || (onlyY.length > 0 && onlyY.every(function (s) { return s.rate; })), true);
      if (dual) {
        scales.y1 = Object.assign(axisOf('right', false, onlyY1.every(function (s) { return s.rate; }), false), { grid: { drawOnChartArea: false } });
        // 축이 둘이면 어느 쪽이 무엇인지 알 수 있게 축 제목을 붙인다.
        scales.y.title = { display: true, color: muted, text: onlyY.map(function (s) { return s.name; }).join(' · ') };
        scales.y1.title = { display: true, color: muted, text: onlyY1.map(function (s) { return s.name; }).join(' · ') };
      }
    }
    // 건수처럼 정수만 있는 축은 눈금도 정수로 한다(0.2 건 같은 눈금이 나오지 않게).
    function intOnly(list) { return list.length && list.every(function (s) { return s.data.every(function (v) { return v === null || v % 1 === 0; }); }); }
    if (!sp.percent && !horizontal && scales.y && intOnly(onlyY)) scales.y.ticks.precision = 0;
    if (scales.y1 && intOnly(onlyY1)) scales.y1.ticks.precision = 0;
    return {
      type: 'bar',
      data: { labels: sp.labels, datasets: datasets },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: datasets.length > 1, position: 'top', labels: { color: fg, usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: function (c) {
            var v = horizontal ? c.parsed.x : c.parsed.y;
            var s = sp.series[c.datasetIndex];
            var p = sp.percent || (s && s.rate);
            return ' ' + (c.dataset.label || '') + ': ' + (v === null || v === undefined ? '없음' : (p ? fmtPct(v) : fmtNum(v)));
          } } }
        },
        scales: scales
      },
      horizontal: horizontal
    };
  }

  function killCharts(box) {
    (live.get(box) || []).forEach(function (c) { try { c.destroy(); } catch (e) {} });
    live.delete(box);
  }
  function destroy(box) {
    killCharts(box);
    box.textContent = '';
    box.hidden = true;
  }

  // 사용자가 고른 X · Y · 유형으로 차트 계획을 만든다.
  function analyzeSel(columns, rows, sel) {
    var info = colInfo(columns, rows);
    var xi = sel.x === ROWNO ? -1 : colIndex(columns, sel.x);
    var all = rows.map(function (r, k) { return xi < 0 ? String(k + 1) : (r[xi] === null || r[xi] === undefined ? '' : String(r[xi])); });
    var cut = all.length > MAX_LABELS ? '앞 ' + MAX_LABELS + '개 구분만 차트로 그립니다 (전체 ' + all.length + '개).' : '';
    var labels = all.slice(0, MAX_LABELS);
    var time = looksTime(all);
    var line = sel.type === 'line' || (sel.type !== 'bar' && time);
    var series = [];
    (sel.y || []).forEach(function (nm) {
      var i = colIndex(columns, nm);
      if (i < 0 || i === xi || !info[i].numeric || series.length >= MAX_SERIES) return;
      series.push({ name: nm, i: i, rate: info[i].rate, max: info[i].max });
    });
    if (!series.length) return { charts: [], note: '' };
    var groups = autoGroups(series), dropped = Math.max(0, groups.length - MAX_CHARTS);
    var charts = groups.slice(0, MAX_CHARTS).map(function (g) {
      var ss = g.series.map(function (s) { return Object.assign({}, s, { kind: line ? 'line' : 'bar', axis: 'y', data: dataOf(rows, s.i).slice(0, MAX_LABELS) }); });
      return { title: ss.map(function (s) { return s.name; }).join(' · '), series: ss, percent: g.rate, labels: labels, time: line };
    });
    var note = cut;
    if (dropped) note += (note ? ' ' : '') + '차트는 ' + MAX_CHARTS + '개까지만 그립니다. 나머지는 표에서 확인하세요.';
    return { charts: charts, note: note };
  }

  async function paint(box, outEl, plan, seq) {
    killCharts(box);
    outEl.textContent = '';
    if (!plan.charts.length) {
      var e0 = document.createElement('p'); e0.className = 'muted small'; e0.textContent = 'Y축에서 숫자 컬럼을 하나 이상 고르세요.'; outEl.appendChild(e0);
      return;
    }
    try { await load(); } catch (e) {
      if (seqs.get(box) !== seq) return;
      var m = document.createElement('p'); m.className = 'muted small'; m.textContent = '차트 라이브러리를 불러오지 못해 표만 보여 줍니다.'; outEl.appendChild(m);
      return;
    }
    if (seqs.get(box) !== seq) return;      // 그 사이 다시 계산했으면 이전 차트는 그리지 않는다
    killCharts(box);                        // 위의 await 동안 다른 그리기가 끼어들었을 때 겹치지 않게
    outEl.textContent = '';
    var made = [];
    plan.charts.forEach(function (sp) {
      var cfg = chartConfig(sp);
      var wrap = document.createElement('figure'); wrap.className = 'chart-box';
      var cap = document.createElement('figcaption'); cap.textContent = sp.title; wrap.appendChild(cap);
      var holder = document.createElement('div'); holder.className = 'chart-holder';
      var rowsN = sp.labels.length * (cfg.horizontal ? Math.max(1, sp.series.length) : 1);
      holder.style.height = (cfg.horizontal ? Math.max(220, Math.min(720, rowsN * 26 + 70)) : 300) + 'px';
      var cv = document.createElement('canvas');
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', sp.title + ' 차트. 같은 값은 아래 표에 있습니다.');
      holder.appendChild(cv); wrap.appendChild(holder); outEl.appendChild(wrap);
      made.push(new root.Chart(cv, cfg));
    });
    if (plan.note) { var n = document.createElement('p'); n.className = 'muted small'; n.textContent = plan.note; outEl.appendChild(n); }
    live.set(box, made);
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  // X · Y · 유형을 고르는 줄. 컬럼 이름은 AI 나 파일에서 올 수 있으니 textContent 로만 넣는다.
  function buildControls(box, outEl, columns, rows, seq, state) {
    var info = colInfo(columns, rows);
    var ctl = el('div', 'chart-ctl');
    var xSel = el('select'), tSel = el('select'), yBox = el('div', 'chip-row');
    xSel.setAttribute('aria-label', 'X축');
    tSel.setAttribute('aria-label', '차트 유형');
    var opt = function (sel, v, t) { var o = el('option', null, t); o.value = v; sel.appendChild(o); };
    opt(xSel, ROWNO, '행 번호');
    columns.forEach(function (c) { opt(xSel, c, c); });
    [['auto', '자동'], ['bar', '막대'], ['line', '꺾은선']].forEach(function (t) { opt(tSel, t[0], t[1]); });
    xSel.value = state.x; tSel.value = state.type;

    function field(label, node) { var f = el('label', 'ctl-field'); f.appendChild(el('span', 'ctl-lbl', label)); f.appendChild(node); return f; }
    ctl.appendChild(field('X축', xSel));
    ctl.appendChild(field('유형', tSel));
    var yWrap = el('div', 'ctl-field wide'); yWrap.appendChild(el('span', 'ctl-lbl', 'Y축 (숫자 컬럼, 여러 개 선택)')); yWrap.appendChild(yBox);
    ctl.appendChild(yWrap);
    var reset = el('button', 'btn small-btn', '자동으로 되돌리기'); reset.type = 'button';
    ctl.appendChild(reset);

    function drawY() {
      yBox.textContent = '';
      columns.forEach(function (c, i) {
        if (!info[i].numeric || c === state.x) return;
        var chip = el('label', 'chip');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.y.indexOf(c) >= 0;
        cb.addEventListener('change', function () {
          state.y = state.y.filter(function (n) { return n !== c; });
          if (cb.checked) state.y.push(c);
          redraw();
        });
        chip.appendChild(cb); chip.appendChild(el('span', null, c)); yBox.appendChild(chip);
      });
      if (!yBox.childNodes.length) yBox.appendChild(el('span', 'muted small', '고를 수 있는 숫자 컬럼이 없습니다.'));
    }
    function redraw() { paint(box, outEl, analyzeSel(columns, rows, state), seq); }
    xSel.addEventListener('change', function () { state.x = xSel.value; state.y = state.y.filter(function (n) { return n !== state.x; }); drawY(); redraw(); });
    tSel.addEventListener('change', function () { state.type = tSel.value; redraw(); });
    reset.addEventListener('click', function () {
      var d = state.initial;
      state.x = d.x; state.y = d.y.slice(); state.type = 'auto'; xSel.value = state.x; tSel.value = 'auto'; drawY();
      paint(box, outEl, d.plan, seq);
    });
    drawY();
    return ctl;
  }

  // opts.controls: true 이면 X · Y · 유형을 고르는 줄을 차트 위에 붙인다(묻기 탭).
  async function render(box, columns, rows, hints, opts) {
    var seq = (seqs.get(box) || 0) + 1;
    seqs.set(box, seq);
    destroy(box);
    if (!box || !columns || !rows || !rows.length) return;
    var plan;
    try { plan = analyze(columns, rows, hints); } catch (e) { return; }
    var info = colInfo(columns, rows);
    var hasNum = info.some(function (i) { return i.numeric; });
    var withCtl = !!(opts && opts.controls) && rows.length >= 2 && hasNum;
    if (!plan.charts.length && !withCtl) return;
    box.hidden = false;
    var outEl = el('div', 'charts-out');
    if (withCtl) {
      // 처음 모양은 자동 선택 그대로. 기본 X 는 라벨이 된 첫 컬럼, 기본 Y 는 자동으로 그린 컬럼들.
      var li = labelsOf(columns, rows, info);
      var x = li.length ? columns[li[0]] : ROWNO;
      var ys = [];
      plan.charts.forEach(function (sp) { sp.series.forEach(function (s) { if (!sp.oneRow && ys.indexOf(s.name) < 0 && s.name !== x) ys.push(s.name); }); });
      if (!ys.length) info.forEach(function (c, i) { if (c.numeric && columns[i] !== x && ys.length < 3) ys.push(columns[i]); });
      var state = { x: x, y: ys.slice(), type: 'auto', initial: null };
      if (!plan.charts.length) plan = analyzeSel(columns, rows, state);
      state.initial = { x: x, y: ys.slice(), plan: plan };
      box.appendChild(buildControls(box, outEl, columns, rows, seq, state));
    }
    box.appendChild(outEl);
    await paint(box, outEl, plan, seq);
  }

  // 표에서 비율 컬럼을 %로 보여 줄 때 쓴다: 어느 컬럼이 비율인지(0~1 사이의 숫자이고 이름이 률·비율 등).
  function rateColumns(columns, rows) { return colInfo(columns, rows).map(function (i) { return i.rate; }); }

  root.Charts = { render: render, clear: destroy, rateColumns: rateColumns, _analyze: analyze };
})(typeof window !== 'undefined' ? window : globalThis);
