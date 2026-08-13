#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
image=${GNOZZARD_BUILD_IMAGE:-docker.io/library/debian:trixie}

command -v podman >/dev/null 2>&1 || {
    echo "podman is required to run the disposable Debian build" >&2
    exit 1
}

mkdir -p "$project_dir/dist"

podman run --rm --pull=newer \
    --volume "$project_dir:/source:ro" \
    --volume "$project_dir/dist:/out" \
    "$image" \
    sh -euxc '
        export DEBIAN_FRONTEND=noninteractive
        mkdir -p /work/gnozzard
        cp -a /source/. /work/gnozzard/
        cd /work/gnozzard
        apt-get update
        apt-get install -y --no-install-recommends ca-certificates git lintian
        ./scripts/install-build-deps.sh
        ./scripts/vendor-cargo.sh
        ./scripts/check.sh
        ./scripts/build-deb.sh
        lintian --tag-display-limit 0 /work/gnozzard_*.deb
        cp /work/gnozzard_*.deb /work/gnozzard_*.buildinfo \
            /work/gnozzard_*.changes /out/
        cd /out
        for package in gnozzard_*.deb; do
            sha256sum "$package" > "$package.sha256"
            sha256sum --check "$package.sha256"
        done
    '

echo "Gnozzard package and checksums are in $project_dir/dist"
