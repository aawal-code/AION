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

# Parse command line flags
DEVICE_NAME=""
DEVICE_ROLE=""
TAILSCALE_KEY=""
SILENT=false

for arg in "$@"; do
    case "$arg" in
        --name=*)
            DEVICE_NAME="${arg#*=}"
            ;;
        --role=*)
            DEVICE_ROLE="${arg#*=}"
            ;;
        --authkey=*)
            TAILSCALE_KEY="${arg#*=}"
            ;;
        -y|--silent|--quiet)
            SILENT=true
            ;;
    esac
done

# Detect or prompt device name
if [ -z "${DEVICE_NAME}" ]; then
    DEFAULT_NAME="$(hostname 2>/dev/null || echo "Linux-Node")"
    if [ "${SILENT}" = true ]; then
        DEVICE_NAME="${DEFAULT_NAME}"
    else
        read -r -p "Enter friendly device name [${DEFAULT_NAME}]: " input_name
        DEVICE_NAME="${input_name:-${DEFAULT_NAME}}"
    fi
fi

# Detect or prompt device role (desktop vs laptop)
if [ -z "${DEVICE_ROLE}" ]; then
    DETECTED_ROLE="desktop"
    if [ -f "/sys/class/dmi/id/chassis_type" ]; then
        CHASSIS="$(cat /sys/class/dmi/id/chassis_type 2>/dev/null || echo 0)"
        if [ "${CHASSIS}" -eq 8 ] || [ "${CHASSIS}" -eq 9 ] || [ "${CHASSIS}" -eq 10 ] || [ "${CHASSIS}" -eq 14 ]; then
            DETECTED_ROLE="laptop"
        fi
    fi
    DEVICE_ROLE="${DETECTED_ROLE}"
fi

echo -e "${GREEN}[OK]${NC} Configured device: ${BOLD}${DEVICE_NAME}${NC} (${DEVICE_ROLE})"

# 1. Resolve project root and user state directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/../../package.json" ]; then
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
AION_DATA_DIR="${HOME}/.local/share/aion"
mkdir -p "${AION_DATA_DIR}" "${PROJECT_ROOT}/data"

echo -e "${BLUE}[INFO]${NC} Project root: ${PROJECT_ROOT}"

# Save Device Identity
cat > "${PROJECT_ROOT}/data/device-identity.json" <<EOF
{
  "name": "${DEVICE_NAME}",
  "role": "${DEVICE_ROLE}",
  "configuredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

# 2. Check or install Node.js v20+
NODE_BIN="$(command -v node || true)"
NODE_OK=false
INSTALLED_NODE=false

if [ -n "${NODE_BIN}" ]; then
    NODE_VER="$("${NODE_BIN}" -v | tr -d 'v')"
    MAJOR_VER="$(echo "${NODE_VER}" | cut -d'.' -f1)"
    if [ "${MAJOR_VER}" -ge 20 ]; then
        echo -e "${GREEN}[OK]${NC} Found existing Node.js v${NODE_VER} at ${NODE_BIN}"
        NODE_OK=true
        INSTALLED_NODE=false
    else
        echo -e "${YELLOW}[WARN]${NC} Installed Node.js (v${NODE_VER}) is older than v20."
    fi
fi

if [ "${NODE_OK}" = false ]; then
    echo -e "${BLUE}[INFO]${NC} Resolving standalone Node.js v20+ LTS runtime..."
    INSTALLED_NODE=true
    
    # Try package manager if root/sudo available
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
        STANDALONE_DIR="${AION_DATA_DIR}/runtime"
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

# 3. Check or install Tailscale
INSTALLED_TAILSCALE=false
if command -v tailscale >/dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC} Found existing Tailscale installation."
    INSTALLED_TAILSCALE=false
else
    echo -e "${BLUE}[INFO]${NC} Tailscale not found; attempting unattended installation..."
    if command -v curl >/dev/null 2>&1; then
        if [ "$EUID" -eq 0 ] || command -v sudo >/dev/null 2>&1; then
            if curl -fsSL https://tailscale.com/install.sh | sh; then
                echo -e "${GREEN}[OK]${NC} Tailscale installed successfully."
                INSTALLED_TAILSCALE=true
            else
                echo -e "${YELLOW}[WARN]${NC} Tailscale automated install failed; mesh features will be available when Tailscale is installed manually."
            fi
        else
            echo -e "${YELLOW}[WARN]${NC} Tailscale requires root/sudo privileges to install. You can install it manually from https://tailscale.com"
        fi
    fi
fi

if [ -n "${TAILSCALE_KEY}" ] && command -v tailscale >/dev/null 2>&1; then
    tailscale up --authkey="${TAILSCALE_KEY}" --hostname="${DEVICE_NAME}" --accept-routes=false 2>/dev/null || true
