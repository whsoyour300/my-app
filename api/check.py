"""POST /api/check  {question, data_range, extra_tables}  →  {issues, revised, summary}

질문 문장을 실행하기 전에 AI 가 읽고, 항목끼리(기간 · 기준 · 비교 · 정의) 또는 데이터와 어긋나는 곳(모순)이 있는지 본다.
AI 에는 질문 문장 · 테이블 설명 · 데이터 날짜 범위(최소·최대 날짜 두 개)만 보낸다. 데이터 행은 보내지 않는다.
"""
import json
import re
from http.server import BaseHTTPRequestHandler

try:
    from api import _common as c
except ImportError:  # Vercel 처럼 api/ 안에서 바로 실행될 때
    import _common as c

SYSTEM = """너는 데이터 분석 질문을 실행 전에 점검하는 검토자다. 사용자가 쓴 질문 문장을 읽고 모순이나 어긋남을 찾는다.
질문은 보통 '기간:', '기준:', '비교:', '정의:' 줄로 되어 있다. 줄이 없는 자유 문장이면 그 안에서 같은 항목을 찾아 본다.
입력에는 data_range(시험일 test_date 의 가장 이른 날짜와 가장 늦은 날짜)가 함께 온다.

점검할 것:
1. 기간: 시작이 끝보다 늦음 / 기간이 data_range 밖이거나 일부만 겹침 / 비교에 필요한 기간이 모자람
   (예: '전월 대비'인데 기간이 한 달 미만, '직전 같은 길이의 기간'이 data_range 시작보다 앞).
2. 정의: 분자와 분모의 범위가 어긋남. 예) 분자는 attempt = 2 인데 분모는 attempt = 1 이면 같은 집합이 아니라 비율이 1을 넘을 수 있다.
   schema.rules 와 schema.metrics 의 정의에 어긋나는지, 분모가 0 이 될 수 있는지도 본다.
3. 기준: 설비 컬럼(equip_id, equip_type, vendor)으로 나누는데 공정(step) 값이 정해져 있지 않으면 같은 시험이 여러 공정에 겹쳐 세어질 수 있다.
   서로 겹치는 뜻의 컬럼을 같이 고른 경우(equip_id 와 equip_type 등)도 알린다.
4. 비교: 나눌 기준이 없는데 '순위'나 '전체 평균 대비'를 요청 / 기준과 비교가 맞지 않음.
5. 문장 안에서 서로 다른 말(예: 기간 줄의 날짜와 다른 날짜를 본문에서 말함).

규칙:
- 모순이 아니라 취향이나 선택의 문제는 지적하지 않는다. 확실한 것만 적는다. 숫자를 지어내지 않는다.
- 문제가 없는 점은 적지 않는다('일치합니다', '모순 없음' 같은 항목을 만들지 않는다). 아무 문제가 없으면 issues 는 빈 배열이다.
- schema.rules 의 '기준일(기본 2026-01-30)'은 날짜를 말하지 않은 상대 표현('지난 한 달')에만 쓰는 값이다. 사용자가 날짜를 명시했으면 기준일과 달라도 지적하지 않는다. 실제 데이터 범위는 data_range 다.
- issues 의 level: "error" = 이대로면 결과가 틀리거나 비어 있음, "warn" = 주의가 필요함, "info" = 참고.
- 각 text 는 한 줄(80자 안팎)로, 무엇이 왜 어긋나는지 쓴다. 최대 8개.
- revised 는 모순을 가장 적게 고친 문장이다. 원래 문장의 형식(줄 구성)과 어투를 유지한다.
  사용자가 정해야 하는 것(예: 어떤 공정을 쓸지)은 지어내서 고치지 않고 issues 에만 적는다.
  고칠 것이 없으면 revised 는 질문 문장 그대로(한 글자도 바꾸지 말 것)로 한다.
- summary 는 점검 결과를 한 줄로 쓴다.

답은 JSON 객체 하나로만 한다:
{"issues": [{"level": "error|warn|info", "text": "<한 줄>"}],
 "revised": "<점검 뒤 문장>",
 "summary": "<한 줄 결론>"}

schema:
"""

MAX_QUESTION = 1500
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_range(raw):
    if not isinstance(raw, dict):
        return None
    lo, hi = raw.get("min"), raw.get("max")
    if isinstance(lo, str) and isinstance(hi, str) and DATE.match(lo) and DATE.match(hi):
        return {"min": lo, "max": hi}
    return None


def clean_issues(raw):
    out = []
    if not isinstance(raw, list):
        return out
    for x in raw[:8]:
        if not isinstance(x, dict):
            continue
        text = str(x.get("text") or "").strip()
        if not text:
            continue
        level = x.get("level") if x.get("level") in ("error", "warn", "info") else "warn"
        out.append({"level": level, "text": text[:240]})
    return out


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
            user = json.dumps({"question": q, "data_range": clean_range(body.get("data_range"))}, ensure_ascii=False)
            out = c.call_gemini(SYSTEM + c.schema_text(c.load_schema(), extra), user)
            if not isinstance(out, dict):
                raise c.ApiError(502, "AI 답을 읽지 못했습니다.")
            issues = clean_issues(out.get("issues"))
            revised = out.get("revised")
            if not isinstance(revised, str) or not revised.strip() or len(revised) > MAX_QUESTION:
                revised = q
            revised = revised.strip()
            if not any(i["level"] in ("error", "warn") for i in issues):
                revised = q  # 모순(error · warn)이 없으면 사용자가 쓴 문장을 그대로 쓴다. info 는 참고로만 보여 준다.
            c.send_json(self, 200, {
                "issues": issues,
                "revised": revised,
                "summary": str(out.get("summary") or "")[:200],
            })
        except c.ApiError as e:
            c.send_json(self, e.status, {"error": e.message})
        except Exception:
            c.send_json(self, 500, {"error": "서버 오류가 났습니다."})
