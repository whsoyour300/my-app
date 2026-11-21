// DuckDB-WASM(브라우저 안)에 기본 CSV 6개를 올리고 SQL 을 실행한다. 데이터는 이 브라우저를 떠나지 않는다.
// 기본 데이터: 다음달/ 의 5개 + data/equipment.csv (public/data/ 에 복사해 둔 것).
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

var TABLES = ['equipment', 'lots', 'process_runs', 'test_results', 'equipment_daily', 'maintenance_logs'];
var conn = null, db = null;
var DATE_ID = 8, TIMESTAMP_ID = 10, DECIMAL_ID = 7;

function q1(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }   // SQL 문자열 리터럴
function qi(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }   // SQL 식별자

function setStatus(state, text) {
  api.state = state;
  api.text = text;
  window.dispatchEvent(new CustomEvent('db-status', { detail: { state: state, text: text } }));
}

function cell(v, type) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  if (type && type.typeId === DATE_ID && typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  if (type && type.typeId === TIMESTAMP_ID && typeof v === 'number') return new Date(v).toISOString().replace('T', ' ').slice(0, 19);
  if (type && type.typeId === DECIMAL_ID) return Number(String(v)) / Math.pow(10, type.scale || 0);
  if (typeof v === 'object') return String(v);
  return v;
}

async function query(sql) {
  await api.ready;
  var t0 = performance.now();
  var r = await conn.query(sql);
  var fields = r.schema.fields;
  var columns = fields.map(function (f) { return f.name; });
  var rows = r.toArray().map(function (row) {
    return fields.map(function (f) { return cell(row[f.name], f.type); });
  });
  return { columns: columns, rows: rows, ms: Math.round(performance.now() - t0) };
}

var api = { state: 'loading', text: 'DuckDB 준비 중…', tables: TABLES, query: query };

// ---- 올린 파일용 (내 파일 탭). 올린 데이터는 이 브라우저 안의 DuckDB 에서만 읽는다. ----
// CSV 글자를 읽어 같은 이름의 테이블을 만든다. 이미 있으면 바꾼다. 첫 줄은 컬럼 이름이다.
api.loadCsv = async function (table, csvText) {
  await api.ready;
  var fname = 'upload_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.csv';
  await db.registerFileText(fname, csvText);
  try {
    await conn.query('CREATE OR REPLACE TABLE ' + qi(table) + ' AS SELECT * FROM read_csv_auto(' + q1(fname) + ', header=true, sample_size=-1)');
  } finally {
    try { await db.dropFile(fname); } catch (e) { /* 임시 파일 정리 실패는 무시 */ }
  }
};
api.tableNames = async function () {
  var r = await query("SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' ORDER BY table_name");
  return r.rows.map(function (x) { return String(x[0]); });
};
api.columns = async function (table) {
  var r = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='main' AND lower(table_name)=lower(" + q1(table) + ') ORDER BY ordinal_position');
  return r.rows.map(function (x) { return { name: String(x[0]), type: String(x[1]) }; });
};
api.count = async function (table) {
  var r = await query('SELECT COUNT(*) FROM ' + qi(table));
  return r.rows[0][0];
};
api.renameColumn = async function (table, from, to) {
  await api.ready;
  await conn.query('ALTER TABLE ' + qi(table) + ' RENAME COLUMN ' + qi(from) + ' TO ' + qi(to));
};
api.preview = function (table, n) { return query('SELECT * FROM ' + qi(table) + ' LIMIT ' + (n | 0)); };

api.ready = (async function () {
  setStatus('loading', 'DuckDB 준비 중…');
  var bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  var workerUrl = URL.createObjectURL(new Blob(['importScripts("' + bundle.mainWorker + '");'], { type: 'text/javascript' }));
  db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  conn = await db.connect();
  for (var i = 0; i < TABLES.length; i++) {
    var t = TABLES[i];
    var res = await fetch('data/' + t + '.csv');
    if (!res.ok) throw new Error(t + '.csv 를 읽지 못했습니다 (' + res.status + ')');
    await db.registerFileText(t + '.csv', await res.text());
    await conn.query("CREATE TABLE " + t + " AS SELECT * FROM read_csv_auto('" + t + ".csv')");
  }
  setStatus('ready', 'DuckDB 준비됨 (테이블 ' + TABLES.length + '개)');
})().catch(function (e) {
  setStatus('error', 'DuckDB 를 시작하지 못했습니다: ' + (e && e.message ? e.message : e));
  throw e;
});
api.ready.catch(function () {});
window.Db = api;
