"""Kiểm chứng ảnh/video của ghim: bucket, quyền tải lên, đọc công khai, RPC media."""
import base64
import json
import time
import urllib.error
import urllib.request

import jwt

BASE = "http://192.168.2.22:54321"
SEC = "super-secret-jwt-token-with-at-least-32-characters-long"
GOOG = "76f127ee-5d31-485d-af3d-91e7b8ea03d0"
PIN_TITLE_LIKE = "Pr50410%"


def mk(role, sub=None):
    n = int(time.time())
    p = {"role": role, "iss": "supabase", "iat": n, "exp": n + 3600}
    if sub:
        p["sub"] = sub
        p["aud"] = "authenticated"
    return jwt.encode(p, SEC, algorithm="HS256")


ANON, SVC, OWNER = mk("anon"), mk("service_role"), mk("authenticated", GOOG)


def req(method, path, token=ANON, body=None, raw=None, ct="application/json", extra=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("apikey", ANON)
    r.add_header("Authorization", "Bearer " + token)
    r.add_header("Content-Type", ct)
    for k, v in (extra or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=25) as x:
            b = x.read()
            try:
                return x.status, json.loads(b.decode())
            except Exception:
                return x.status, b
    except urllib.error.HTTPError as e:
        b = e.read().decode(errors="ignore")
        try:
            return e.code, json.loads(b)
        except Exception:
            return e.code, b[:160]


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
stamp = str(int(time.time()))

print("1) Bucket pin-media:", end=" ")
st, buckets = req("GET", "/storage/v1/bucket", token=SVC)
names = [b["name"] for b in buckets] if isinstance(buckets, list) else []
print("HTTP", st, "| có bucket:", "pin-media" in names)

obj = f"selftest/{stamp}.png"
print("2) Chủ ghim tải ảnh lên:", end=" ")
st, body = req("POST", "/storage/v1/object/pin-media/" + obj, token=OWNER, raw=PNG, ct="image/png",
               extra={"x-upsert": "true"})
print("HTTP", st, "|", str(body)[:60])

print("3) Đọc công khai URL:", end=" ")
st, body = req("GET", "/storage/v1/object/public/pin-media/" + obj)
print("HTTP", st, "|", (str(len(body)) + " bytes") if isinstance(body, bytes) else str(body)[:60])

print("4) Khách chưa đăng nhập tải lên (phải bị chặn):", end=" ")
st, body = req("POST", "/storage/v1/object/pin-media/selftest/anon-" + stamp + ".png", raw=PNG,
               ct="image/png")
print("HTTP", st, "| chặn" if st >= 400 else "| KHÔNG CHẶN ⚠")

print("5) Gắn media vào ghim bằng tài khoản chủ ghim:", end=" ")
st, rows = req("GET", f"/rest/v1/pins?select=id,title&title=ilike.{PIN_TITLE_LIKE}", token=SVC)
pin_id = rows[0]["id"] if rows else None
st, body = req("POST", "/rest/v1/pin_media", token=OWNER,
               body={"pin_id": pin_id, "media_type": "image",
                     "url": BASE + "/storage/v1/object/public/pin-media/" + obj},
               extra={"Prefer": "return=representation"})
print("HTTP", st, "|", "OK" if st < 300 else str(body)[:80])
if st < 300:
    new_media_id = body[0]["id"]
    st, _ = req("DELETE", f"/rest/v1/pin_media?id=eq.{new_media_id}", token=OWNER)
    print("   → dọn bản ghi test:", "HTTP", st)

print("6) Gắn media vào ghim KHÔNG phải của mình (phải bị chặn):", end=" ")
st, body = req("POST", "/rest/v1/pin_media", token=mk("authenticated", "11111111-2222-3333-4444-555555555555"),
               body={"pin_id": pin_id, "media_type": "image",
                     "url": BASE + "/storage/v1/object/public/pin-media/" + obj},
               extra={"Prefer": "return=representation"})
print("HTTP", st, "|", "chặn" if st >= 400 else "KHÔNG CHẶN ⚠")

print("7) RPC get_pin_media cho ghim thật:", end=" ")
st, media = req("POST", "/rest/v1/rpc/get_pin_media", body={"p_pin_id": pin_id})
print("HTTP", st, "|", len(media) if isinstance(media, list) else media, "media")
if isinstance(media, list):
    for m in media:
        print("   -", m["media_type"], f'({m["duration_seconds"]}s)', m["url"][:70])

print("8) RPC get_pin_media_counts:", end=" ")
st, cnt = req("POST", "/rest/v1/rpc/get_pin_media_counts", body={"p_pin_ids": [pin_id]})
print("HTTP", st, "|", cnt if not isinstance(cnt, list) else
      f'ảnh={cnt[0]["images"]}, video={cnt[0]["videos"]}')

# ---- Giới hạn media ở tầng DB (trigger trg_pin_media_limits + unique index video) ----
url_base = BASE + "/storage/v1/object/public/pin-media/" + obj
inserted = []


def insert_media(rows, label):
    global inserted
    st, body = req("POST", "/rest/v1/pin_media", token=OWNER, body=rows,
                   extra={"Prefer": "return=representation"})
    ok = 200 <= st < 300
    if ok and isinstance(body, list):
        inserted += [r["id"] for r in body]
    msg = str(body)[:90]
    print(f"{label}: HTTP {st} | {msg}")
    return ok, msg


print("9) Gắn 8 ảnh trong 1 câu lệnh:", end=" ")
insert_media([{"pin_id": pin_id, "media_type": "image", "url": f"{url_base}?i={i}", "sort_order": i}
              for i in range(1, 9)], "9)")

print("10) Ảnh thứ 9 (phải bị chặn):", end=" ")
ok, msg = insert_media([{"pin_id": pin_id, "media_type": "image", "url": url_base}], "10)")
print("    →", "CHẶN ĐÚNG" if not ok and "image_limit_reached" in msg else "SAI")

print("11) Video đầu tiên + video thứ 2 (phải bị chặn):", end=" ")
ok1, msg1 = insert_media([{"pin_id": pin_id, "media_type": "video", "url": url_base, "duration_seconds": 30}], "11a)")
ok2, msg2 = insert_media([{"pin_id": pin_id, "media_type": "video", "url": url_base, "duration_seconds": 20}], "11b)")
print("    →", "CHẶN ĐÚNG" if ok1 and not ok2 else "SAI")

print("12) Video 60s (phải bị chặn):", end=" ")
# Bỏ video 30s trước, nếu không unique index (1 video/ghim) sẽ chặn trước cả trigger thời lượng
req("DELETE", f"/rest/v1/pin_media?pin_id=eq.{pin_id}&media_type=eq.video", token=OWNER)
ok3, msg3 = insert_media([{"pin_id": pin_id, "media_type": "video", "url": url_base, "duration_seconds": 60}], "12)")
print("    →", "CHẶN ĐÚNG" if not ok3 and "video_too_long" in msg3 else "SAI")

if inserted:
    ids = ",".join(inserted)
    st, _ = req("DELETE", f"/rest/v1/pin_media?id=in.({ids})", token=OWNER)
    print("13) Dọn media test: HTTP", st, f"({len(inserted)} dòng)")

