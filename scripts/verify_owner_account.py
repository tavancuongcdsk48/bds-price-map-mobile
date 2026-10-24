"""Kiểm chứng quyền theo tài khoản Google/Supabase Auth (tạo - sửa - xoá ghim).

Chạy: python verify_owner_account.py
Không in token ra ngoài, chỉ in kết quả từng bước.
"""
import json
import time
import urllib.request
import urllib.error

import jwt  # PyJWT

BASE = "http://192.168.2.22:54321"
JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"


def service_token():
    now = int(time.time())
    return jwt.encode(
        {"role": "service_role", "iss": "supabase", "iat": now, "exp": now + 3600},
        JWT_SECRET,
        algorithm="HS256",
    )


def call(method, path, body=None, token=None, apikey=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if apikey:
        req.add_header("apikey", apikey)
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def make_user(svc, email, password):
    st, body = call("POST", "/auth/v1/admin/users",
                    {"email": email, "password": password, "email_confirm": True},
                    token=svc, apikey=svc)
    if st not in (200, 201):
        raise SystemExit(f"tạo user lỗi {st}: {body}")
    st, body = call("POST", "/auth/v1/token?grant_type=password",
                    {"email": email, "password": password}, apikey=svc)
    if st != 200:
        raise SystemExit(f"đăng nhập lỗi {st}: {body}")
    return body["user"]["id"], body["access_token"]


svc = service_token()

# Hai tài khoản khác nhau, mô phỏng 2 người dùng Google khác nhau
uid_a, token_a = make_user(svc, f"owner-a-{int(time.time())}@example.com", "MatKhau123456!")
uid_b, token_b = make_user(svc, f"owner-b-{int(time.time())}@example.com", "MatKhau123456!")
print(f"[0] Tài khoản A={uid_a[:8]}…  B={uid_b[:8]}…")

# [1] A tạo ghim (RLS yêu cầu auth.uid() = user_id)
st, body = call("POST", "/rest/v1/pins", {
    "user_id": uid_a,
    "title": "TEST quyền tài khoản",
    "property_type": "can-ho",
    "price_vnd": 3_000_000_000,
    "area_m2": 60,
    "public_geom": "POINT(105.94 20.99)",
    "exact_geom": "POINT(105.94 20.99)",
    "address_text": "Test ownership",
    "contact_phone": "0900000000",
}, token=token_a, apikey=svc, prefer="return=representation")
pin_id = body[0]["id"] if st in (200, 201) and isinstance(body, list) else None
print(f"[1] A tạo ghim: HTTP {st} → {'OK' if pin_id else 'THẤT BẠI'}")

# [2] B tạo ghim gán user_id của A (phải bị RLS chặn)
st2, _ = call("POST", "/rest/v1/pins", {
    "user_id": uid_a,
    "title": "TEST giả mạo",
    "property_type": "can-ho",
    "price_vnd": 1_000_000_000,
    "area_m2": 30,
    "public_geom": "POINT(105.94 20.99)",
    "exact_geom": "POINT(105.94 20.99)",
    "address_text": "Fake",
    "contact_phone": "0900000000",
}, token=token_b, apikey=svc)
print(f"[2] B đăng ghim dưới tên A: HTTP {st2} → {'CHẶN ĐÚNG' if st2 >= 400 else 'LỖ HỔNG'}")

# [3] B sửa giá ghim của A (phải not_pin_owner)
st3, b3 = call("POST", "/rest/v1/rpc/update_pin_price",
               {"p_pin_id": pin_id, "p_price": 9_000_000_000}, token=token_b, apikey=svc)
print(f"[3] B sửa giá ghim A: HTTP {st3} {b3 if st3 >= 400 else ''} → "
      f"{'CHẶN ĐÚNG' if st3 >= 400 else 'LỖ HỔNG'}")

# [4] B xoá ghim của A (phải not_pin_owner)
st4, b4 = call("POST", "/rest/v1/rpc/delete_pin", {"p_pin_id": pin_id}, token=token_b, apikey=svc)
print(f"[4] B xoá ghim A: HTTP {st4} {b4 if st4 >= 400 else ''} → "
      f"{'CHẶN ĐÚNG' if st4 >= 400 else 'LỖ HỔNG'}")

# [5] A sửa giá ghim của mình
st5, b5 = call("POST", "/rest/v1/rpc/update_pin_price",
               {"p_pin_id": pin_id, "p_price": 3_500_000_000}, token=token_a, apikey=svc)
print(f"[5] A sửa giá ghim mình: HTTP {st5} → {'OK' if st5 == 200 else 'THẤT BẠI'}")

# [6] Lịch sử giá có 2 mốc
st6, b6 = call("GET", f"/rest/v1/pin_price_history?pin_id=eq.{pin_id}&select=price_vnd,source",
               token=token_a, apikey=svc)
print(f"[6] Lịch sử giá: HTTP {st6} → {len(b6) if isinstance(b6, list) else 0} mốc "
      f"{[r['price_vnd'] for r in b6] if isinstance(b6, list) else ''}")

# [7] A xoá ghim của mình
st7, b7 = call("POST", "/rest/v1/rpc/delete_pin", {"p_pin_id": pin_id}, token=token_a, apikey=svc)
print(f"[7] A xoá ghim mình: HTTP {st7} → {'OK' if st7 == 200 else 'THẤT BẠI'}")

# [8] Ghim đã ẩn khỏi bản đồ
st8, b8 = call("GET", f"/rest/v1/pins?id=eq.{pin_id}&select=status,title", token=token_a, apikey=svc)
print(f"[8] Trạng thái sau xoá: {b8[0]['status'] if isinstance(b8, list) and b8 else 'N/A'}")

# Dọn dẹp
call("DELETE", f"/rest/v1/pin_price_history?pin_id=eq.{pin_id}", token=svc, apikey=svc)
call("DELETE", f"/rest/v1/pins?id=eq.{pin_id}", token=svc, apikey=svc)
for uid in (uid_a, uid_b):
    call("DELETE", f"/auth/v1/admin/users/{uid}", token=svc, apikey=svc)
print("[9] Đã dọn dữ liệu test")
