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
  function fmtPct(v) { return isNum(v) ? (v * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%' : String(v); }

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
        ticks: { color: muted, callback: function (v) { return isPct ? fmtPct(v) : fmtNum(v); } },
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

  function destroy(box) {
    (live.get(box) || []).forEach(function (c) { try { c.destroy(); } catch (e) {} });
    live.delete(box);
    box.textContent = '';
    box.hidden = true;
  }

  async function render(box, columns, rows, hints) {
    var seq = (seqs.get(box) || 0) + 1;
    seqs.set(box, seq);
    destroy(box);
    if (!box || !columns || !rows || !rows.length) return;
    var plan;
    try { plan = analyze(columns, rows, hints); } catch (e) { return; }
    if (!plan.charts.length) return;
    try { await load(); } catch (e) {
      if (seqs.get(box) !== seq) return;
      box.hidden = false;
      var m = document.createElement('p'); m.className = 'muted small'; m.textContent = '차트 라이브러리를 불러오지 못해 표만 보여 줍니다.'; box.appendChild(m);
      return;
    }
    if (seqs.get(box) !== seq) return;      // 그 사이 다시 계산했으면 이전 차트는 그리지 않는다
    box.hidden = false;
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
      holder.appendChild(cv); wrap.appendChild(holder); box.appendChild(wrap);
      made.push(new root.Chart(cv, cfg));
    });
    if (plan.note) { var n = document.createElement('p'); n.className = 'muted small'; n.textContent = plan.note; box.appendChild(n); }
    live.set(box, made);
  }

  root.Charts = { render: render, clear: destroy, _analyze: analyze };
})(typeof window !== 'undefined' ? window : globalThis);
