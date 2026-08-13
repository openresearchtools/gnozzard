#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ ! -f third_party/resources/.cargo/config.toml ] || \
   [ ! -d third_party/resources/vendor ]; then
    echo "Run ./scripts/vendor-cargo.sh before building." >&2
    exit 1
fi

dpkg-buildpackage --build=binary --no-sign
