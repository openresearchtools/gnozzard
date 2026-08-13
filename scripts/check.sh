#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' -v
PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/gnozzard-pycache" \
    python3 -m py_compile helper/gnozzard helper/gnozzard-deb-installer \
        integrations/nautilus/gnozzard.py
desktop-file-validate data/gnozzard-appimage-launcher.desktop data/gnozzard-session.desktop
glib-compile-schemas --strict --dry-run extension/gnozzard@openresearchtools/schemas

# gjs parses the complete module before resolving Shell-only runtime globals.
# A missing resource import is expected outside the Shell process; syntax errors
# are not.
gjs -m extension/gnozzard@openresearchtools/extension.js >/tmp/gnozzard-gjs-check.log 2>&1 || {
    if grep -qiE 'SyntaxError|parse error' /tmp/gnozzard-gjs-check.log; then
        cat /tmp/gnozzard-gjs-check.log >&2
        exit 1
    fi
}

echo "Gnozzard checks passed"
