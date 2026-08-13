#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root: sudo $0" >&2
    exit 1
fi

apt-get update
apt-get install -y \
    build-essential debhelper cargo rustc meson ninja-build pkg-config gettext \
    desktop-file-utils appstream gjs python3 libglib2.0-dev libgtk-4-dev libadwaita-1-dev
