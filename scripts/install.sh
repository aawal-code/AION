#!/usr/bin/env bash
# ==============================================================================
# AION: Universal Linux Installer & Systemd User Service Provisioner
# Distro-agnostic (apt, pacman, dnf, zypper) with zero-root requirements.
# ==============================================================================

set -eo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}=== AION // Universal Linux Engine Installer ===${NC}"

# 1. Resolve project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
echo -e "${BLUE}[INFO]${NC} Project root: ${PROJECT_ROOT}"

# 2. Check or install Node.js v20+
NODE_BIN="$(command -v node || true)"
NODE_OK=false

if [ -n "${NODE_BIN}" ]; then
    NODE_VER="$("${NODE_BIN}" -v | tr -d 'v')"
    MAJOR_VER="$(echo "${NODE_VER}" | cut -d'.' -f1)"
    if [ "${MAJOR_VER}" -ge 20 ]; then
        echo -e "${GREEN}[OK]${NC} Found Node.js v${NODE_VER} at ${NODE_BIN}"
        NODE_OK=true
    else
        echo -e "${YELLOW}[WARN]${NC} Installed Node.js (v${NODE_VER}) is older than v20."
    fi
fi

if [ "${NODE_OK}" = false ]; then
    echo -e "${BLUE}[INFO]${NC} Resolving standalone Node.js v20+ LTS runtime..."
    
    # Try package manager if root/sudo available
    PKG_INSTALLED=false
    if command -v apt-get >/dev/null 2>&1 && [ "$EUID" -eq 0 ]; then
        echo -e "${BLUE}[INFO]${NC} Using apt-get..."
        apt-get update -y && apt-get install -y nodejs npm || true
    elif command -v pacman >/dev/null 2>&1 && [ "$EUID" -eq 0 ]; then
        echo -e "${BLUE}[INFO]${NC} Using pacman..."
        pacman -Sy --noconfirm nodejs || true
    elif command -v dnf >/dev/null 2>&1 && [ "$EUID" -eq 0 ]; then
        echo -e "${BLUE}[INFO]${NC} Using dnf..."
        dnf install -y nodejs || true
    elif command -v zypper >/dev/null 2>&1 && [ "$EUID" -eq 0 ]; then
        echo -e "${BLUE}[INFO]${NC} Using zypper..."
        zypper --non-interactive in nodejs20 nodejs || true
    fi

    NODE_BIN="$(command -v node || true)"
    if [ -n "${NODE_BIN}" ]; then
        MAJOR_VER="$("${NODE_BIN}" -v | tr -d 'v' | cut -d'.' -f1)"
        if [ "${MAJOR_VER}" -ge 20 ]; then
            NODE_OK=true
        fi
    fi

    # Fallback to local user standalone binary download (zero-root requirement)
    if [ "${NODE_OK}" = false ]; then
        STANDALONE_DIR="${HOME}/.local/share/aion/runtime"
        mkdir -p "${STANDALONE_DIR}"
        ARCH="$(uname -m)"
        case "${ARCH}" in
            x86_64)  NODE_ARCH="x64" ;;
            aarch64) NODE_ARCH="arm64" ;;
            armv7l)  NODE_ARCH="armv7l" ;;
            *)       NODE_ARCH="x64" ;;
        esac

        TAR_NAME="node-v20.18.0-linux-${NODE_ARCH}.tar.xz"
        TAR_URL="https://nodejs.org/dist/v20.18.0/${TAR_NAME}"
        echo -e "${BLUE}[INFO]${NC} Downloading standalone Node runtime from ${TAR_URL}..."

        curl -fsSL "${TAR_URL}" -o "/tmp/${TAR_NAME}"
        tar -xJf "/tmp/${TAR_NAME}" -C "${STANDALONE_DIR}" --strip-components=1
        rm -f "/tmp/${TAR_NAME}"
        NODE_BIN="${STANDALONE_DIR}/bin/node"
        echo -e "${GREEN}[OK]${NC} Standalone Node runtime provisioned at ${NODE_BIN}"
    fi
fi

# 3. Dynamic .env generation
ENV_FILE="${PROJECT_ROOT}/.env"
if [ ! -f "${ENV_FILE}" ]; then
    echo -e "${BLUE}[INFO]${NC} Generating local .env configuration..."
    cat > "${ENV_FILE}" <<EOF
# AION Daemon Environment Configuration
PORT=5050
NODE_ENV=production
AION_ROOT=${PROJECT_ROOT}
EOF
    echo -e "${GREEN}[OK]${NC} Created ${ENV_FILE}"
fi

# 4. Desktop Application Integration (.desktop & icons)
echo -e "${BLUE}[INFO]${NC} Installing desktop launcher and scalable icon..."
APPS_DIR="${HOME}/.local/share/applications"
ICONS_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"
mkdir -p "${APPS_DIR}" "${ICONS_DIR}"

if [ -f "${PROJECT_ROOT}/public/icon.svg" ]; then
    cp -f "${PROJECT_ROOT}/public/icon.svg" "${ICONS_DIR}/aion.svg"
fi

cat > "${APPS_DIR}/aion.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=AION Systems Console
GenericName=Workstation Orchestrator
Comment=Zero-Cloud Workstation Orchestration Daemon
Exec=xdg-open http://127.0.0.1:5050
Icon=aion
Terminal=false
Categories=System;Utility;Network;
StartupNotify=true
EOF
chmod +x "${APPS_DIR}/aion.desktop"
echo -e "${GREEN}[OK]${NC} Installed desktop entry to ${APPS_DIR}/aion.desktop"

# 5. Systemd User Service Setup (Preserves DISPLAY, WAYLAND_DISPLAY, DBUS without root)
echo -e "${BLUE}[INFO]${NC} Registering systemd user service..."
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_USER_DIR}"

SERVICE_FILE="${SYSTEMD_USER_DIR}/aion.service"
SERVER_JS="${PROJECT_ROOT}/src/server.js"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=AION Autonomous Operations Daemon
After=network.target graphical-session.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${NODE_BIN} ${SERVER_JS}
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=5050
PassEnvironment=DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR XAUTHORITY

# Standard log output to systemd user journal
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user enable aion.service
    systemctl --user restart aion.service
    echo -e "${GREEN}[OK]${NC} Systemd user service aion.service enabled and started!"
    echo -e "${BLUE}[INFO]${NC} Check status with: ${BOLD}systemctl --user status aion.service${NC}"
else
    echo -e "${YELLOW}[WARN]${NC} systemctl not found; launch manually via: ${NODE_BIN} ${SERVER_JS}"
fi

echo -e "\n${BOLD}${GREEN}=== AION Linux Installation Complete ===${NC}"
echo -e "Web Console available at: ${BOLD}http://127.0.0.1:5050${NC}"
