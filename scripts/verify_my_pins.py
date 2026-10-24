"""Kiểm chứng tab 'Ghim của tôi': liệt kê + đổi trạng thái + chặn đổi ghim người khác."""
import json
import time
import urllib.error
import urllib.request

import jwt

BASE = "http://192.168.2.22:54321"
SEC = "super-secret-jwt-token-with-at-least-32-characters-long"


def mk(role, sub=None):
    n = int(time.time())
    p = {"role": role, "iss": "supabase", "iat": n, "exp": n + 3600}
    if sub:
        p["sub"] = sub
        p["aud"] = "authenticated"
    return jwt.encode(p, SEC, algorithm="HS256")


ANON, SVC = mk("anon"), mk("service_role")


def call(m, path, tok, body=None):
    r = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode() if body is not None else None, method=m
    )
    r.add_header("apikey", ANON)
    r.add_header("Authorization", "Bearer " + tok)
    r.add_header("Content-Type", "application/json")
    r.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(r, timeout=25) as x:
            raw = x.read().decode()
            return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:160]


stamp = int(time.time())
st, u = call("POST", "/auth/v1/admin/users", SVC,
             {"email": f"manypins-{stamp}@example.com", "password": "MatKhau123456!",
              "email_confirm": True})
uid = u["id"]
A = mk("authenticated", uid)
B = mk("authenticated", "11111111-2222-3333-4444-555555555555")
print("1) Tạo tài khoản:", st, "| uid", uid[:8])

pin_ids = []
for i, (title, price, area) in enumerate(
    [("Căn 1PN toà S1 giá tốt", 1_900_000_000, 45),
     ("Căn 2PN view hồ", 2_600_000_000, 62),
     ("Căn 3PN góc", 3_400_000_000, 78)], start=1
):
    st, rows = call("POST", "/rest/v1/pins", A,
                    {"user_id": uid, "title": title, "property_type": "can-ho",
                     "price_vnd": price, "area_m2": area,
                     "address_text": f"Ocean Park {i}", "contact_phone": "0912345678",
                     "public_geom": f"POINT({105.95 + i * 0.001} {20.99 + i * 0.001})",
                     "exact_geom": f"POINT({105.95 + i * 0.001} {20.99 + i * 0.001})"})
    if st < 300:
        pin_ids.append(rows[0]["id"])
print("2) Đăng 3 ghim:", st, "| OK" if len(pin_ids) == 3 else f"| chỉ {len(pin_ids)}")

st, mine = call("POST", "/rest/v1/rpc/get_my_pins", A, {})
print("3) get_my_pins:", st, "|", len(mine) if isinstance(mine, list) else mine, "ghim")
for m in (mine or [])[:3]:
    print(f"   - {m['title'][:26]:28} {m['price_vnd']/1e9:.1f} tỷ · {m['area_m2']}m² · {m['status']}"
          f" · ảnh={m['images']} · lưu={m['saves_count']}")

print("4) get_my_pins của người khác (B):", end=" ")
st, other = call("POST", "/rest/v1/rpc/get_my_pins", B, {})
print(st, "|", len(other) if isinstance(other, list) else other, "ghim (phải 0)")

st, ok = call("POST", "/rest/v1/rpc/set_pin_status", A, {"p_pin_id": pin_ids[0], "p_status": "sold"})
print("5) Chủ đổi ghim 1 → đã bán:", st, "|", ok)

st, mine = call("POST", "/rest/v1/rpc/get_my_pins", A, {})
sold = [m for m in mine if m["id"] == pin_ids[0]][0]
print("   → trạng thái trong tab:", sold["status"])

st, bounds = call("POST", "/rest/v1/rpc/get_pins_in_bounds", ANON,
                  {"min_lng": 105.9, "min_lat": 20.95, "max_lng": 106.0, "max_lat": 21.05,
                   "p_type": None})
visible = [b["id"] for b in bounds]
print("6) Ghim đã bán còn trên bản đồ?", "CÓ ⚠" if pin_ids[0] in visible else "KHÔNG (đúng)")
print("   → 2 ghim đang bán vẫn hiện:", all(p in visible for p in pin_ids[1:]))

st, body = call("POST", "/rest/v1/rpc/set_pin_status", B, {"p_pin_id": pin_ids[1], "p_status": "sold"})
print("7) Người khác đổi trạng thái ghim của A:", st, "|", (body.get("message") if isinstance(body, dict) else body))

st, body = call("POST", "/rest/v1/rpc/set_pin_status", A, {"p_pin_id": pin_ids[1], "p_status": "linh-tinh"})
print("8) Trạng thái không hợp lệ:", st, "|", (body.get("message") if isinstance(body, dict) else body))

st, _ = call("POST", "/rest/v1/rpc/set_pin_status", A, {"p_pin_id": pin_ids[2], "p_status": "hidden"})
st, mine = call("POST", "/rest/v1/rpc/get_my_pins", A, {})
print("9) Ẩn ghim 3 → vẫn nằm trong tab quản lý:", len(mine), "ghim |",
      [m["status"] for m in mine])

for pid in pin_ids:
    call("DELETE", f"/rest/v1/pins?id=eq.{pid}", SVC)
call("DELETE", f"/auth/v1/admin/users/{uid}", SVC)
print("10) Đã dọn 3 ghim + tài khoản test")
