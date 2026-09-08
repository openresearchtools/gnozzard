# Gnozzard

Gnozzard is an open-source GNOME desktop extension for Debian 13+ and Ubuntu 24.04/26.04+, with full optional auto-tiling and 12 desktop customisation controls. It includes native workplaces, a classic Applications menu, and portable application and AppImage support.

## Install

Add the Open Research Tools repository and install Gnozzard:

```sh
wget -qO /tmp/keyring.deb https://keyring.openresearchtools.com && sudo apt install -y /tmp/keyring.deb && sudo apt update && sudo apt install -y gnozzard
```

Repository already configured:

```sh
sudo apt update && sudo apt install -y gnozzard
```

Log out and back in after installation. Packages are available for amd64 and arm64.

## Screenshots

![Gnozzard desktop and portable application workflow](docs/showcase/gnozzard-showcase.webp)

<sub><em>Gnozzard is not affiliated with or endorsed by upstream projects such as <a href="https://salsa.debian.org/gnome-team" target="_blank" rel="noopener noreferrer">Debian GNOME</a>, <a href="https://ubuntu.com/" target="_blank" rel="noopener noreferrer">Ubuntu</a>, <a href="https://gitlab.gnome.org/GNOME/gnome-shell" target="_blank" rel="noopener noreferrer">GNOME Shell</a>, <a href="https://github.com/nokyan/resources" target="_blank" rel="noopener noreferrer">Resources</a>, <a href="https://gitlab.gnome.org/GNOME/nautilus" target="_blank" rel="noopener noreferrer">Nautilus</a>, <a href="https://projects.blender.org/blender/blender" target="_blank" rel="noopener noreferrer">Blender</a>, or <a href="https://invent.kde.org/graphics/krita" target="_blank" rel="noopener noreferrer">Krita</a>. Applications are shown only to demonstrate desktop and application-menu functionality.</em></sub>

![Gnozzard settings with 12 desktop customisation controls](docs/showcase/gnozzard-settings.png)

## Licence and credits

Gnozzard is licensed under [GPL-3.0-or-later](LICENSE). The bundled system monitor is based on [Resources](https://github.com/nokyan/resources); third-party projects retain their own licences.
