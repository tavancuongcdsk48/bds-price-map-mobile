"""Tạo user thật + lấy token để test deep-link login trên emulator."""
import json
import time
import urllib.error
import urllib.request

import jwt

BASE = "http://192.168.2.22:54321"
SEC = "super-secret-jwt-token-with-at-least-32-characters-long"


def mk(role):
    n = int(time.time())
    return jwt.encode({"role": role, "iss": "supabase", "iat": n, "exp": n + 3600}, SEC, algorithm="HS256")


ANON, SVC = mk("anon"), mk("service_role")


def post(path, body, tok, apikey=None):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST")
    r.add_header("apikey", apikey or ANON)
    r.add_header("Authorization", "Bearer " + tok)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as x:
            return x.status, json.loads(x.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="ignore")[:200]


stamp = int(time.time())
email = f"emu.test.{stamp}@example.com"
pw = "MatKhau123456!"

code, user = post("/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True}, SVC)
print("admin create:", code, (user.get("id") if isinstance(user, dict) else user))

code, sess = post(f"/auth/v1/token?grant_type=password", {"email": email, "password": pw}, ANON, apikey=ANON)
print("password grant:", code)
if code == 200:
    d = {
        "email": email,
        "uid": sess["user"]["id"],
        "access_token": sess["access_token"],
        "refresh_token": sess["refresh_token"],
    }
    with open("C:/Users/PC/AppData/Local/hermes/cache/scratch/emu_session.json", "w") as f:
        json.dump(d, f)
    print("uid:", d["uid"], "| token len:", len(d["access_token"]))
