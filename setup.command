#!/bin/bash
# Claude 세션 매니저 — macOS 설치기
# /Applications에 앱 번들을 만들고 바로 실행한다.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd -P)"
APP="/Applications/Claude 세션 매니저.app"

echo "Claude 세션 매니저 설치"
echo "설치 위치: $HERE"
echo

# --- 1. Node.js 확인 ---
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ]; then
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Node.js가 없습니다. Homebrew로 지금 설치할까요? [y/N] " yn
    case "$yn" in
      [yY]*) brew install node; NODE="$(command -v node)" ;;
      *) echo "Node.js가 필요합니다. https://nodejs.org 에서 설치 후 다시 실행해주세요."; exit 1 ;;
    esac
  else
    echo "[오류] Node.js가 없습니다. https://nodejs.org 에서 설치 후 다시 실행해주세요."
    exit 1
  fi
fi
echo "Node.js: $NODE ($("$NODE" -v))"

# --- 2. 앱 번들 생성 ---
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Claude 세션 매니저</string>
  <key>CFBundleDisplayName</key><string>Claude 세션 매니저</string>
  <key>CFBundleIdentifier</key><string>com.hoonartis.claude-sessions-manager</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/launch" <<LAUNCH
#!/bin/bash
# 서버가 이미 떠 있으면 그대로 두고 브라우저만 연다.
cd "$HERE"
if ! /usr/bin/nc -z 127.0.0.1 7777 >/dev/null 2>&1; then
  "$NODE" server.js >/dev/null 2>&1 &
  sleep 1
fi
/usr/bin/open http://localhost:7777
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

# Finder/Spotlight가 새 번들을 즉시 인식하게 한다
/usr/bin/touch "$APP"

echo
echo "설치 완료! 응용 프로그램의 \"Claude 세션 매니저\"를 실행하면 됩니다."
echo "지금 첫 실행 중입니다 — 잠시 후 브라우저가 열립니다."
/usr/bin/open -a "$APP"
