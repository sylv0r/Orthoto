# orthoto

Self-hosted **French / English** spelling and grammar checker, in a single Docker container.

Paste your text, press **Enter**, and the corrected version appears below, ready to copy.
No rephrasing: only actual errors are fixed, style suggestions are ignored, and a text without
errors comes back unchanged.

- Engine: [LanguageTool](https://github.com/languagetool-org/languagetool) 6.8 (LGPL), rule-based,
  not an LLM.
- Front-end: plain HTML + JS, no framework, no build step, about 10 KB.
- Auth: HTTP Basic Auth, the browser's native username/password prompt.
- Image: about 200 MB, about 500 MB of RAM, ready in about 2 s and warmed up in about 10 s.
- Chrome/Edge/Firefox extension (about 20 KB) that underlines errors in every text field, backed by the
  same server.

## Getting started

```sh
cp .env.example .env        # then pick a real password in .env
docker compose up -d --build
```

Then open <http://your-server:8080>. The browser asks for the username (`admin` by default) and
the password. Save them in your password manager so the prompt is pre-filled next time.

Without compose:

```sh
docker build -t orthoto .
docker run -d --name orthoto --restart unless-stopped -p 8080:8080 \
  -e AUTH_PASSWORD='a-real-password' orthoto
```

| Variable        | Default | Purpose                                                                  |
|-----------------|---------|--------------------------------------------------------------------------|
| `AUTH_USER`     | `admin` | Basic Auth username                                                      |
| `AUTH_PASSWORD` | none    | password; if unset, a random one is generated and printed in `docker logs` |
| `JAVA_XMX`      | `512m`  | maximum heap of the LanguageTool JVM                                     |

> The container serves plain HTTP on port 8080. That is fine on your local network. To reach it
> from the internet, put it behind an HTTPS reverse proxy (Caddy, Traefik, Nginx Proxy Manager, or a
> Cloudflare Tunnel): over HTTP, the password travels in clear text.

## Usage

- **FR / EN**: toggle above the text field (French by default). Switching language re-runs the check.
- **Enter** to correct, **Shift+Enter** for a new line.
- Corrections are highlighted in green. **Click** a correction to cycle through the alternatives,
  then back to the original text. A dotted orange underline flags an error without a suggestion,
  left as is.
- **Copy** copies the text as displayed.

## Browser extension

It underlines errors as you type, in every text field of every page: `textarea`, text `input` and
rich editors (Gmail, ProseMirror/Tiptap, Lexical, Slate…), including inside iframes and shadow DOM.

- Red for spelling, orange for grammar. **Click** an underlined word to open the suggestion card,
  then click a suggestion to apply it (Ctrl+Z undoes it). **Ignore** hides the error for the session.
- A badge in the bottom-right corner of the field shows the number of errors; clicking it opens a
  panel listing every error with its default suggestion. Apply them one by one, click an error to jump
  to it in the text, or hit **Fix all** to apply every default suggestion at once.
- The check runs 500 ms after the last keystroke. Only the field being edited is checked, the page is
  never scanned.
- Style suggestions are never offered, as on the website.
- **Language**: Auto (French/English detected per paragraph), FR or EN, from the extension icon. The
  extension can also be turned off globally or for a given site.
- Never checked: passwords, personal-data fields (`autocomplete="name"`, `email`…), code editors
  (Monaco, CodeMirror, Ace) and fields marked `data-gramm="false"`.

### Installation

Not on the stores: the zip for each browser sits at the root of this repo, ready to download (no
build needed).

**Chrome, Edge, Brave… (version 105 or later)**

1. Download [`orthoto-chrome.zip`](https://github.com/sylv0r/Orthoto/raw/main/orthoto-chrome.zip)
   and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder. Keep that folder: Chrome loads the extension
   from it.

**Firefox, Zen… (version 140 or later)**

1. Download [`orthoto-firefox.zip`](https://github.com/sylv0r/Orthoto/raw/main/orthoto-firefox.zip)
   (no need to unzip).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the zip.

Firefox only installs extensions signed by Mozilla for good, so this one is removed when the browser
restarts (dragging the zip onto the browser shows "could not be installed because it has not been
verified"). To keep it, set `xpinstall.signatures.required` to `false` in `about:config` and install
the zip from the add-ons page (⚙ › **Install Add-on From File…**): this works on Firefox Developer
Edition, Nightly and some forks, not on regular Firefox.

**Then, on every browser**: the settings page opens. Enter the server URL (for example
`http://your-server:8080`), the username and the password, then **Save and test**. On Firefox, if
the popup says Orthoto cannot read pages, click **Allow on all sites**.

**Update**: download the new zip, then click ⟳ on the extension in `chrome://extensions` (after
replacing the folder) or load it again in `about:debugging`.

**Build it yourself**: `npm run build:ext` writes `dist/orthoto-extension/` (Chrome),
`dist/orthoto-extension-firefox/` and refreshes the two zips at the root of the repo (commit them
with any change to `extension/` or `web/core.js`).

Credentials are kept in the extension's local storage and only sent to the configured server, using
Basic Auth. Requests are made by the extension's background script: no CORS or mixed-content issue, even
with a plain-HTTP server on the local network.

Not supported: Google Docs, which renders its text in a canvas.

## How it is made fast and light

With the stock LanguageTool image, French takes about 900 ms per request and the whole thing uses
1.4 GB of RAM. The optimizations:

- `pipelineCaching=true` (off by default): the French pipeline is no longer rebuilt on every request.
- Per-sentence result cache (`cacheSize`): an already-seen sentence comes back in about 10 ms.
- Only French and English are loaded. The dictionaries and rules of every other language, as well
  as fastText (131 MB), are removed from the image.
- Minimal JRE built with `jlink` (about 60 MB).
- No keep-alive between nginx and LanguageTool: its Java HTTP server adds about 45 ms on a reused
  connection.
- French/English warm-up at startup, so that the first real request is already fast.

Local measurements, through nginx and auth:

| Case                           | Latency     |
|--------------------------------|-------------|
| French, already-seen text      | ~10–15 ms   |
| French, new text               | ~30–75 ms   |
| English                        | ~10–25 ms   |
| French, about 2,500 characters | ~55 ms      |

Results are identical to those of the full LanguageTool image (checked on a French/English corpus).

## Layout

```
Dockerfile              multi-stage build: stripped LanguageTool → jlink JRE → Alpine + nginx
docker/entrypoint.sh    password, starts LanguageTool and nginx, warm-up, supervision
docker/nginx.conf       Basic Auth, static files, /v2 proxy → LanguageTool (127.0.0.1:8010)
docker/*.properties     LanguageTool configuration (caching, languages)
web/                    front-end (index.html, style.css, app.js) and core.js, the logic shared with the extension
extension/              MV3 extension (Chrome and Firefox): content.js (fields, underlines, suggestions), background.js, popup
scripts/                extension build (npm run build:ext), no dependencies
tests/                  tests of the correction logic (npm test)
```

## Tests

```sh
npm test
```