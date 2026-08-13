#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

command -v cargo >/dev/null 2>&1 || {
    echo "cargo is required; run sudo ./scripts/install-build-deps.sh" >&2
    exit 1
}

mkdir -p third_party/resources/.cargo
temporary=$(mktemp third_party/resources/.cargo/config.toml.XXXXXX)
trap 'rm -f "$temporary"' EXIT HUP INT TERM
cargo vendor --locked --manifest-path third_party/resources/Cargo.toml \
    third_party/resources/vendor | \
    sed 's|^directory = ".*"|directory = "vendor"|' >"$temporary"
mv "$temporary" third_party/resources/.cargo/config.toml
trap - EXIT HUP INT TERM
echo "Resources crates vendored in $project_dir/third_party/resources/vendor"
