"""POST /api/why  {question, sql, columns, rows}  →  {cause_sql, cause_note, value_col, label_cols}

원래 결과를 한 번 더 쪼개는 SQL 하나를 AI 가 쓴다. 숫자(가장 큰 덩어리와 비중)는 AI 가 말하지 않고 브라우저가 계산한다.
AI 에는 질문 · SQL · 테이블 설명 · 집계 결과 50행 이하만 보낸다. 원본 행은 보내지 않는다.
"""
import json
from http.server import BaseHTTPRequestHandler

try:
    from api import _common as c
except ImportError:  # Vercel 처럼 api/ 안에서 바로 실행될 때
    import _common as c

SYSTEM = """너는 DuckDB SQL 을 쓰는 데이터 분석 도우미다. 사용자의 질문, 이미 실행한 SQL 과 그 결과(최대 50행)를 받아
결과를 한 단계 쪼개는 SQL 하나를 쓴다. 아래 schema 의 테이블만 쓴다.

규칙:
- SELECT 또는 WITH 로 시작하는 문장 하나만 쓴다. 쓰기, DDL, 파일 읽기 함수는 쓰지 않는다. 문장 끝 세미콜론은 붙이지 않는다.
- tables 중 "uploaded": true 인 것은 사용자가 올린 파일의 테이블이다. 컬럼 뜻이 없으니 이름과 타입만 보고 판단하고, 이름에 한글이나 특수문자가 있으면 큰따옴표로 감싼다.
- 원래 SQL 과 같은 기간, 같은 조건, 같은 지표 정의로 쪼갠다. 바뀌는 것은 묶는 단위(GROUP BY)뿐이다.
- 질문에 쪼갤 기준이 있으면(예: 시험 항목별, 식각 설비별) 그 기준대로 쪼갠다. 없으면 test_item 별로 쪼갠다.
- '식각 설비별'처럼 공정의 설비로 쪼갤 때는 process_runs 에서 step = '식각' 인 행을 로트당 한 행만 붙인다((lot_id, step)은 유일하다).
  test_results 를 process_runs 와 lot_id 만으로 조인하면 행이 4배로 불어나므로, 반드시 step 조건으로 한 공정만 붙인다.
- 쪼갠 결과에는 합산할 수 있는 건수나 수량 컬럼(예: fail 건수)을 반드시 넣는다. 비율 컬럼을 같이 넣어도 되지만, 가장 큰 덩어리는 이 건수 컬럼으로 찾는다.
- 결과는 그 건수 컬럼의 내림차순으로 정렬하고 LIMIT 50 이하로 한다.
- 결과 컬럼에는 사람이 읽을 수 있는 한국어 별칭을 붙인다. 비율은 소수 넷째 자리까지 ROUND 한다.
- cause_note 는 어떻게 쪼갰는지만 한두 문장으로 쓴다. 원인을 추측하거나 숫자를 지어내지 않는다.

답은 JSON 객체 하나로만 한다:
{"cause_sql": "<쪼개기 SQL>",
 "cause_note": "<어떤 기준으로 쪼갰는지>",
 "value_col": "<합산할 건수 컬럼의 별칭. cause_sql 결과에 있는 글자 그대로>",
 "label_cols": ["<구분을 나타내는 컬럼의 별칭들. cause_sql 결과에 있는 글자 그대로>"]}

schema:
"""

MAX_COLS = 40
MAX_CELL = 100


def cell(v):
    if v is None or isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    return str(v)[:MAX_CELL]


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = c.read_json_body(self)
            if not isinstance(body, dict):
                raise c.ApiError(400, "요청 형식이 올바르지 않습니다.")
            question = body.get("question")
            sql = body.get("sql")
            columns = body.get("columns")
            rows = body.get("rows")
            if not isinstance(question, str) or not question.strip() or len(question) > 1500:
                raise c.ApiError(400, "question 이 비었거나 너무 깁니다.")
            if not isinstance(sql, str) or not sql.strip() or len(sql) > 20000:
                raise c.ApiError(400, "sql 이 비었거나 너무 깁니다.")
            if not isinstance(columns, list) or len(columns) > MAX_COLS or not all(isinstance(x, str) for x in columns):
                raise c.ApiError(400, "columns 형식이 올바르지 않습니다.")
            if not isinstance(rows, list) or not all(isinstance(r, list) for r in rows):
                raise c.ApiError(400, "rows 형식이 올바르지 않습니다.")
            rows = [[cell(v) for v in r[:MAX_COLS]] for r in c.clip_rows(rows)]  # 50행 제한을 서버에서도 건다

            user = json.dumps({"question": question.strip(), "sql": sql.strip(), "columns": columns, "rows": rows},
                              ensure_ascii=False)
            extra = c.clean_extra_tables(body.get("extra_tables"))
            out = c.call_gemini(SYSTEM + c.schema_text(c.load_schema(), extra), user)
            cause_sql = out.get("cause_sql") if isinstance(out, dict) else None
            if not isinstance(cause_sql, str) or not cause_sql.strip():
                raise c.ApiError(502, "AI 가 쪼개기 SQL 을 돌려주지 않았습니다.")
            labels = out.get("label_cols")
            c.send_json(self, 200, {
                "cause_sql": cause_sql.strip(),
                "cause_note": str(out.get("cause_note") or ""),
                "value_col": str(out.get("value_col") or ""),
                "label_cols": [str(x) for x in labels][:10] if isinstance(labels, list) else [],
            })
        except c.ApiError as e:
            c.send_json(self, e.status, {"error": e.message})
        except Exception:
            c.send_json(self, 500, {"error": "서버 오류가 났습니다."})
