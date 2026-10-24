#!/usr/bin/env bash
# Bật Google OAuth cho Supabase Auth đang chạy local (Docker) bằng cách tạo lại
# DUY NHẤT container auth với thêm biến môi trường Google. DB/Kong/Studio không bị đụng.
#
# Cách dùng (chạy trong Git Bash):
#   bash scripts/enable_google_oauth.sh
# Script sẽ hỏi Client ID (dán được) và Client Secret (ẩn, không hiện ra màn hình,
# không gửi cho trợ lý, không ghi vào git).
set -euo pipefail

CONT="${AUTH_CONTAINER:-supabase_auth_AdIntel.dms}"
NET="${SUPABASE_NETWORK:-}"
URL=""

# 1) Lấy tunnel URL
if [ -n "${TUNNEL_URL:-}" ]; then
  URL="$TUNNEL_URL"
elif [ -f .tunnel-url ]; then
  URL="$(tr -d '\r\n' < .tunnel-url)"
else
  read -r -p "Tunnel https URL (vd https://abc.trycloudflare.com): " URL
fi
URL="${URL%/}"
CALLBACK="$URL/auth/v1/callback"

echo "Callback sẽ đăng ký với Google: $CALLBACK"
echo
read -r -p "Google Client ID: " CID
read -r -s -p "Google Client Secret (không hiện): " CSEC
echo

if [ -z "$CID" ] || [ -z "$CSEC" ]; then
  echo "Thiếu Client ID hoặc Secret — dừng." >&2
  exit 1
fi

# 2) Ghi lại cấu hình hiện tại của container
IMG="$(docker inspect -f '{{.Config.Image}}' "$CONT")"
if [ -z "$NET" ]; then
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CONT")"
fi
# Docker là chương trình Windows gốc nên KHÔNG đọc được /tmp của MSYS — dùng đường dẫn Windows
ENVF="${TMPDIR:-C:/Users/PC/AppData/Local/hermes/cache/scratch}/auth_env_$$.txt"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONT" \
  | grep -vE '^GOTRUE_EXTERNAL_GOOGLE_|^GOTRUE_SITE_URL=' > "$ENVF"

{
  echo "GOTRUE_SITE_URL=$URL"
  echo "GOTRUE_EXTERNAL_GOOGLE_ENABLED=true"
  echo "GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=$CID"
  echo "GOTRUE_EXTERNAL_GOOGLE_SECRET=$CSEC"
  echo "GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=$CALLBACK"
  echo "GOTRUE_URI_ALLOW_LIST=vutruchuyennhuong://auth/callback,$URL/**,http://192.168.2.22:8081/**,exp://192.168.2.22:8081/--/auth/callback,exp://**"
} >> "$ENVF"

echo "Image: $IMG | Network: $NET"

# 3) Tạo lại container auth
docker rm -f "$CONT" >/dev/null
docker run -d --name "$CONT" --network "$NET" --restart unless-stopped \
  --env-file "$ENVF" "$IMG" >/dev/null
rm -f "$ENVF"

# 4) Kiểm chứng
echo "Chờ auth khởi động lại…"
for i in $(seq 1 30); do
  if curl -sf -m 3 "http://127.0.0.1:54321/auth/v1/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 2
echo
echo "== /auth/v1/settings =="
curl -s -m 10 "http://127.0.0.1:54321/auth/v1/settings" \
  | C:/Python314/python.exe -c "import sys,json;d=json.load(sys.stdin);print('google =', d['external'].get('google'));print('disable_signup =', d.get('disable_signup'))" \
  || echo "Không đọc được settings — xem: docker logs $CONT --tail 40"
echo
echo "Nếu google = True: mở app, bấm avatar → Đăng nhập bằng Google."
echo "Nếu google = False: docker logs $CONT --tail 60"
