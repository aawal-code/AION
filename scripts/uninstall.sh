#!/usr/bin/env bash
# ==============================================================================
# AION: Universal Linux Uninstaller
# Stops systemd user service, removes desktop integrations, cleanups files,
# and safely removes Tailscale only if it was installed by AION.
# ==============================================================================

set -eo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}=== AION // Universal Linux Uninstaller ===${NC}"

# Optional confirmation if not silent
SILENT=false
for arg in "$@"; do
    if [ "$arg" = "-y" ] || [ "$arg" = "--silent" ] || [ "$arg" = "--quiet" ]; then
        SILENT=true
    fi
done

if [ "$SILENT" = false ]; then
    read -p "Are you sure you want to uninstall AION and stop all background services? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}[CANCELLED]${NC} Uninstallation aborted."
        exit 0
    fi
fi

# 1. Stop and Disable Systemd User Service
if command -v systemctl >/dev/null 2>&1; then
    echo -e "${BLUE}[INFO]${NC} Stopping and disabling systemd user service..."
    systemctl --user stop aion.service 2>/dev/null || true
    systemctl --user disable aion.service 2>/dev/null || true
    rm -f "${HOME}/.config/systemd/user/aion.service"
    systemctl --user daemon-reload 2>/dev/null || true
    echo -e "${GREEN}[OK]${NC} Systemd user service removed."
fi

# 2. Remove CLI wrapper
CLI_WRAPPER="${HOME}/.local/bin/aion"
if [ -f "${CLI_WRAPPER}" ]; then
    rm -f "${CLI_WRAPPER}"
    echo -e "${GREEN}[OK]${NC} Removed ${CLI_WRAPPER}"
fi

# 3. Remove Desktop Entry & Icons
DESKTOP_ENTRY="${HOME}/.local/share/applications/aion.desktop"
if [ -f "${DESKTOP_ENTRY}" ]; then
    rm -f "${DESKTOP_ENTRY}"
    echo -e "${GREEN}[OK]${NC} Removed ${DESKTOP_ENTRY}"
fi

rm -f "${HOME}/.local/share/icons/hicolor/scalable/apps/aion.svg"
rm -f "${HOME}/.local/share/icons/hicolor/512x512/apps/aion.png"

# 4. Check installation manifest for Tailscale & Runtime records
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/../../package.json" ]; then
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
AION_DATA_DIR="${HOME}/.local/share/aion"
MANIFEST_FILE="${AION_DATA_DIR}/install-manifest.json"
[ ! -f "${MANIFEST_FILE}" ] && [ -f "${PROJECT_ROOT}/install-manifest.json" ] && MANIFEST_FILE="${PROJECT_ROOT}/install-manifest.json"

SHOULD_UNINSTALL_TAILSCALE=false

if [ -f "${MANIFEST_FILE}" ]; then
    if grep -q '"installedTailscale": true' "${MANIFEST_FILE}" || grep -q '"installedTailscale":true' "${MANIFEST_FILE}"; then
        SHOULD_UNINSTALL_TAILSCALE=true
    fi
fi

# 5. Clean Tailscale if and only if installed by AION
if [ "${SHOULD_UNINSTALL_TAILSCALE}" = true ]; then
    echo -e "${BLUE}[INFO]${NC} Tailscale was installed by AION; removing Tailscale package..."
    if command -v apt-get >/dev/null 2>&1 && ([ "$EUID" -eq 0 ] || command -v sudo >/dev/null 2>&1); then
        SUDO_CMD=""
        [ "$EUID" -ne 0 ] && SUDO_CMD="sudo"
        $SUDO_CMD apt-get remove -y tailscale 2>/dev/null || true
    elif command -v dnf >/dev/null 2>&1 && ([ "$EUID" -eq 0 ] || command -v sudo >/dev/null 2>&1); then
        SUDO_CMD=""
        [ "$EUID" -ne 0 ] && SUDO_CMD="sudo"
        $SUDO_CMD dnf remove -y tailscale 2>/dev/null || true
    elif command -v pacman >/dev/null 2>&1 && ([ "$EUID" -eq 0 ] || command -v sudo >/dev/null 2>&1); then
        SUDO_CMD=""
        [ "$EUID" -ne 0 ] && SUDO_CMD="sudo"
        $SUDO_CMD pacman -R --noconfirm tailscale 2>/dev/null || true
    fi
    echo -e "${GREEN}[OK]${NC} Tailscale cleanly uninstalled."
else
    echo -e "${BLUE}[INFO]${NC} Preserving Tailscale configuration (not installed by AION)."
fi

# 6. Remove AION user data directory
if [ -d "${AION_DATA_DIR}" ]; then
    rm -rf "${AION_DATA_DIR}"
    echo -e "${GREEN}[OK]${NC} Removed ${AION_DATA_DIR}"
fi

echo -e "\n${BOLD}${GREEN}=== AION Linux Uninstallation Complete ===${NC}"
