# Linux GUI

Linux GUI uses GTK4/libadwaita for the local Agent configuration and WebKitGTK
6.0 for the Hub web view. The Go collector and local backend remain separate
processes so the GUI can restart without losing the configuration state.

The first installable delivery is a Debian package built for Linux `amd64`.
It installs the application under `/usr/lib/device-state-console`, a desktop
entry, an icon, and a systemd user unit. The GUI starts the user service when
available and falls back to an attached local backend when systemd user
services are unavailable.

The user configuration is stored under:

```text
~/.config/device-state-console/
```

The package expects GTK4, libadwaita and WebKitGTK 6.0 runtime libraries from
the distribution. The release workflow currently builds and smoke-checks the
package on Ubuntu 24.04.
