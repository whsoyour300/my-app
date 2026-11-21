"""POST /api/ask  {"question": "..."}  →  {"sql": "...", "note": "...", "basis": {tables, conditions, metrics}}

질문과 테이블 설명(schema.json)만 AI 에 보낸다. 데이터 행은 보내지 않는다.
돌려받은 SQL 은 브라우저에서 sqlguard.js 검사를 거친 뒤 실행한다.
"""
from http.server import BaseHTTPRequestHandler

try:
    from api import _common as c
except ImportError:  # Vercel 처럼 api/ 안에서 바로 실행될 때
    import _common as c

SYSTEM = """너는 DuckDB SQL 을 쓰는 데이터 분석 도우미다. 아래 schema 의 테이블만 쓴다.

규칙:
- SELECT 또는 WITH 로 시작하는 문장 하나만 쓴다. 쓰기, DDL, 파일 읽기 함수는 쓰지 않는다. 문장 끝 세미콜론은 붙이지 않는다.
- schema 에 없는 테이블과 컬럼을 만들지 않는다. 컬럼 이름은 schema 와 글자 그대로 쓴다.
- tables 중 "uploaded": true 인 것은 사용자가 올린 파일의 테이블이다. 컬럼 뜻이 없으니 이름과 타입만 보고 판단하고, 이름에 한글이나 특수문자가 있으면 큰따옴표로 감싼다.
- 날짜 컬럼은 DATE 이다. 기간은 DATE '2025-12-01' 같은 날짜 값으로 비교하고 월 범위는 [시작일, 다음달 1일) 로 쓴다.
- schema.metrics 의 지표 정의와 schema.rules 를 따른다. 질문에 지표 이름이 있으면 그 정의대로 센다.
- 사용자가 기간만 말하고 기준 날짜 컬럼을 말하지 않으면 schema.rules 의 규칙에 따라 고른다.
- 결과 컬럼에는 사람이 읽을 수 있는 한국어 별칭을 붙이고, 비율은 소수 넷째 자리까지 ROUND 한다.
- 질문에 '이유', '원인', '쪼개서' 같은 말이 있어도, 아래의 «기준:» 줄이 없으면 이 SQL 은 질문이 가리키는 결과 값 자체(예: 기간 전체의 fail률)만 구한다. 쪼개기는 다음 단계에서 따로 한다.
- 질문에 '기간:', '기준:', '정의:', '비교:' 줄이 있으면 그대로 SQL 에 반영한다.
  · 기간: 양 끝 날짜를 포함한다. 시험일(test_date) >= FROM AND test_date < TO 의 다음 날.
  · 기준: 줄에 적힌 컬럼으로 GROUP BY 하고, 그 컬럼을 결과에 넣는다. '나누지 않고 전체로'이면 한 행만 구한다.
    product 는 lots, equip_id · equip_type · vendor 는 equipment, step 은 process_runs 에서 온다. 시험 쪽을 로트 × 시험 항목 단위로 먼저 집계한 뒤 조인해 행이 불어나지 않게 한다.
    설비 컬럼으로 나누는데 공정(step) 값이 정해져 있지 않으면 process_runs 를 step 별로 붙이고 step 을 결과에 함께 넣는다(같은 시험이 여러 공정에 겹쳐 세어지지 않게).
    "공정(step) = '식각' 공정만"이면 process_runs 에서 그 step 한 행만 붙인다.
  · 정의: 분자 ÷ 분모를 괄호 안의 조건대로 센다. 분모가 0 이면 NULL 로 둔다(NULLIF).
  · 비교: 요청한 비교 컬럼(전월 대비 증감, 직전 같은 길이 기간 대비, 전체 평균과의 차이, 순위)을 결과에 더한다.

답은 JSON 객체 하나로만 한다:
{"sql": "<DuckDB SQL>",
 "note": "<어떤 테이블을 어떤 조건으로 읽고 어떤 지표 정의를 썼는지 한두 문장>",
 "basis": {
   "tables": ["<SQL 이 읽는 테이블 이름 전부. WITH 로 만든 임시 이름은 제외>"],
   "conditions": ["<SQL 에 건 조건을 한 줄씩. 컬럼 이름을 그대로 써서 예: attempt = 1, test_date 2025-10-01 이상 2025-11-01 미만>"],
   "metrics": ["<쓴 지표 정의의 name. schema.metrics 의 name 을 글자 그대로. 쓰지 않았으면 빈 배열>"]
 }}

schema:
"""

MAX_BASIS_ITEMS = 20
MAX_BASIS_LEN = 200


def clean_list(v):
    if not isinstance(v, list):
        return []
    return [str(x).strip()[:MAX_BASIS_LEN] for x in v if isinstance(x, (str, int, float)) and str(x).strip()][:MAX_BASIS_ITEMS]


def clean_basis(b):
    if not isinstance(b, dict):
        return None
    return {k: clean_list(b.get(k)) for k in ("tables", "conditions", "metrics")}

MAX_QUESTION = 1500


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = c.read_json_body(self)
            q = body.get("question") if isinstance(body, dict) else None
            if not isinstance(q, str) or not q.strip():
                raise c.ApiError(400, "question 이 비어 있습니다.")
            q = q.strip()
            if len(q) > MAX_QUESTION:
                raise c.ApiError(400, "질문이 너무 깁니다(%d자 이하)." % MAX_QUESTION)
            extra = c.clean_extra_tables(body.get("extra_tables"))
            out = c.call_gemini(SYSTEM + c.schema_text(c.load_schema(), extra), q)
            sql = out.get("sql") if isinstance(out, dict) else None
            if not isinstance(sql, str) or not sql.strip():
                raise c.ApiError(502, "AI 가 SQL 을 돌려주지 않았습니다.")
            c.send_json(self, 200, {
                "sql": sql.strip(),
                "note": str(out.get("note") or ""),
                "basis": clean_basis(out.get("basis")),
            })
        except c.ApiError as e:
            c.send_json(self, e.status, {"error": e.message})
        except Exception:
            c.send_json(self, 500, {"error": "서버 오류가 났습니다."})
