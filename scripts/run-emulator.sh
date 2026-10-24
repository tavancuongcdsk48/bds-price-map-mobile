#!/usr/bin/env bash
# Bật app "Vũ Trụ Chuyển Nhượng" trên Android Emulator của máy tính.
# Dùng:  bash scripts/run-emulator.sh
# Yêu cầu: Metro đang chạy (npx expo start) ở cổng 8081.

set -u
SDK="C:/Users/PC/Android/sdk"
ADB="$SDK/platform-tools/adb.exe"
EMU="$SDK/emulator/emulator.exe"
AVD="${AVD_NAME:-vutru}"

# 1. Khởi động emulator nếu chưa chạy
if ! "$ADB" devices | grep -q "emulator-.*device"; then
  echo "→ Khởi động emulator $AVD ..."
  "$EMU" -avd "$AVD" -no-snapshot-load -gpu swiftshader_indirect >/dev/null 2>&1 &
  "$ADB" wait-for-device
  for i in $(seq 1 90); do
    [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
    sleep 2
  done
fi

echo "→ Chờ emulator boot xong..."
for i in $(seq 1 60); do
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done

# 2. Nối cổng Metro (và Supabase local) vào emulator
"$ADB" reverse tcp:8081 tcp:8081
"$ADB" reverse tcp:54321 tcp:54321

# 3. Kiểm tra Metro
if ! curl -s -m 5 http://127.0.0.1:8081/status | grep -q running; then
  echo "!! Metro chưa chạy. Mở terminal khác: cd projects/bds-price-map-mobile && npx expo start"
  exit 1
fi

# 4. Mở app trong Expo Go
"$ADB" shell am force-stop host.exp.exponent >/dev/null 2>&1
"$ADB" shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent >/dev/null 2>&1
echo "✓ Đã mở app. Sửa code → Fast Refresh tự cập nhật."
echo "  Chụp màn hình: \"$ADB\" exec-out screencap -p > shot.png"
