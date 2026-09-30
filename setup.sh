#!/bin/sh
# EVIL TRACE setup (linux/mac) — no npm install, no deps. just wires things up.

echo "[*] EVIL TRACE setup"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[!] node not found — grab Node.js 22.5+ from https://nodejs.org then re-run this."
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 22 ]; then
  echo "[!] node $MAJOR is too old, need 22.5+"
  exit 1
fi
echo "[+] node ok"

mkdir -p reports data
chmod +x bin/eviltrace.js

# shim so `./eviltrace` runs from this folder
cat > eviltrace <<'EOF'
#!/bin/sh
exec node "$(dirname "$0")/bin/eviltrace.js" "$@"
EOF
chmod +x eviltrace
echo "[+] eviltrace command ready"

echo ""
echo "[*] running self-check..."
if node --test >/dev/null 2>&1; then
  echo "[+] self-check passed"
else
  echo "[!] self-check failed. something's off — open an issue."
fi

echo ""
echo "done. run: ./eviltrace torvalds --quick"
echo "tip: add $(pwd) to your PATH to run it from anywhere."
