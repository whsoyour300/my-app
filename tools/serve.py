"""내 PC에서 화면(public/)과 api/ 를 함께 띄운다. 표준 라이브러리만 쓴다.

사용:  python tools/serve.py [포트]      (기본 8780)
키는 프로젝트 루트의 .env 에서 읽는다 (GEMINI_API_KEY, GEMINI_MODEL).
api/<이름>.py 는 Vercel 과 같은 방식(handler 클래스)으로 만들어 두면 /api/<이름> 으로 연결된다.
"""
import importlib
import json
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")


def load_env(path):
    """.env 의 KEY=VALUE 줄을 환경 변수로 읽는다. 이미 설정된 값은 덮어쓰지 않는다."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


class Handler(SimpleHTTPRequestHandler):
    def _api_name(self):
        path = self.path.split("?", 1)[0]
        if not path.startswith("/api/"):
            return None
        name = path[5:].strip("/")
        return name if name.replace("_", "").isalnum() and not name.startswith("_") else ""

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _dispatch(self, method):
        name = self._api_name()
        if name is None:
            return False
        try:
            mod = importlib.import_module("api." + name) if name else None
        except ImportError:
            mod = None
        fn = getattr(getattr(mod, "handler", None), "do_" + method, None) if mod else None
        if fn is None:
            self._send_json(404, {"error": "없는 api 입니다: /api/" + name})
            return True
        fn(self)  # Vercel 용 handler.do_POST 를 이 요청 객체로 그대로 실행한다
        return True

    def do_GET(self):
        if not self._dispatch("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._dispatch("POST"):
            self.send_error(405)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    load_env(os.path.join(ROOT, ".env"))
    sys.path.insert(0, ROOT)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    handler = partial(Handler, directory=PUBLIC)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as srv:
        print("화면:  http://127.0.0.1:%d" % port)
        print("AI 키: " + ("있음" if os.environ.get("GEMINI_API_KEY") else "없음 (.env 에 GEMINI_API_KEY 를 넣으세요)"))
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n종료")


if __name__ == "__main__":
    main()
