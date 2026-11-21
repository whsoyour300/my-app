"""POST /api/insight  {question, sql, columns, rows}  →  {line}

실행 결과(집계 50행 이하)를 AI 가 한 줄로 해석한다. 원본 행은 보내지 않는다.
숫자는 결과에 있는 값만 쓰게 하고, 화면에서 한 번 더 대조한다.
"""
import json
from http.server import BaseHTTPRequestHandler

try:
    from api import _common as c
except ImportError:  # Vercel 처럼 api/ 안에서 바로 실행될 때
    import _common as c

SYSTEM = """너는 생산 · 품질 데이터의 집계 결과를 읽고 한 줄로 해석하는 도우미다.
입력은 사용자의 질문, 실행한 SQL, 결과 컬럼과 결과 행(최대 50행)이다.

규칙:
- 해석은 한 문장, 100자 이내의 한국어 한 줄로 쓴다. 줄바꿈과 목록을 쓰지 않는다.
- 결과에 있는 값만 쓴다. 숫자를 지어내거나 결과에 없는 값을 계산해서 새로 만들지 않는다(큰 쪽과 작은 쪽의 비교는 말로 한다).
- 0 과 1 사이의 비율 컬럼은 %로 바꿔 소수점 첫째 자리까지 쓴다(예: 0.0645 → 6.5%).
- 결과가 무엇인지 설명하는 문장('~의 집계 결과입니다')이 아니라, 결과에서 보이는 점(가장 크거나 작은 것, 뚜렷한 차이나 추세)을 말한다. 원인을 단정하지 않는다.
- 결과가 비어 있거나 한 값뿐이면 그 사실을 한 줄로 쓴다.

답은 JSON 객체 하나로만 한다: {"line": "<한 줄 해석>"}

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
            line = out.get("line") if isinstance(out, dict) else None
            if not isinstance(line, str) or not line.strip():
                raise c.ApiError(502, "AI 가 해석을 돌려주지 않았습니다.")
            c.send_json(self, 200, {"line": " ".join(line.split())[:200]})
        except c.ApiError as e:
            c.send_json(self, e.status, {"error": e.message})
        except Exception:
            c.send_json(self, 500, {"error": "서버 오류가 났습니다."})
