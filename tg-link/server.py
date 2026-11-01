"""
Легкий бекенд для перевірки, чи є номер телефону в Telegram.

Як працює: через ваш власний Telegram-акаунт (Telethon, MTProto) номер тимчасово
імпортується в контакти, Telegram повертає користувача (якщо він існує і його
налаштування приватності дозволяють знайти його за номером), після чого контакт
одразу видаляється.

Запуск:
    pip install -r requirements.txt
    export TG_API_ID=123456 TG_API_HASH=abcdef...   # з https://my.telegram.org
    python server.py                                 # перший запуск попросить номер і код входу
    відкрийте http://localhost:8080
"""

import json
import os
import re
import secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from telethon.errors import FloodWaitError
from telethon.sync import TelegramClient
from telethon.tl.functions.contacts import DeleteContactsRequest, ImportContactsRequest
from telethon.tl.types import InputPhoneContact

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("HOST", "127.0.0.1")

client = TelegramClient(
    str(HERE / "tg_session"),
    int(os.environ["TG_API_ID"]),
    os.environ["TG_API_HASH"],
)


def check_phone(phone: str) -> dict:
    """phone — лише цифри з кодом країни, напр. 380671234567."""
    result = client(ImportContactsRequest([
        InputPhoneContact(client_id=secrets.randbits(63), phone="+" + phone, first_name="check", last_name="")
    ]))
    if not result.users:
        return {"exists": False, "phone": phone}

    user = result.users[0]
    try:
        client(DeleteContactsRequest(id=[user]))
    except Exception:
        pass  # контакт лишиться в адресній книзі — не критично

    username = user.username or (user.usernames[0].username if getattr(user, "usernames", None) else None)
    name = " ".join(filter(None, [user.first_name, user.last_name])) or None
    return {
        "exists": True,
        "phone": phone,
        "id": user.id,
        "username": username,
        "name": name,
        # за юзернеймом посилання працює для всіх; інакше — за номером
        "link": f"https://t.me/{username}" if username else f"https://t.me/+{phone}",
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path in ("/", "/index.html"):
            body = (HERE / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == "/api/health":
            self._json(200, {"ok": True})
        elif url.path == "/api/check":
            phone = re.sub(r"\D", "", parse_qs(url.query).get("phone", [""])[0])
            if not 8 <= len(phone) <= 15:
                return self._json(400, {"error": "Некоректний номер"})
            try:
                self._json(200, check_phone(phone))
            except FloodWaitError as e:
                self._json(429, {"error": f"Забагато запитів, зачекайте {e.seconds} с"})
            except Exception as e:
                self._json(500, {"error": str(e)})
        else:
            self._json(404, {"error": "Not found"})


if __name__ == "__main__":
    client.start()  # інтерактивний вхід при першому запуску, далі сесія з файлу
    print(f"Готово: http://{HOST}:{PORT}")
    # Однопотоковий сервер навмисно: sync-клієнт Telethon не потокобезпечний.
    HTTPServer((HOST, PORT), Handler).serve_forever()
