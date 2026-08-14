import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gnozzard.com"),
  title: "Gnozzard — Classic GNOME desktop for Debian",
  description:
    "A classic GNOME desktop extension for Debian 13+ with native portable application and AppImage support.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Gnozzard",
    title: "Gnozzard — Classic GNOME desktop for Debian",
    description:
      "A classic GNOME desktop extension for Debian 13+ with native portable application and AppImage support.",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "Gnozzard — Classic GNOME desktop for Debian 13+",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gnozzard — Classic GNOME desktop for Debian",
    description:
      "A classic GNOME desktop extension for Debian 13+ with native portable application and AppImage support.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
