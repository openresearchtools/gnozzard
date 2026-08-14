import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the Gnozzard landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Gnozzard — Classic GNOME desktop for Debian<\/title>/i);
  assert.match(html, /Classic Desktop for Debian 13\+ · GNOME edition/i);
  assert.match(html, /classic GNOME desktop extension with native portable apps/i);
  assert.match(html, /licensed under GPL-3\.0/i);
  assert.match(html, /gnozzard-showcase\.webp/i);
  assert.match(html, /releases\/latest\/download\/gnozzard_amd64\.deb/i);
  assert.match(html, /Cookie &amp; Privacy Policy/i);
  assert.match(html, /GitHub Pages/i);
  assert.match(html, /GitHub Privacy Statement/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
