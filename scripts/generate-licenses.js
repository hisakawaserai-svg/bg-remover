/**
 * generate-licenses.js — アプリ内ライセンス表記画面用の licenses.json を生成する
 *
 * 使い方:
 *   npx license-checker --production --json | node scripts/generate-licenses.js
 *
 * 出力（2ファイルに分ける。一覧表示に全文は不要なため、画面側で
 * 「一覧を開いた時は index だけ」「全文をタップした時に texts」を
 * それぞれ遅延 require できるようにする）:
 *   src/licenses/licenses-index.json — [{ name, version, license }] 名前順
 *   src/licenses/licenses-texts.json — { "name@version": 全文 }
 *
 * ## テキストの決め方
 * 1. license-checker が見つけた licenseFile がライセンスファイル本体
 *    （LICENSE/LICENCE/COPYING）ならその全文を使う。
 * 2. README へのフォールバックやファイル無しの場合は、SPDX 標準文面に
 *    package.json の publisher から作った著作権表示を付けて代用する
 *    （MIT/BSD 等は「著作権表示＋全文」が掲載条件のため省略しない）。
 * 3. npm に無いネイティブ依存（Podfile.lock 由来）は NATIVE_ENTRIES に
 *    手書きで足す。Google SDK のバージョンを上げたらここも見直すこと。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'licenses');
const OUT_INDEX = path.join(OUT_DIR, 'licenses-index.json');
const OUT_TEXTS = path.join(OUT_DIR, 'licenses-texts.json');

// ── SPDX 標準文面（ライセンスファイルが無いパッケージ用）─────────────────────
// Apache-2.0 の全文は長いので、実物を同梱している依存から実行時に読む。
function apacheFullText() {
  const p = path.join(ROOT, 'node_modules', 'baseline-browser-mapping', 'LICENSE.txt');
  const text = fs.readFileSync(p, 'utf8');
  if (!text.includes('Apache License')) {
    throw new Error(`Apache-2.0 full text not found in ${p}`);
  }
  return text.trim();
}

const MIT_TEMPLATE = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC_TEMPLATE = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const BSD3_TEMPLATE = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const BSD2_TEMPLATE = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const ZERO_BSD_TEMPLATE = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/**
 * SPDX 表記から代用文面を返す。デュアルライセンスは MIT 側を採用する
 * （利用者はどちらか一方を選べばよく、掲載条件が最も単純なため）。
 */
function templateFor(license, apacheText) {
  const l = String(license);
  if (l.includes('MIT')) return MIT_TEMPLATE;
  if (l === 'ISC') return ISC_TEMPLATE;
  if (l === 'BSD-3-Clause') return BSD3_TEMPLATE;
  if (l === 'BSD-2-Clause') return BSD2_TEMPLATE;
  if (l === '0BSD') return ZERO_BSD_TEMPLATE;
  if (l === 'Apache-2.0') return apacheText;
  return null;
}

/** licenseFile が「ライセンスファイル本体」か（README 等へのフォールバックでないか） */
function isRealLicenseFile(p) {
  if (!p) return false;
  const base = path.basename(p).toLowerCase();
  return base.includes('license') || base.includes('licence') || base.includes('copying');
}

// ── npm 依存の変換 ───────────────────────────────────────────────────────────
function buildNpmEntries(raw, apacheText) {
  const selfName = require(path.join(ROOT, 'package.json')).name;
  const entries = [];
  const missing = [];
  for (const [key, info] of Object.entries(raw)) {
    const at = key.lastIndexOf('@');
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (name === selfName) continue; // アプリ自身

    let text = null;
    if (isRealLicenseFile(info.licenseFile)) {
      text = fs.readFileSync(info.licenseFile, 'utf8').trim();
    } else {
      const template = templateFor(info.licenses, apacheText);
      if (template) {
        const holder = info.publisher || info.copyright || name;
        text = `Copyright (c) ${holder}\n\n${template}`;
      }
    }
    if (!text) {
      missing.push(`${key} (${info.licenses})`);
      continue;
    }
    entries.push({ name, version, license: String(info.licenses), text });
  }
  if (missing.length > 0) {
    // 掲載漏れを黙って出荷しないため、埋められないものがあれば失敗させる。
    throw new Error(`No license text for:\n  ${missing.join('\n  ')}`);
  }
  return entries;
}

// ── ネイティブ依存（Podfile.lock 由来・npm に無いもの）───────────────────────
function buildNativeEntries() {
  const lock = fs.readFileSync(path.join(ROOT, 'ios', 'Podfile.lock'), 'utf8');
  const podVersion = pod => {
    const m = lock.match(new RegExp(`^  - ${pod} \\(([\\d.]+)\\)`, 'm'));
    if (!m) throw new Error(`${pod} not found in Podfile.lock`);
    return m[1];
  };

  const admobLicense = fs
    .readFileSync(path.join(ROOT, 'ios', 'Pods', 'Google-Mobile-Ads-SDK', 'LICENSE'), 'utf8')
    .trim();
  const hermesLicense = fs
    .readFileSync(path.join(ROOT, 'ios', 'Pods', 'hermes-engine', 'LICENSE'), 'utf8')
    .trim();

  return [
    {
      name: 'Google Mobile Ads SDK',
      version: podVersion('Google-Mobile-Ads-SDK'),
      license: 'Google (proprietary)',
      text: `Copyright Google LLC\n\n${admobLicense}`,
    },
    {
      name: 'Google User Messaging Platform',
      version: podVersion('GoogleUserMessagingPlatform'),
      license: 'Google (proprietary)',
      text:
        'Copyright Google LLC\n\n' +
        'The Google User Messaging Platform SDK is distributed under the Google APIs Terms of Service.\n' +
        'https://developers.google.com/terms',
    },
    {
      name: 'Hermes',
      version: podVersion('hermes-engine'),
      license: 'MIT',
      text: hermesLicense,
    },
  ];
}

// ── main ─────────────────────────────────────────────────────────────────────
const stdin = fs.readFileSync(0, 'utf8');
const raw = JSON.parse(stdin);
const apacheText = apacheFullText();

const entries = [...buildNpmEntries(raw, apacheText), ...buildNativeEntries()];
entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

const index = entries.map(({ name, version, license }) => ({ name, version, license }));
const texts = Object.fromEntries(entries.map(e => [`${e.name}@${e.version}`, e.text]));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_INDEX, JSON.stringify(index, null, 1) + '\n');
fs.writeFileSync(OUT_TEXTS, JSON.stringify(texts, null, 1) + '\n');

const kb = f => Math.round(fs.statSync(f).size / 1024);
console.log(
  `Wrote ${entries.length} entries: ` +
    `${path.relative(ROOT, OUT_INDEX)} (${kb(OUT_INDEX)} KB), ` +
    `${path.relative(ROOT, OUT_TEXTS)} (${kb(OUT_TEXTS)} KB)`,
);
