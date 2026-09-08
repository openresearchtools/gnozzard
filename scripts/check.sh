#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

check_tmp=$(mktemp -d "${TMPDIR:-/tmp}/gnozzard-check.XXXXXX")
trap 'rm -rf "$check_tmp"' EXIT HUP INT TERM

PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' -v
PYTHONPYCACHEPREFIX="$check_tmp/pycache" \
    python3 -m py_compile helper/gnozzard helper/gnozzard-deb-installer \
        integrations/nautilus/gnozzard.py data/gnozzard-settings
desktop-file-validate data/gnozzard-appimage-launcher.desktop \
    data/com.openresearchtools.GnozzardSettings.desktop
glib-compile-schemas --strict --dry-run extension/gnozzard@openresearchtools/schemas
gjs -m tests/tilingLayout.js
gjs -m tests/tilingController.js
gjs -m tests/barAutoHide.js
gjs -m tests/barLayout.js
gjs -m tests/windowActions.js
gjs -m tests/workplaceEdges.js
gjs -m tests/workplaces.js

# gjs parses the complete module before resolving Shell-only runtime globals.
# A missing resource import is expected outside the Shell process; syntax errors
# are not.
for module in extension.js tiling.js tilingOwnership.js workplaces.js barAutoHide.js windowActions.js workplaceEdges.js; do
gjs -m "extension/gnozzard@openresearchtools/$module" >"$check_tmp/gjs.log" 2>&1 || {
    if grep -qiE 'SyntaxError|parse error' "$check_tmp/gjs.log"; then
        cat "$check_tmp/gjs.log" >&2
        exit 1
    fi
}
done

echo "Gnozzard checks passed"
