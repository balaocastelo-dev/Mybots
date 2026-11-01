# Desktop leve no PC do bot (labwc/Wayland + tint2 + ícones MyBots).
# Base pinada — a mesma do Hub (Selkies 2.1 + Chromium + CDP).
FROM lscr.io/linuxserver/chromium:1aca5d17-ls61
USER root
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      tint2 pcmanfm-qt swaybg qt6-wayland feh \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*
COPY root/defaults/autostart /defaults/autostart
COPY root/defaults/autostart_wayland /defaults/autostart_wayland
COPY root/defaults/menu.xml /defaults/menu.xml
RUN chmod +x /defaults/autostart /defaults/autostart_wayland
# Skel copiado para volumes via garantirDesktop no Hub.
