"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const githubUrl = "https://github.com/openresearchtools/gnozzard";
const latestDebUrl =
  "https://github.com/openresearchtools/gnozzard/releases/latest/download/gnozzard_amd64.deb";
const oneCommandInstall = `wget -qO /tmp/gnozzard_amd64.deb ${latestDebUrl} && sudo apt install /tmp/gnozzard_amd64.deb`;

export default function Home() {
  const [installOpen, setInstallOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const privacyHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setInstallOpen(false);
      setPrivacyOpen(false);
    }

    function handlePointerDown(event: PointerEvent) {
      const host = privacyHostRef.current;
      if (host && !host.contains(event.target as Node)) {
        setPrivacyOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("modal-open", installOpen);
    if (installOpen) closeButtonRef.current?.focus();
    return () => document.body.classList.remove("modal-open");
  }, [installOpen]);

  return (
    <div className="site" id="top">
      <header className="site-header">
        <div className="header-inner">
          <a
            className="button button-muted header-github"
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>

          <a className="brand" href="#top" aria-label="Gnozzard home">
            Gnozzard
          </a>

          <nav className="header-actions" aria-label="Download Gnozzard">
            <button
              className="button button-muted"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={installOpen}
              onClick={() => setInstallOpen(true)}
            >
              Install
            </button>
            <a className="button button-primary" href={latestDebUrl}>
              Download
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Debian 13+ · GNOME edition</p>
            <h1 id="hero-title">
              A classic GNOME desktop with native portable-app and AppImage
              support.
            </h1>
            <p className="intro">
              Gnozzard is an{" "}
              <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                open-source
              </a>{" "}
              classic GNOME desktop extension for Debian 13 (Trixie) and newer,
              licensed under GPL-3.0-or-later. It is designed for the standard
              Debian GNOME desktop and assumes that Nautilus is the file
              manager.
            </p>
          </div>

          <figure className="showcase">
            <Image
              src="/showcase/gnozzard-showcase.webp"
              alt="Gnozzard desktop, Applications menu, portable app actions, Debian package installation, pinned applications, process I/O, and ungrouped taskbar"
              width="3840"
              height="2320"
              priority
              unoptimized
            />
          </figure>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-copy">
            <p>© 2026 Open Research Tools · GPL-3.0-or-later</p>
            <p className="affiliation-note">
              Gnozzard is not affiliated with or endorsed by{" "}
              <a href="https://www.debian.org/" target="_blank" rel="noopener noreferrer">
                Debian
              </a>
              ,{" "}
              <a href="https://www.gnome.org/" target="_blank" rel="noopener noreferrer">
                GNOME
              </a>
              ,{" "}
              <a href="https://github.com/nokyan/resources" target="_blank" rel="noopener noreferrer">
                Resources
              </a>
              ,{" "}
              <a href="https://gitlab.gnome.org/GNOME/nautilus" target="_blank" rel="noopener noreferrer">
                Nautilus
              </a>
              , or applications shown in the demonstration.
            </p>
          </div>

          <div
            className={`overlay-host footer-policy${privacyOpen ? " is-open" : ""}`}
            ref={privacyHostRef}
          >
            <button
              className="footer-link overlay-trigger"
              type="button"
              aria-expanded={privacyOpen}
              aria-controls="privacy-policy-overlay"
              onClick={() => setPrivacyOpen((open) => !open)}
            >
              Cookie &amp; Privacy Policy
            </button>
            <div
              className="policy-overlay"
              id="privacy-policy-overlay"
              role="dialog"
              aria-label="Cookie and privacy policy"
            >
              <p>
                <em>Last updated: 14 August 2026</em>
              </p>
              <p>
                <strong>gnozzard.com</strong> does not set cookies, use
                analytics or advertising trackers, or collect personal
                information from visitors.
              </p>
              <p>
                <strong>Hosting and logs</strong>
              </p>
              <p>
                The hosting provider may process limited technical request
                data, such as an IP address and basic request information, to
                serve and secure the site.
              </p>
              <p>
                <strong>External links</strong>
              </p>
              <p>
                This site links to third-party websites. Their privacy
                practices and content are governed by their own policies.
              </p>
            </div>
          </div>
        </div>
      </footer>

      {installOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setInstallOpen(false);
          }}
        >
          <section
            className="install-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Debian 13+</p>
                <h2 id="install-title">Install Gnozzard</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                aria-label="Close install instructions"
                ref={closeButtonRef}
                onClick={() => setInstallOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="install-option">
              <h3>One-command install</h3>
              <p>Download the latest package and let APT install its dependencies.</p>
              <pre>
                <code>{oneCommandInstall}</code>
              </pre>
            </div>

            <div className="install-option">
              <h3>Download from GitHub Releases</h3>
              <p>
                <a href={latestDebUrl}>Download gnozzard_amd64.deb</a>, open a
                terminal in the download folder, and run:
              </p>
              <pre>
                <code>sudo apt install ./gnozzard_amd64.deb</code>
              </pre>
            </div>

            <p className="modal-footnote">
              Log out and back in after installation.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