fi

# 4. Check for RustDesk Remote Screen View
INSTALLED_RUSTDESK=false
RUSTDESK_BIN="$(command -v rustdesk || true)"
if [ -z "${RUSTDESK_BIN}" ] && [ -f "/usr/bin/rustdesk" ]; then
    RUSTDESK_BIN="/usr/bin/rustdesk"
fi
if [ -z "${RUSTDESK_BIN}" ] && [ -f "${HOME}/.local/bin/rustdesk" ]; then
    RUSTDESK_BIN="${HOME}/.local/bin/rustdesk"
fi

if [ -n "${RUSTDESK_BIN}" ]; then
    echo -e "${GREEN}[OK]${NC} Found RustDesk Remote Screen View at ${RUSTDESK_BIN}"
    INSTALLED_RUSTDESK=true
    cat > "${PROJECT_ROOT}/data/screen-view.json" <<EOF
{
  "installed": true,
  "portable": false,
  "path": "${RUSTDESK_BIN}",
  "ready": true,
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
else
    echo -e "${BLUE}[INFO]${NC} RustDesk not detected; remote screen view can be configured anytime."
    cat > "${PROJECT_ROOT}/data/screen-view.json" <<EOF
{
  "installed": false,
  "portable": false,
  "ready": false,
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
fi

# 5. Write install-manifest.json
MANIFEST_FILE="${AION_DATA_DIR}/install-manifest.json"
cat > "${MANIFEST_FILE}" <<EOF
{
  "version": "1.0.0-beta.2",
  "installPath": "${PROJECT_ROOT}",
  "installDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "installedNode": ${INSTALLED_NODE},
  "installedTailscale": ${INSTALLED_TAILSCALE},
  "installedRustDesk": ${INSTALLED_RUSTDESK}
}
EOF
cp -f "${MANIFEST_FILE}" "${PROJECT_ROOT}/install-manifest.json" 2>/dev/null || true
echo -e "${GREEN}[OK]${NC} Written installation manifest to ${MANIFEST_FILE}"

# 6. Dynamic .env generation
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

# 7. Install CLI Launcher wrapper (~/.local/bin/aion)
BIN_DIR="${HOME}/.local/bin"
mkdir -p "${BIN_DIR}"
CLI_WRAPPER="${BIN_DIR}/aion"
cat > "${CLI_WRAPPER}" <<EOF
#!/usr/bin/env bash
exec "${NODE_BIN}" "${PROJECT_ROOT}/src/launcher.js" "\$@"
EOF
chmod +x "${CLI_WRAPPER}"
echo -e "${GREEN}[OK]${NC} Installed CLI launcher to ${CLI_WRAPPER}"

# 8. Desktop Application Integration (.desktop & brand icons)
echo -e "${BLUE}[INFO]${NC} Installing desktop launcher and brand icons..."
APPS_DIR="${HOME}/.local/share/applications"
ICONS_SCALABLE="${HOME}/.local/share/icons/hicolor/scalable/apps"
ICONS_512="${HOME}/.local/share/icons/hicolor/512x512/apps"
mkdir -p "${APPS_DIR}" "${ICONS_SCALABLE}" "${ICONS_512}"

if [ -f "${PROJECT_ROOT}/public/brand/icon-light.svg" ]; then
    cp -f "${PROJECT_ROOT}/public/brand/icon-light.svg" "${ICONS_SCALABLE}/aion.svg"
fi
if [ -f "${PROJECT_ROOT}/public/brand/icon-512.png" ]; then
    cp -f "${PROJECT_ROOT}/public/brand/icon-512.png" "${ICONS_512}/aion.png"
fi

cat > "${APPS_DIR}/aion.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=AION
GenericName=Workstation Orchestrator
Comment=Autonomous Interactive Operations Node
Exec=${CLI_WRAPPER}
Icon=aion
Terminal=false
Categories=System;Utility;Network;
StartupNotify=true
EOF
chmod +x "${APPS_DIR}/aion.desktop"
echo -e "${GREEN}[OK]${NC} Installed desktop entry to ${APPS_DIR}/aion.desktop"

# 9. Systemd User Service Setup (Preserves DISPLAY, WAYLAND_DISPLAY, DBUS without root)
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
    echo -e "${YELLOW}[WARN]${NC} systemctl not found; launch manually via: ${CLI_WRAPPER}"
fi

echo -e "\n${BOLD}${GREEN}=== AION Linux Installation Complete ===${NC}"
echo -e "Web Console available at: ${BOLD}http://127.0.0.1:5050${NC}"
echo -e "Launch app window with: ${BOLD}aion${NC}"
