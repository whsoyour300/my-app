// «내 파일» 탭: CSV · xlsx 를 끌어다 놓거나 골라서 이 브라우저의 DuckDB 에 테이블로 올린다.
// 올린 파일은 브라우저 밖으로 나가지 않는다. 새로고침하면 사라진다. AI 에는 테이블 이름 · 컬럼 이름 · 타입 · 행 수만 보낸다.
(function () {
  var UI = window.UI;
  var $ = function (id) { return document.getElementById(id); };
  var XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';   // 버전 고정
  var MAX_BYTES = 100 * 1024 * 1024;
  var PREVIEW_ROWS = 20;

  var uploaded = {};      // 소문자 테이블 이름 → {name, rows, columns:[{name,type}], file, kind, at}
  var queue = Promise.resolve();
  var xlsxPromise = null;

  // ---------- 이름 ----------
  // 파일 이름(확장자 뺀 것)이 테이블 이름이다. SQL 에서 바로 쓸 수 있게 글자·숫자·밑줄만 남긴다(한글 가능).
  function tableNameFrom(fileName) {
    var base = String(fileName).replace(/\.[^.]*$/, '').trim();
    var name = base.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '');
    if (!name) name = 'table';
    if (/^\p{N}/u.test(name)) name = 't_' + name;
    return name;
  }
  // 컬럼 이름의 공백(연속 포함)을 밑줄 하나로 바꾼다. 앞뒤 공백은 지운다.
  function fixColumnName(name) { return String(name).trim().replace(/\s+/g, '_'); }

  // ---------- CSV 행 수를 DuckDB 와 따로 센다 ----------
  // 따옴표 안의 줄바꿈은 한 행으로 보고, 완전히 빈 줄은 건너뛴다. 첫 줄(컬럼 이름)은 뺀다.
  function countCsvRows(text) {
    var inQ = false, records = 0, len = 0, i, c, n = text.length;
    for (i = 0; i < n; i++) {
      c = text.charCodeAt(i);
      if (c === 34) { inQ = !inQ; len++; continue; }                 // "
      if (!inQ && (c === 10 || c === 13)) {                          // \n \r
        if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
        if (len > 0) records++;
        len = 0;
        continue;
      }
      len++;
    }
    if (len > 0) records++;
    return Math.max(0, records - 1);
  }

  // ---------- xlsx → CSV 글자 ----------
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s;
    if (v instanceof Date) {
      var p = function (n) { return n < 10 ? '0' + n : String(n); };
      v = new Date(Math.round(v.getTime() / 1000) * 1000);   // 엑셀 시각을 읽을 때 생기는 1초 안팎의 오차를 가까운 초로 맞춘다
      var d = v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
      s = (v.getHours() || v.getMinutes() || v.getSeconds()) ? d + ' ' + p(v.getHours()) + ':' + p(v.getMinutes()) + ':' + p(v.getSeconds()) : d;
    } else s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function loadXlsxLib() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxPromise) {
      xlsxPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = XLSX_URL;
        s.onload = resolve;
        s.onerror = function () { xlsxPromise = null; reject(new Error('엑셀 읽기 라이브러리(SheetJS)를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  // 첫 시트의 첫 행을 컬럼 이름으로 본다. 완전히 빈 행은 건너뛴다.
  async function xlsxToCsv(file) {
    await loadXlsxLib();
    var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('엑셀에 시트가 없습니다.');
    var arr = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    if (!arr.length) throw new Error('첫 시트(' + wb.SheetNames[0] + ')가 비어 있습니다.');
    var width = arr.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var seen = {}, header = [];
    for (var i = 0; i < width; i++) {
      var h = arr[0][i] === null || arr[0][i] === undefined ? '' : String(arr[0][i]).trim();
      if (!h) h = 'column_' + (i + 1);
      var key = h.toLowerCase(), k = 2, base = h;
      while (seen[key]) { h = base + '_' + k++; key = h.toLowerCase(); }
      seen[key] = 1;
      header.push(h);
    }
    var lines = [header.map(csvCell).join(',')];
    var data = arr.slice(1);
    data.forEach(function (r) {
      var row = [];
      for (var j = 0; j < width; j++) row.push(csvCell(r[j]));
      lines.push(row.join(','));
    });
    return { csv: lines.join('\n'), rows: data.length, sheet: wb.SheetNames[0], sheets: wb.SheetNames.length };
  }

  // ---------- 한 파일 처리 ----------
  async function processFile(file) {
    var ext = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx') throw new Error('CSV(.csv)와 엑셀(.xlsx)만 올릴 수 있습니다.');
    if (file.size > MAX_BYTES) throw new Error('파일이 너무 큽니다(100MB 초과).');
    var table = tableNameFrom(file.name);
    var info = { file: file.name, kind: ext === 'csv' ? 'CSV' : 'xlsx', table: table, notes: [] };
    if (table.toLowerCase() !== String(file.name).replace(/\.[^.]*$/, '').toLowerCase()) {
      info.notes.push('파일 이름 "' + file.name.replace(/\.[^.]*$/, '') + '" 에 글자·숫자·밑줄 외의 문자가 있어 테이블 이름을 ' + table + ' 로 만들었습니다.');
    }

    var csv, fileRows;
    if (ext === 'csv') {
      csv = (await file.text()).replace(/^﻿/, '');                  // UTF-8, 앞의 BOM 은 무시
      fileRows = countCsvRows(csv);
    } else {
      var x = await xlsxToCsv(file);
      csv = x.csv; fileRows = x.rows;
      info.notes.push('첫 시트 "' + x.sheet + '" 의 첫 행을 컬럼 이름으로 읽었습니다.' + (x.sheets > 1 ? ' 나머지 시트 ' + (x.sheets - 1) + '개는 읽지 않았습니다.' : ''));
    }

    var existing = (await window.Db.tableNames()).some(function (n) { return n.toLowerCase() === table.toLowerCase(); });
    await window.Db.loadCsv(table, csv);
    info.replaced = existing;

    // 컬럼 이름의 공백을 밑줄로 바꾼다
    var cols = await window.Db.columns(table), used = {};
    cols.forEach(function (c) { used[c.name.toLowerCase()] = 1; });
    for (var i = 0; i < cols.length; i++) {
      var fixed = fixColumnName(cols[i].name);
      if (fixed === cols[i].name) continue;
      var cand = fixed || ('column_' + (i + 1)), k = 2;
      while (used[cand.toLowerCase()] && cand.toLowerCase() !== cols[i].name.toLowerCase()) cand = fixed + '_' + k++;
      await window.Db.renameColumn(table, cols[i].name, cand);
      delete used[cols[i].name.toLowerCase()];
      used[cand.toLowerCase()] = 1;
      info.notes.push('컬럼 이름 "' + cols[i].name + '" 의 공백을 밑줄로 바꿨습니다 → ' + cand);
    }
    info.columns = await window.Db.columns(table);
    info.fileRows = fileRows;
    info.tableRows = await window.Db.count(table);
    info.preview = await window.Db.preview(table, PREVIEW_ROWS);
    info.at = UI.stamp();
    uploaded[table.toLowerCase()] = { name: table, rows: info.tableRows, columns: info.columns, file: file.name, kind: info.kind, at: info.at };
    return info;
  }

  // ---------- 화면 ----------
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function addLog(info, err, fileName) {
    var box = el('article', 'ucard' + (err ? ' err' : ''));
    var head = el('div', 'phead');
    head.appendChild(el('h3', 'ptitle', err ? fileName : info.file + ' → ' + info.table));
    if (!err) {
      head.appendChild(el('span', 'badge', info.kind));
      if (info.replaced) head.appendChild(el('span', 'badge warn', '기존 테이블을 바꿈'));
      else head.appendChild(el('span', 'badge ok', '새 테이블'));
    }
    box.appendChild(head);
    if (err) {
      box.appendChild(el('p', 'warn', '올리지 못했습니다. ' + err));
      $('upload-log').insertBefore(box, $('upload-log').firstChild);
      return;
    }
    var same = info.fileRows === info.tableRows;
    var line = el('p', 'ucount');
    line.appendChild(document.createTextNode('파일에서 읽은 행 수 '));
    line.appendChild(el('b', null, info.fileRows.toLocaleString('ko-KR')));
    line.appendChild(document.createTextNode('  ·  테이블에 올라간 행 수 '));
    line.appendChild(el('b', null, info.tableRows.toLocaleString('ko-KR')));
    line.appendChild(el('span', 'mark ' + (same ? 'ok' : 'bad'), same ? ' ✓' : ' ✕'));
    box.appendChild(line);
    box.appendChild(el('p', 'muted small', '컬럼 ' + info.columns.length + '개: ' + info.columns.map(function (c) { return c.name + ' (' + c.type + ')'; }).join(', ')));
    if (info.notes.length) {
      var ul = el('ul', 'pnotes');
      info.notes.forEach(function (n) { ul.appendChild(el('li', null, n)); });
      box.appendChild(ul);
    }
    var det = el('details');
    det.open = true;
    det.appendChild(el('summary', null, '처음 ' + Math.min(PREVIEW_ROWS, info.preview.rows.length) + '행 미리 보기'));
    var tw = el('div', 'tw prev');
    UI.renderTable(tw, info.preview.columns, info.preview.rows, PREVIEW_ROWS);
    det.appendChild(tw);
    box.appendChild(det);
    $('upload-log').insertBefore(box, $('upload-log').firstChild);
  }

  function setStatus(t, cls) { var s = $('upload-status'); s.textContent = t; s.className = cls || 'muted'; }

  function handle(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    setStatus('읽는 중… (' + files.length + '개)');
    queue = queue.then(async function () {
      var ok = 0, fail = 0, names = [];
      for (var i = 0; i < files.length; i++) {
        setStatus('읽는 중… (' + (i + 1) + '/' + files.length + ') ' + files[i].name);
        try {
          var info = await processFile(files[i]);
          addLog(info);
          names.push(info.table);
          ok++;
        } catch (e) {
          addLog(null, (e && e.message) ? e.message : String(e), files[i].name);
          fail++;
        }
      }
      setStatus('끝: 올린 파일 ' + ok + '개' + (fail ? ', 실패 ' + fail + '개' : '') + '. 준비된 질문은 자동으로 다시 계산하지 않았습니다. 필요하면 «준비된 질문» 탭에서 «다시 계산»을 누르세요.', fail ? 'warn' : 'muted');
      if (ok) window.dispatchEvent(new CustomEvent('data-changed', { detail: { tables: names } }));
    });
  }

  var drop = $('dropzone'), input = $('file-input');
  input.addEventListener('change', function () { handle(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { handle(e.dataTransfer && e.dataTransfer.files); });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });   // 칸 밖에 놓아도 브라우저가 파일을 열지 않게
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  var db = $('files-db');
  function showDb(d) { db.textContent = d.state === 'ready' ? '' : d.text; input.disabled = d.state !== 'ready'; drop.classList.toggle('disabled', d.state !== 'ready'); }
  window.addEventListener('db-status', function (e) { showDb(e.detail); });
  if (window.Db) showDb({ state: window.Db.state, text: window.Db.text }); else input.disabled = true;

  // ---------- 다른 모듈이 쓰는 것 ----------
  window.Files = {
    uploaded: function () { return Object.keys(uploaded).map(function (k) { return uploaded[k]; }); },
    isUploaded: function (name) { return !!uploaded[String(name).toLowerCase()]; },
    // AI 에 보내는 설명: 이름 · 컬럼 이름 · 타입 · 행 수만. 컬럼 뜻은 없으니 보내지 않는다.
    describe: function () {
      return Object.keys(uploaded).map(function (k) {
        var u = uploaded[k];
        return { name: u.name, rows: u.rows, columns: u.columns.map(function (c) { return { name: c.name, type: c.type }; }) };
      });
    },
    // schema.json 에 올린 테이블을 더하거나(같은 이름은 바꾼다) 한 사본. 산출 근거 대조에 쓴다.
    mergedSchema: function (schema) {
      var up = window.Files.describe();
      if (!up.length) return schema;
      var names = {};
      up.forEach(function (u) { names[u.name.toLowerCase()] = 1; });
      var copy = Object.assign({}, schema);
      copy.tables = (schema.tables || []).filter(function (t) { return !names[String(t.name).toLowerCase()]; })
        .concat(up.map(function (u) { return { name: u.name, columns: u.columns, uploaded: true }; }));
      return copy;
    },
    _internals: { tableNameFrom: tableNameFrom, fixColumnName: fixColumnName, countCsvRows: countCsvRows }
  };
})();
