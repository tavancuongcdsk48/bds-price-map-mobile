"""Kiểm chứng tính năng lưu ghim + theo dõi biến động giá."""
import json
import time
import urllib.error
import urllib.request

import jwt

BASE = "http://192.168.2.22:54321"
SEC = "super-secret-jwt-token-with-at-least-32-characters-long"
GOOG = "76f127ee-5d31-485d-af3d-91e7b8ea03d0"  # tài khoản Google của chủ dự án


def mk(role, sub=None):
    n = int(time.time())
    p = {"role": role, "iss": "supabase", "iat": n, "exp": n + 3600}
    if sub:
        p["sub"] = sub
        p["aud"] = "authenticated"
    return jwt.encode(p, SEC, algorithm="HS256")


ANON, SVC, OWNER = mk("anon"), mk("service_role"), mk("authenticated", GOOG)


def call(m, path, body=None, token=ANON, prefer=None):
    r = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode() if body is not None else None, method=m
    )
    r.add_header("Content-Type", "application/json")
    r.add_header("apikey", ANON)
    r.add_header("Authorization", "Bearer " + token)
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r, timeout=20) as x:
            raw = x.read().decode()
            return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:120]


st, prof = call("GET", "/rest/v1/profiles?select=id&email=eq.khach@vutru.app", token=SVC)
KHACH = prof[0]["id"]
K = mk("authenticated", KHACH)

# 1) Chủ (Google) đăng một ghim để làm mốc theo dõi
st, pin = call("POST", "/rest/v1/pins", {
    "user_id": GOOG, "title": "TEST lưu ghim Ocean Park", "property_type": "can-ho",
    "price_vnd": 5_000_000_000, "area_m2": 80,
    "public_geom": "POINT(105.945 20.995)", "exact_geom": "POINT(105.945 20.995)",
    "address_text": "Ocean Park, Gia Lâm", "contact_phone": "0900000002",
}, token=OWNER, prefer="return=representation")
pid = pin[0]["id"] if st in (200, 201) else None
print(f"1. Chủ đăng ghim: HTTP {st} → {pid[:8] if pid else pin}")

# 2) Khách lưu ghim đó
st, b = call("POST", "/rest/v1/rpc/toggle_save_pin", {"p_pin_id": pid}, token=K)
print(f"2. Khách lưu ghim: HTTP {st} → {b}")

# 3) Danh sách đã lưu của khách
st, saved = call("POST", "/rest/v1/rpc/get_my_saved_pins", {}, token=K)
row = saved[0] if isinstance(saved, list) and saved else {}
print(f"3. get_my_saved_pins: HTTP {st} → {len(saved) if isinstance(saved, list) else saved} mục")
print(f"   giá lúc lưu: {row.get('saved_price_vnd'):,} | giá hiện tại: {row.get('price_vnd'):,} "
      f"| chênh: {row.get('change_percent')}% | số lần đổi giá: {row.get('price_changes')}"
      if row else "   (trống)")

# 4) Chủ nâng giá 5,0 tỷ → 5,6 tỷ
st, _ = call("POST", "/rest/v1/rpc/update_pin_price", {"p_pin_id": pid, "p_price": 5_600_000_000}, token=OWNER)
print(f"4. Chủ nâng giá: HTTP {st}")

# 5) Danh sách đã lưu của khách cập nhật theo
st, saved2 = call("POST", "/rest/v1/rpc/get_my_saved_pins", {}, token=K)
row2 = saved2[0] if isinstance(saved2, list) and saved2 else {}
print(f"5. Sau khi đổi giá: {row2.get('saved_price_vnd'):,} → {row2.get('price_vnd'):,} "
      f"| chênh {row2.get('change_percent')}% | lịch sử {row2.get('price_changes')} mốc")

# 6) Cách ly dữ liệu: chủ không thấy danh sách lưu của khách
st, own_saves = call("POST", "/rest/v1/rpc/get_my_saved_pins", {}, token=OWNER)
print(f"6. Danh sách lưu của chủ (phải rỗng): HTTP {st} → "
      f"{len(own_saves) if isinstance(own_saves, list) else own_saves} mục")

# 7) RLS: khách không đọc được hàng pin_saves của người khác
st, raw = call("GET", "/rest/v1/pin_saves?select=*", token=OWNER)
print(f"7. Chủ đọc bảng pin_saves: HTTP {st} → {len(raw) if isinstance(raw, list) else raw} dòng (chỉ của chính mình)")

# 8) is_saved trên bản đồ: khách thấy true, chủ thấy false
st, near_k = call("POST", "/rest/v1/rpc/get_pins_in_bounds",
                  {"min_lng": 105.93, "min_lat": 20.98, "max_lng": 105.96, "max_lat": 21.01}, token=K)
mine = [p for p in near_k if p["id"] == pid]
st, near_o = call("POST", "/rest/v1/rpc/get_pins_in_bounds",
                  {"min_lng": 105.93, "min_lat": 20.98, "max_lng": 105.96, "max_lat": 21.01}, token=OWNER)
other = [p for p in near_o if p["id"] == pid]
print(f"8. is_saved — khách: {mine[0]['is_saved'] if mine else 'n/a'} | chủ: {other[0]['is_saved'] if other else 'n/a'}")

# 9) Ghi chú riêng
st, note_ok = call("POST", "/rest/v1/rpc/set_save_note", {"p_pin_id": pid, "p_note": "chờ giảm giá"}, token=K)
print(f"9. Ghi chú: HTTP {st} → {note_ok}")

# 10) Bỏ lưu
st, b = call("POST", "/rest/v1/rpc/toggle_save_pin", {"p_pin_id": pid}, token=K)
print(f"10. Bỏ lưu: HTTP {st} → {b}")

# dọn dẹp
call("DELETE", f"/rest/v1/pin_price_history?pin_id=eq.{pid}", token=SVC)
call("DELETE", f"/rest/v1/pin_saves?pin_id=eq.{pid}", token=SVC)
call("DELETE", f"/rest/v1/pins?id=eq.{pid}", token=SVC)
print("11. Đã dọn dữ liệu test")
