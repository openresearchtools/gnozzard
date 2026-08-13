#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
uuid=gnozzard@openresearchtools
test_root=$(mktemp -d "${TMPDIR:-/tmp}/gnozzard-test.XXXXXX")

cleanup() {
    if command -v gio >/dev/null 2>&1; then
        gio trash "$test_root" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT HUP INT TERM

test_data="$test_root/data"
test_config="$test_root/config"
test_cache="$test_root/cache"
extension_dir="$test_data/gnome-shell/extensions/$uuid"

mkdir -p "$extension_dir" "$test_config" "$test_cache"
cp -a "$project_dir/extension/$uuid/." "$extension_dir/"
glib-compile-schemas "$extension_dir/schemas"

test_env="XDG_DATA_HOME=$test_data XDG_CONFIG_HOME=$test_config XDG_CACHE_HOME=$test_cache GSETTINGS_BACKEND=keyfile"

env $test_env gsettings set org.gnome.shell disable-user-extensions false
env $test_env gsettings set org.gnome.shell enabled-extensions "['$uuid']"

echo "Opening an isolated nested GNOME desktop."
echo "Use its Applications button to launch programs inside it."
echo "Close the nested desktop window to finish; your normal GNOME settings are untouched."

exec dbus-run-session -- env $test_env gnome-shell --nested --wayland
