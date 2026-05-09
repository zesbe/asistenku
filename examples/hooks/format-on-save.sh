#!/usr/bin/env bash
# Hook: auto-format files after write_file or edit_file
# Reads hook event from stdin, extracts file path, runs appropriate formatter

set -e

# Read JSON event from stdin
EVENT=$(cat)
FILE=$(echo "$EVENT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('args',{}).get('path',''))" 2>/dev/null)

[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.md|*.html|*.css|*.scss)
    command -v prettier >/dev/null && prettier --write --log-level=warn "$FILE" 2>/dev/null || true
    ;;
  *.py)
    command -v black >/dev/null && black --quiet "$FILE" 2>/dev/null || \
      (command -v ruff >/dev/null && ruff format "$FILE" 2>/dev/null) || true
    ;;
  *.go)
    command -v gofmt >/dev/null && gofmt -w "$FILE" 2>/dev/null || true
    ;;
  *.rs)
    command -v rustfmt >/dev/null && rustfmt "$FILE" 2>/dev/null || true
    ;;
  *.sh)
    command -v shfmt >/dev/null && shfmt -w "$FILE" 2>/dev/null || true
    ;;
esac

# Log to stderr (non-blocking)
echo "Formatted: $FILE" >&2
