#!/usr/bin/env bash
# asistenku installer
# Usage: curl -fsSL https://raw.githubusercontent.com/zesbe/asistenku/main/install.sh | bash

set -e

REPO="zesbe/asistenku"
INSTALL_DIR="${ASISTENKU_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux) OS=linux ;;
  darwin) OS=darwin ;;
  msys*|mingw*|cygwin*) OS=windows ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

BINARY_NAME="asistenku-${OS}-${ARCH}"
[ "$OS" = "windows" ] && BINARY_NAME="${BINARY_NAME}.exe"

LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
echo "🔍 Fetching latest release..."
LATEST_VERSION=$(curl -fsSL "$LATEST_URL" | grep '"tag_name"' | head -1 | cut -d'"' -f4)

if [ -z "$LATEST_VERSION" ]; then
  echo "❌ Cannot fetch latest release"
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_VERSION}/${BINARY_NAME}"
echo "📦 Downloading ${BINARY_NAME} ${LATEST_VERSION}..."

mkdir -p "$INSTALL_DIR"
TARGET="$INSTALL_DIR/asistenku"
[ "$OS" = "windows" ] && TARGET="${TARGET}.exe"

curl -fL "$DOWNLOAD_URL" -o "$TARGET"
chmod +x "$TARGET"

echo "✅ Installed to $TARGET"
echo ""

# Check PATH
if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  echo "⚠️  $INSTALL_DIR is not in PATH. Add to your shell profile:"
  echo ""
  echo "   export PATH=\"$INSTALL_DIR:\$PATH\""
  echo ""
fi

echo "🚀 Get started:"
echo "   asistenku login anthropic    # Configure provider"
echo "   asistenku                    # Start chat"
echo "   asistenku --help             # See all options"
