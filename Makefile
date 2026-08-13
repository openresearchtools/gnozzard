UUID := gnozzard@openresearchtools
EXTENSION := extension/$(UUID)
USER_EXTENSION := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: check install-user uninstall-user build-deb vendor

check:
	./scripts/check.sh

install-user:
	install -d "$(USER_EXTENSION)"
	cp -a "$(EXTENSION)/." "$(USER_EXTENSION)/"
	glib-compile-schemas "$(USER_EXTENSION)/schemas"

uninstall-user:
	rm -rf "$(USER_EXTENSION)"

vendor:
	./scripts/vendor-cargo.sh

build-deb:
	./scripts/build-deb.sh
