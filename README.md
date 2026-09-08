# Gnozzard

![Gnozzard desktop and portable application workflow](docs/showcase/gnozzard-showcase.webp)

<sub><em>Gnozzard is not affiliated with or endorsed by upstream projects such as <a href="https://salsa.debian.org/gnome-team" target="_blank" rel="noopener noreferrer">Debian GNOME</a>, <a href="https://ubuntu.com/" target="_blank" rel="noopener noreferrer">Ubuntu</a>, <a href="https://gitlab.gnome.org/GNOME/gnome-shell" target="_blank" rel="noopener noreferrer">GNOME Shell</a>, <a href="https://github.com/nokyan/resources" target="_blank" rel="noopener noreferrer">Resources</a>, <a href="https://gitlab.gnome.org/GNOME/nautilus" target="_blank" rel="noopener noreferrer">Nautilus</a>, <a href="https://projects.blender.org/blender/blender" target="_blank" rel="noopener noreferrer">Blender</a>, or <a href="https://invent.kde.org/graphics/krita" target="_blank" rel="noopener noreferrer">Krita</a>. Applications are shown only to demonstrate desktop and application-menu functionality.</em></sub>

Gnozzard is a simple classic GNOME desktop extension for Debian\* 13+ and
Ubuntu\* 24.04/26.04+, with native support for portable applications and
AppImages. It also offers full optional auto-tiling and 12 desktop customisation
controls. It is designed for the standard GNOME desktop and assumes that
Nautilus is the file manager.

## Install the package

For the first Open Research Tools installation on a system, this one command
adds the archive key and repository, refreshes APT, and installs Gnozzard:

```sh
wget -qO /tmp/keyring.deb https://keyring.openresearchtools.com && sudo apt install -y /tmp/keyring.deb && sudo apt update && sudo apt install -y gnozzard
```

If the Open Research Tools APT repository is already configured:

```sh
sudo apt install gnozzard
```

APT automatically selects both packages matching the system architecture and
installs `gnozzard-resources` with the desktop package. Each GitHub Release also
contains both packages for each supported architecture. Log out and back in
after installation.

![Gnozzard settings with 12 desktop customisation controls](docs/showcase/gnozzard-settings.png)

## License

This project is licensed under GPL-3.0-or-later. Third-party packages retain
their own licenses.
