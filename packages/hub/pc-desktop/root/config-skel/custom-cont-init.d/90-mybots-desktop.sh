#!/bin/bash
# Fallback: se a imagem base nao tiver os pacotes, tenta instalar.
set -e
if ! command -v tint2 >/dev/null 2>&1 || ! command -v swaybg >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    tint2 pcmanfm-qt swaybg qt6-wayland feh || true
fi
chmod +x /config/.config/labwc/autostart /config/.config/openbox/autostart 2>/dev/null || true
chmod +x /config/Desktop/*.desktop 2>/dev/null || true
