#!/usr/bin/env bash
# Hook: block dangerous bash patterns
# Returns JSON: { "decision": "allow" | "deny", "message": "..." }

EVENT=$(cat)
COMMAND=$(echo "$EVENT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('args',{}).get('command',''))" 2>/dev/null)

block() {
  echo "{\"decision\":\"deny\",\"message\":\"$1\"}"
  exit 0
}

allow() {
  echo "{\"decision\":\"allow\"}"
  exit 0
}

# Block patterns
case "$COMMAND" in
  *"rm -rf /"*)
    block "Blocked: rm -rf /" ;;
  *"rm -rf ~"*|*"rm -rf \$HOME"*)
    block "Blocked: rm on home directory" ;;
  *":(){ :|:& };:"*)
    block "Blocked: fork bomb" ;;
  *"chmod -R 777"*)
    block "Blocked: recursive 777 (insecure)" ;;
  *"curl"*"|"*"bash"*|*"wget"*"|"*"sh"*)
    block "Blocked: curl|bash piping (suspicious)" ;;
  *"> /dev/sda"*|*"dd if="*"of=/dev/"*)
    block "Blocked: direct disk write" ;;
esac

# Allow by default
allow
