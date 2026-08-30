import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageRoot = path.join(appRoot, 'node_modules', 'geist');
const fontsRoot = path.join(appRoot, 'public', 'fonts');

const files = [
  {
    bundled: 'Geist-Regular.ttf',
    packagePath: ['dist', 'fonts', 'geist-sans', 'Geist-Regular.ttf'],
    sha256: '5c8968eafb98a4c4f47033daf29e38e284a6f2a82eb017d171ab040fe7c4b615',
  },
  {
    bundled: 'Geist-Medium.ttf',
    packagePath: ['dist', 'fonts', 'geist-sans', 'Geist-Medium.ttf'],
    sha256: '0090e004725f6f64b841715b4167920580f883fcf9b67fc6d744089103fec101',
  },
  {
    bundled: 'GeistMono-Medium.ttf',
    packagePath: ['dist', 'fonts', 'geist-mono', 'GeistMono-Medium.ttf'],
    sha256: '90b15711dc3779b2e64e8aff5228154dd019a90bce4947549c4a8a8a43f2ac25',
  },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
if (packageJson.name !== 'geist' || packageJson.version !== '1.7.2') {
  throw new Error(`Expected geist@1.7.2, found ${packageJson.name}@${packageJson.version}`);
}

for (const file of files) {
  const bundled = await readFile(path.join(fontsRoot, file.bundled));
  const packaged = await readFile(path.join(packageRoot, ...file.packagePath));
  const actualHash = sha256(bundled);
  if (actualHash !== file.sha256) {
    throw new Error(`${file.bundled} has SHA-256 ${actualHash}; expected ${file.sha256}`);
  }
  if (!bundled.equals(packaged)) {
    throw new Error(`${file.bundled} differs from geist@1.7.2/${file.packagePath.join('/')}`);
  }
}

const bundledLicense = await readFile(path.join(fontsRoot, 'LICENSE.txt'));
const packagedLicense = await readFile(path.join(packageRoot, 'LICENSE.txt'));
const licenseHash = '930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137';
if (sha256(bundledLicense) !== licenseHash || !bundledLicense.equals(packagedLicense)) {
  throw new Error('Bundled LICENSE.txt differs from the geist@1.7.2 SIL OFL notice');
}

console.log('Verified 3 bundled Geist 1.7.2 fonts and the SIL OFL notice.');
