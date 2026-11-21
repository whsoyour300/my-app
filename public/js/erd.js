// «설명서» 탭 위쪽의 연결관계 모식도. schema.json 의 relations 와 같은 내용을 SVG 로 그린다(데이터는 읽지 않는다).
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var HEAD = 30, ROW = 22, W = 250;
  // 컬럼: [이름, 키 표시]  PK = 한 행을 가리키는 키, FK = 다른 테이블을 가리키는 키
  var T = {
    lots:             { x: 300, y: 10,  icon: '📦', ko: '로트',          cols: [['lot_id', 'PK'], ['product'], ['start_date'], ['qty_in']] },
    test_results:     { x: 20,  y: 190, icon: '🧪', ko: '시험 결과',     cols: [['test_id', 'PK'], ['lot_id', 'FK'], ['test_item'], ['attempt'], ['test_date'], ['result'], ['defect_type'], ['defect_qty']] },
    process_runs:     { x: 300, y: 190, icon: '⚙️', ko: '공정 이력',     cols: [['run_id', 'PK'], ['lot_id', 'FK'], ['step'], ['equip_id', 'FK'], ['run_date'], ['qty_in']] },
    equipment:        { x: 640, y: 190, icon: '🏭', ko: '설비',          cols: [['equip_id', 'PK'], ['equip_type'], ['line'], ['vendor'], ['install_date']] },
    equipment_daily:  { x: 360, y: 400, icon: '📈', ko: '일별 센서', cols: [['equip_id', 'FK'], ['sensor_date'], ['vibration'], ['avg_temp'], ['power_kwh']] },
    maintenance_logs: { x: 640, y: 400, icon: '🔧', ko: '정비 이력',     cols: [['log_id', 'PK'], ['equip_id', 'FK'], ['log_date'], ['log_type'], ['downtime_h']] }
  };
  function h(t) { return HEAD + T[t].cols.length * ROW + 6; }
  function rowY(t, name) {
    for (var i = 0; i < T[t].cols.length; i++) if (T[t].cols[i][0] === name) return T[t].y + HEAD + i * ROW + ROW / 2;
  }
  function e(tag, attrs, text, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function draw(svg) {
    var gl = e('g', {}, undefined, svg), gb = e('g', {}, undefined, svg);
    function line(d, from, to) {                       // 선 + 양 끝의 1 / N 표시
      e('path', { d: d, 'class': 'erd-line' }, undefined, gl);
      if (from) e('text', { x: from[0], y: from[1], 'class': 'erd-card' }, from[2], gl);
      if (to) e('text', { x: to[0], y: to[1], 'class': 'erd-card' }, to[2], gl);
    }
    function mid(x, y, s) { e('text', { x: x, y: y, 'class': 'erd-label', 'text-anchor': 'middle' }, s, gl); }

    // lots 1 : 4 process_runs (lot_id)
    var lx = T.lots.x + W / 2;
    line('M' + lx + ' ' + (T.lots.y + h('lots')) + ' V' + T.process_runs.y, [lx + 8, T.lots.y + h('lots') + 16, '1'], [lx + 8, T.process_runs.y - 8, '4']);
    mid(lx - 30, (T.lots.y + h('lots') + T.process_runs.y) / 2 + 4, 'lot_id');
    // lots 1 : 4~8 test_results (lot_id)
    var tx = T.test_results.x + W / 2, ly = T.lots.y + HEAD + ROW / 2;
    line('M' + T.lots.x + ' ' + ly + ' H' + tx + ' V' + T.test_results.y, [T.lots.x - 14, ly - 8, '1'], [tx + 8, T.test_results.y - 8, '4~8']);
    mid((T.lots.x + tx) / 2 + 20, ly - 8, 'lot_id');
    // process_runs N : 1 equipment (equip_id)
    var py = rowY('process_runs', 'equip_id'), ey = rowY('equipment', 'equip_id'), px = T.process_runs.x + W, mx = (px + T.equipment.x) / 2;
    line('M' + px + ' ' + py + ' H' + mx + ' V' + ey + ' H' + T.equipment.x, [px + 6, py - 6, 'N'], [T.equipment.x - 12, ey - 6, '1']);
    mid(mx, (py + ey) / 2 - 22, 'equip_id');
    // equipment 1 : N equipment_daily, maintenance_logs (equip_id)
    var qx = T.equipment.x + W / 2, qy = T.equipment.y + h('equipment'), dx = T.equipment_daily.x + W / 2, by = T.equipment_daily.y;
    line('M' + qx + ' ' + qy + ' V' + (qy + 36) + ' H' + dx + ' V' + by, [qx + 8, qy + 16, '1'], [dx + 8, by - 8, 'N']);
    line('M' + qx + ' ' + (qy + 36) + ' V' + by, null, [qx + 8, by - 8, 'N']);
    mid((qx + dx) / 2, qy + 30, 'equip_id');

    Object.keys(T).forEach(function (n) {
      var t = T[n], g = e('a', { 'class': 'erd-box', 'data-go': n, tabindex: '0', role: 'link', 'aria-label': n + ' 테이블로 이동' }, undefined, gb);
      e('rect', { x: t.x, y: t.y, width: W, height: h(n), rx: 8, 'class': 'erd-body' }, undefined, g);
      e('path', { d: 'M' + t.x + ' ' + (t.y + HEAD) + ' V' + (t.y + 8) + ' a8 8 0 0 1 8 -8 H' + (t.x + W - 8) + ' a8 8 0 0 1 8 8 V' + (t.y + HEAD) + ' Z', 'class': 'erd-head' }, undefined, g);
      e('text', { x: t.x + 10, y: t.y + 21, 'class': 'erd-icon' }, t.icon, g);
      e('text', { x: t.x + 34, y: t.y + 20, 'class': 'erd-name' }, n, g);
      e('text', { x: t.x + W - 12, y: t.y + 20, 'class': 'erd-ko', 'text-anchor': 'end' }, t.ko, g);
      t.cols.forEach(function (c, i) {
        var y = t.y + HEAD + i * ROW + ROW / 2 + 5;
        e('text', { x: t.x + 12, y: y, 'class': 'erd-col' + (c[1] ? ' key' : '') }, c[0], g);
        if (c[1]) e('text', { x: t.x + W - 12, y: y, 'class': 'erd-tag ' + c[1].toLowerCase(), 'text-anchor': 'end' }, c[1], g);
      });
    });
  }

  // 우하단 범례: 처음 보는 사람을 위한 용어 설명(흐리고 작게)
  function legend(svg) {
    var L = ['PK(기본키): 한 행을 딱 하나로 가리키는 값. 겹치지 않습니다.',
             'FK(외래키): 다른 테이블의 PK를 가리켜 두 테이블을 잇는 값.',
             '선 끝의 1 · N · 4 · 4~8: 그쪽 테이블에 달리는 행 수.',
             '표시는 schema.json 설명 기준이며 DB에 설정된 제약은 아닙니다.'];
    L.forEach(function (t, i) { e('text', { x: 890, y: 584 + i * 17, 'class': 'erd-legend', 'text-anchor': 'end' }, t, svg); });
  }

  function go(name) {
    var card = document.getElementById('tbl-' + name);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.classList.add('flash'); setTimeout(function () { card.classList.remove('flash'); }, 1400); }
  }

  var box = document.getElementById('erd');
  if (!box) return;
  var svg = e('svg', { viewBox: '0 0 910 650', role: 'img', 'aria-label': '테이블 연결관계 모식도: 로트가 공정 이력과 시험 결과로 이어지고, 공정 이력은 설비로, 설비는 일별 센서와 정비 이력으로 이어진다' });
  draw(svg);
  legend(svg);
  box.appendChild(svg);
  box.addEventListener('click', function (ev) { var a = ev.target.closest('[data-go]'); if (a) go(a.getAttribute('data-go')); });
  box.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { var a = ev.target.closest('[data-go]'); if (a) go(a.getAttribute('data-go')); } });
})();
