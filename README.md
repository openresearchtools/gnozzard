# Gnozzard

Gnozzard is a simple classic GNOME desktop extension for Debian 13 (Trixie)
and newer. It is designed for the standard Debian GNOME desktop and assumes
that Nautilus is the file manager.

Gnozzard keeps GNOME's clock and system indicators, replaces the Activities
entry with a Resources launcher, and adds a permanent, solid-colour bottom
panel. It does not replace GNOME or install a separate desktop environment.

The panel provides:

- a tall, upward-opening, scrollable Applications menu;
- pinned applications at the menu's bottom edge;
- one task button per window (never grouped);
- click-to-focus/minimise task buttons;
- task-button actions for graceful Close and red Force Kill;
- drag-to-reorder task buttons with one shared order on every monitor;
- the same complete taskbar and open-window list on every connected monitor;
- a small, text-free Show Desktop button;
- application actions for pinning and creating desktop shortcuts;
- one-workspace and minimise-button defaults while the extension is enabled.

The implementation follows the old XFCE-style model: ordinary desktop files,
one button per window and event-driven updates. It is not an overview skin and
does not create workspace previews, live thumbnails or grouped app models.

The Debian package also installs Desktop Icons NG, native AppImage and portable
application support, AppImage MIME integration, and Nautilus actions for
launching an AppImage or adding it to Applications with one click. Local
`.desktop` launchers can also be added to Applications, while local `.deb`
packages get a direct **Install Debian Package…** action. The package includes
a lightly adapted fork of the GPL-3.0-or-later Resources 1.8.0 system monitor.

## Supported systems

The initial package targets Debian 13 (Trixie), GNOME Shell 48, and amd64. The
extension metadata declares Shell 46–48 because it uses the GNOME 45+ ESM
extension API. Later Debian releases are in scope, but a compatibility update
is required before the package can be installed with GNOME Shell 49 or newer.

## Install the Debian package

Download the `.deb` from a GitHub Actions build or GitHub Release, then run:

```sh
sudo apt install ./gnozzard_0.1.0_amd64.deb
```

APT installs any missing declared dependencies and leaves dependencies that
are already satisfied alone. Log out and back in after installation. The
session bootstrap enables Gnozzard and Desktop Icons NG for each user without
replacing the rest of the GNOME top bar.

## Build a .deb

On a clean Debian 13 machine:

```sh
sudo ./scripts/install-build-deps.sh
./scripts/vendor-cargo.sh
./scripts/build-deb.sh
```

`vendor-cargo.sh` makes the Resources Rust dependency graph available to the
network-isolated Debian build. The package is written to the parent directory.

## Automated builds

The **Build Debian package** workflow runs on Ubuntu 24.04 and performs the
build inside a disposable `debian:trixie` Podman container. The container is
removed after the `.deb` and its SHA-256 checksum have been copied out.

The identical disposable build can be run locally with:

```sh
./scripts/build-in-podman.sh
```

Every workflow run uploads the `.deb` and its checksum as a GitHub Actions
artifact. The workflow does not publish containers or create GitHub Releases.

## Development install

```sh
make install-user
```

Then log out/in and enable `gnozzard@openresearchtools` using Extensions.
The AppImage and Nautilus integrations are installed only by the Debian package.

## Test without installing

On a GNOME 48 desktop, run:

```sh
./scripts/run-nested-test.sh
```

This starts GNOME Shell's nested mode in a window with temporary XDG data,
configuration and cache directories. It exercises the real Shell extension but
does not change the normal session's extensions, workspaces or title buttons.
Close the nested desktop window to remove the temporary profile.

## Important behaviour

- Persistent Extract and Run uses `<full AppImage filename>.extracted` beside
  the original file and reuses that directory on later launches.
- Local `.deb` files receive an **Install Debian Package…** Files action. It
  asks for confirmation and lets APT resolve its dependencies. Install only
  packages from sources you trust.
- Disabling the extension restores the user's workspace, hot-corner, overview
  key, and title-button settings captured when it was first enabled.

## Repository layout

- `extension/` — GNOME Shell extension and settings schema
- `helper/` — AppImage launcher/registrar and desktop shortcut helper
- `integrations/nautilus/` — AppImage right-click actions
- `data/` — MIME, desktop, and session bootstrap integration
- `third_party/resources/` — pinned Resources v1.8.0 source
- `debian/` — Debian source package metadata

## License

Project-authored code is GPL-3.0-or-later. Vendored Resources retains its own
GPL-3.0-or-later notices; see `THIRD_PARTY.md`.
