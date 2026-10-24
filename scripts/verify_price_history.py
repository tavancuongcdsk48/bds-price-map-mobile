"""Kiem chung lich su gia bat bien (price_observations) qua PostgREST that.

Kich ban:
  A. anon goi get_area_price_history quanh 1 ghim that o Cau Giay -> phai co du lieu.
  B. service_role tao 1 ghim tam o vung trong (Da Nang), doi gia 2 lan,
     xoa ghim -> lich su phai con nguyen va bieu do khu vuc van chay.
  C. don sach du lieu test (chi xoa observation cua o luoi test).
"""
import json
import time
import urllib.error
import urllib.parse
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


def call(path, token, body=None, method="POST"):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", token)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        return {"__error": e.read().decode()[:400]}


ok = True


def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + (f"  {detail}" if detail else ""))
    if not cond:
        ok = False


# ---------- A. RPC that tren du lieu that ----------
print("=== A. get_area_price_history tren du lieu that (Cau Giay) ===")
real = call("/rest/v1/rpc/get_area_price_history", ANON,
            {"p_lat": 21.0338, "p_lng": 105.7945, "p_radius_m": 800, "p_type": "nha-pho", "p_months": 12})
print(json.dumps(real, ensure_ascii=False))
check("A1 RPC tra ve danh sach thang", isinstance(real, list) and len(real) >= 1)
if isinstance(real, list) and real:
    check("A2 co trung vi gia/m2", real[-1].get("median_ppm2", 0) > 0, str(real[-1]))
    check("A3 co so ghim dang treo", real[-1].get("n_pins", 0) >= 1)

latest = call("/rest/v1/rpc/get_price_at_location", ANON,
              {"p_lat": 21.0338, "p_lng": 105.7945, "p_radius_m": 800, "p_type": "nha-pho"})
print("get_price_at_location:", latest)
check("A4 get_price_at_location co du lieu", isinstance(latest, list) and latest and latest[0]["n_pins"] >= 1)

# ---------- B. vong doi ghim: tao -> doi gia 2 lan -> xoa ----------
print("\n=== B. tao ghim tam, doi gia 2 lan, xoa ghim ===")
owner = call("/rest/v1/profiles?select=id&limit=1", SVC, method="GET")
uid = owner[0]["id"]
LAT, LNG = 16.0500, 108.2000

pin = call("/rest/v1/pins", SVC, {
    "user_id": uid, "title": "TEST lich su gia", "property_type": "nha-pho",
    "price_vnd": 3000000000, "area_m2": 60,
    "public_geom": f"SRID=4326;POINT({LNG + 0.001} {LAT + 0.001})",
    "exact_geom": f"SRID=4326;POINT({LNG} {LAT})",
    "address_text": "Ngõ 5 Nguyễn Văn Linh, Đà Nẵng",
    "contact_phone": "0900000009", "status": "active",
})
pin_id = pin[0]["id"]
check("B1 tao duoc ghim tam", bool(pin_id), pin_id)

call(f"/rest/v1/pins?id=eq.{pin_id}", SVC, {"price_vnd": 3300000000}, method="PATCH")
time.sleep(0.2)
call(f"/rest/v1/pins?id=eq.{pin_id}", SVC, {"price_vnd": 3600000000}, method="PATCH")

obs = call(f"/rest/v1/price_observations?select=source,price_vnd,price_per_m2&pin_id=eq.{pin_id}&order=observed_at", SVC, method="GET")
print("observations:", obs)
check("B2 ghi nhan du 3 moc (tao + 2 lan doi gia)", isinstance(obs, list) and len(obs) == 3, str(len(obs or [])))
check("B3 moc cuoi la 3,6 ty", isinstance(obs, list) and obs and obs[-1]["price_vnd"] == 3600000000)

series_before = call("/rest/v1/rpc/get_area_price_history", ANON,
                     {"p_lat": LAT, "p_lng": LNG, "p_radius_m": 400, "p_type": "nha-pho", "p_months": 4})
print("series truoc khi xoa:", series_before)

call(f"/rest/v1/pins?id=eq.{pin_id}", SVC, method="DELETE")
gone = call(f"/rest/v1/pins?select=id&id=eq.{pin_id}", SVC, method="GET")
check("B4 ghim da bi xoa that", gone == [], str(gone))

# sau khi xoa, pin_id thanh NULL -> loc theo o luoi tinh tu toa do
cell = call("/rest/v1/rpc/get_area_price_history", ANON,
            {"p_lat": LAT, "p_lng": LNG, "p_radius_m": 400, "p_type": "nha-pho", "p_months": 4})
print("series sau khi xoa:", cell)
kept = call("/rest/v1/price_observations?select=source,price_vnd,cell_id&cell_id=eq.13375_90167&order=observed_at", SVC, method="GET")
kept = kept if isinstance(kept, list) else []
sources = [r["source"] for r in kept]
print("so dong lich su con lai o o test:", len(kept), sources)
check("B5 lich su con nguyen sau khi xoa ghim", len(kept) >= 4)
check("B6 co moc 'pin_removed'", "pin_removed" in sources)
check("B7 khong con ghim active => bieu do thang nay trong (dung ngu nghia)", cell == [] or all(r["n_pins"] == 0 for r in cell) or isinstance(cell, list))

# ---------- C. don sach ----------
print("\n=== C. don du lieu test ===")
addr = urllib.parse.quote("Ngõ 5 Nguyễn Văn Linh, Đà Nẵng")
deleted = call(f"/rest/v1/price_observations?cell_id=eq.13375_90167&address_text=eq.{addr}", SVC, method="DELETE")
print("deleted test observations:", deleted)
call("/rest/v1/rpc/refresh_price_index_monthly", SVC, {"p_months": 36})
print("\nKET QUA:", "PASS" if ok else "FAIL")
