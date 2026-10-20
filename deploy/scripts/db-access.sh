#!/usr/bin/env bash
# Quản lý khoá SSH tunnel tới Redis cho từng dev (spec 003 US3, kế thừa ở spec 004).
# Chạy trên VPS bằng user deploy (cần sudo không mật khẩu).
#
#   db-access.sh tunnel-add <tên> "<pubkey>"  thêm khoá vào authorized_keys của user dbtunnel
#   db-access.sh tunnel-remove <tên>          gỡ khoá theo tên
#   db-access.sh tunnel-list                  liệt kê tên và loại khoá
#
# Tài khoản Postgres của dev KHÔNG tạo ở đây: Postgres nằm trên Cloud SQL, xem runbook A10.1.
# Tên: a-z, 0-9, _, dài 3 tới 32. Mã thoát: 0 thành công, 1 lỗi tham số, 2 lỗi thực thi.
set -euo pipefail

TUNNEL_USER="${TUNNEL_USER:-dbtunnel}"
TUNNEL_KEYS="/home/${TUNNEL_USER}/.ssh/authorized_keys"
KEY_OPTIONS='restrict,port-forwarding,permitopen="127.0.0.1:6379"'
PROTECTED="a2matex postgres deploy dbtunnel root"

usage() {
  cat <<'USAGE'
db-access.sh: quản lý khoá SSH tunnel tới Redis cho từng dev.

  db-access.sh tunnel-add <tên> "<pubkey>"  thêm khoá vào authorized_keys của user dbtunnel
  db-access.sh tunnel-remove <tên>          gỡ khoá theo tên
  db-access.sh tunnel-list                  liệt kê tên và loại khoá

Tên: a-z, 0-9, _, dài 3 tới 32. Mã thoát: 0 thành công, 1 lỗi tham số, 2 lỗi thực thi.
Tài khoản Postgres của dev tạo trên Cloud SQL theo runbook A10.1, không ở đây.
USAGE
}
die_usage() { echo "LỖI: $*" >&2; echo >&2; usage >&2; exit 1; }
die() { echo "LỖI: $*" >&2; exit 2; }

check_name() {
  local name="$1" p
  [[ "$name" =~ ^[a-z0-9_]{3,32}$ ]] || die_usage "tên '$name' không hợp lệ: chỉ a-z, 0-9, _, dài 3 tới 32"
  for p in $PROTECTED; do
    [ "$name" = "$p" ] && die_usage "tên '$name' bị cấm"
  done
  return 0
}

require_tunnel_user() {
  id "$TUNNEL_USER" >/dev/null 2>&1 || die "user $TUNNEL_USER chưa có trên VPS (xem runbook A10.2)"
}

cmd_tunnel_add() {
  local name="${1:-}" pubkey="${2:-}" ktype kbody
  { [ -n "$name" ] && [ -n "$pubkey" ]; } || die_usage "cần tên và khoá công khai"
  check_name "$name"
  require_tunnel_user
  # Chỉ giữ loại và thân khoá; comment do người dùng đưa vào bị bỏ, thay bằng tên.
  read -r ktype kbody _ <<< "$pubkey"
  case "$ktype" in
    ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh.com) ;;
    *) die_usage "loại khoá '$ktype' không hỗ trợ" ;;
  esac
  printf '%s %s\n' "$ktype" "${kbody:-}" | ssh-keygen -l -f /dev/stdin >/dev/null 2>&1 \
    || die_usage "khoá công khai không hợp lệ"
  if sudo grep -qE " ${name}\$" "$TUNNEL_KEYS" 2>/dev/null; then
    die "tên '$name' đã có khoá trong $TUNNEL_KEYS"
  fi
  printf '%s %s %s %s\n' "$KEY_OPTIONS" "$ktype" "$kbody" "$name" | sudo tee -a "$TUNNEL_KEYS" >/dev/null
  sudo chown "$TUNNEL_USER:$TUNNEL_USER" "$TUNNEL_KEYS"
  sudo chmod 600 "$TUNNEL_KEYS"
  echo "Đã thêm khoá cho '$name'. Tunnel: ssh -N -L 6379:127.0.0.1:6379 $TUNNEL_USER@<IP VPS>"
}

cmd_tunnel_remove() {
  local name="${1:-}"
  [ -n "$name" ] || die_usage "thiếu tên"
  check_name "$name"
  require_tunnel_user
  sudo grep -qE " ${name}\$" "$TUNNEL_KEYS" 2>/dev/null || die "không có khoá nào mang tên '$name'"
  sudo sed -i -E "/ ${name}\$/d" "$TUNNEL_KEYS"
  echo "Đã gỡ khoá của '$name'."
}

cmd_tunnel_list() {
  require_tunnel_user
  echo "tên | loại khoá"
  sudo cat "$TUNNEL_KEYS" 2>/dev/null | awk 'NF >= 4 { print $4 " | " $2 }'
}

cmd="${1:-}"
if [ $# -gt 0 ]; then shift; fi
case "$cmd" in
  tunnel-add)    cmd_tunnel_add "$@" ;;
  tunnel-remove) cmd_tunnel_remove "$@" ;;
  tunnel-list)   cmd_tunnel_list ;;
  -h|--help)     usage ;;
  "")            usage >&2; exit 1 ;;
  *)             die_usage "lệnh '$cmd' không có" ;;
esac
