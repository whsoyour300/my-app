"""GET /api/health  →  {"ai": 키가 있는지, "model": 모델 이름}. 키 값은 돌려주지 않는다."""
from http.server import BaseHTTPRequestHandler

try:
    from api import _common as c
except ImportError:
    import _common as c


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        c.send_json(self, 200, {"ai": bool(c.api_key()), "model": c.model_name()})
