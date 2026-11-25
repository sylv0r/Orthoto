// Builds the browser extension, no dependencies, Node >= 22:
//   dist/orthoto-extension/          Chrome/Edge (load it unpacked)
//   dist/orthoto-extension-firefox/  Firefox (load it from about:debugging)
// plus a zip of each, attached to GitHub releases under these stable names:
//   dist/orthoto-chrome.zip, dist/orthoto-firefox.zip
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));

// Shared logic: as an ES module for the background script and the popup, and as a
// classic script for the content script (content scripts cannot import modules).
const core = readFileSync(join(root, 'web', 'core.js'), 'utf8');

// Firefox has no MV3 service worker: the same module runs as an event page instead.
// The Custom Highlight API (underlines in rich editors) ships in Firefox 140.
function firefoxManifest({ minimum_chrome_version, background, ...rest }) {
  return {
    ...rest,
    background: { scripts: [background.service_worker], type: background.type },
    browser_specific_settings: {
      gecko: {
        id: 'orthoto@orthoto.extension',
        strict_min_version: '140.0',
        // Text typed in fields is sent to the server configured by the user.
        data_collection_permissions: { required: ['websiteContent'] },
      },
    },
  };
}

const targets = [
  { name: 'orthoto-extension', zip: 'orthoto-chrome.zip', manifest },
  { name: 'orthoto-extension-firefox', zip: 'orthoto-firefox.zip', manifest: firefoxManifest(manifest) },
];

for (const target of targets) {
  const out = join(dist, target.name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'extension'), out, { recursive: true, filter: (src) => !src.endsWith('.svg') });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(target.manifest, null, 2)}\n`);
  writeFileSync(join(out, 'core.js'), core);
  writeFileSync(join(out, 'core.classic.js'), core.replace(/^export /gm, ''));

  const zipPath = join(dist, target.zip);
  writeFileSync(zipPath, zip(out));
  console.log(`${relative(root, out)}${sep}\n${relative(root, zipPath)}`);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

// Minimal deterministic zip (deflate, fixed 1980-01-01 timestamps).
function zip(dir) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
