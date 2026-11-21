"""api 공통 도구: 환경 변수, 스키마 읽기, Gemini 호출, JSON 응답.

AI 에 보내는 것은 질문 · 테이블 설명(schema.json) · 집계 결과(최대 50행)뿐이다. 원본 행은 보내지 않는다.
표준 라이브러리만 쓴다.
"""
import json
import os
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MODEL = "gemini-3.5-flash-lite"
MAX_ROWS = 50
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def model_name():
    return (os.environ.get("GEMINI_MODEL") or "").strip() or DEFAULT_MODEL


def api_key():
    return (os.environ.get("GEMINI_API_KEY") or "").strip()


def load_schema():
    with open(os.path.join(ROOT, "public", "schema.json"), encoding="utf-8") as f:
        return json.load(f)


def clean_extra_tables(raw):
    """브라우저가 보낸 '올린 파일' 테이블 설명을 걸러 낸다. 이름 · 컬럼 이름 · 타입 · 행 수만 받고, 그 밖의 값(행 내용 등)은 버린다."""
    out = []
    if not isinstance(raw, list):
        return out
    for t in raw[:30]:
        if not isinstance(t, dict):
            continue
        name = str(t.get("name") or "").strip()[:80]
        cols = []
        for c in (t.get("columns") if isinstance(t.get("columns"), list) else [])[:200]:
            if isinstance(c, dict) and str(c.get("name") or "").strip():
                cols.append({"name": str(c["name"])[:80], "type": str(c.get("type") or "")[:30]})
        rows = t.get("rows")
        if name and cols:
            out.append({
                "name": name,
                "uploaded": True,
                "grain": "사용자가 올린 파일의 테이블 (컬럼 뜻 없음)",
                "rows": rows if isinstance(rows, int) and not isinstance(rows, bool) else None,
                "columns": cols,
            })
    return out


def schema_text(schema, extra_tables=None):
    """AI 에 보내는 테이블 설명. schema.json 하나에, 올린 파일의 테이블(이름 · 컬럼 이름 · 타입 · 행 수)만 더한다.
    같은 이름의 기본 테이블은 올린 파일 쪽으로 바꾼다(내용이 바뀌었을 수 있어 기본 설명을 쓰지 않는다)."""
    if extra_tables:
        names = {t["name"].lower() for t in extra_tables}
        schema = dict(schema)
        schema["tables"] = [t for t in schema.get("tables", []) if t["name"].lower() not in names] + extra_tables
    return json.dumps(schema, ensure_ascii=False, separators=(",", ":"))


def clip_rows(rows, limit=MAX_ROWS):
    """집계 결과를 AI 에 보내기 전에 잘라 둔다."""
    return list(rows)[:limit]


def read_json_body(h, limit=200_000):
    try:
        n = int(h.headers.get("Content-Length") or 0)
    except ValueError:
        n = 0
    if n <= 0:
        raise ApiError(400, "요청 본문이 비어 있습니다.")
    if n > limit:
        raise ApiError(413, "요청이 너무 큽니다.")
    try:
        return json.loads(h.rfile.read(n).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "JSON 형식이 아닙니다.")


def send_json(h, status, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    h.send_response(status)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    h.end_headers()
    h.wfile.write(body)


def call_gemini(system, user, timeout=40):
    """Gemini 에 한 번 묻고 JSON 으로 받은 답을 dict 로 돌려준다."""
    key = api_key()
    if not key:
        raise ApiError(503, "GEMINI_API_KEY 가 없습니다. .env 에 키를 넣고 서버를 다시 시작하세요.")
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        GEMINI_URL.format(model=model_name()),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            pass
        detail = detail.replace(key, "***")
        raise ApiError(502, "AI 호출 실패 (%s, 모델 %s): %s" % (e.code, model_name(), detail[:300]))
    except (urllib.error.URLError, TimeoutError) as e:
        raise ApiError(502, "AI 서버에 연결하지 못했습니다: %s" % str(e)[:200])
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except (KeyError, IndexError, ValueError):
        raise ApiError(502, "AI 답을 읽지 못했습니다.")
