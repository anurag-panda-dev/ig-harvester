/**
 * Unit tests for the ig-images naming and format helpers.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImageName, extFromBuffer, toPng } from '../src/scraper/images.mjs';

// Fixed local-time date so the expected filename is deterministic
const POST = new Date(2026, 9, 8, 14, 30, 22); // 2026-10-08 14:30:22 local

test('buildImageName formats date, time and zero-padded index', () => {
  assert.equal(buildImageName('some.user', POST, 1), 'some.user-2026-10-08-143022-01.png');
  assert.equal(buildImageName('some.user', POST, 7), 'some.user-2026-10-08-143022-07.png');
  assert.equal(buildImageName('some.user', POST, 12), 'some.user-2026-10-08-143022-12.png');
});

test('buildImageName accepts ISO strings and unix seconds', () => {
  assert.equal(
    buildImageName('u', '2026-10-08T14:30:22.000Z', 1, {}),
    buildImageName('u', new Date('2026-10-08T14:30:22.000Z'), 1)
  );
  // unix seconds as number AND as numeric string (JSON sources do both)
  assert.equal(
    buildImageName('u', 1791479422, 1),
    buildImageName('u', '1791479422', 1)
  );
});

test('buildImageName falls back when timestamp is missing', () => {
  assert.equal(buildImageName('u', null, 1), 'u-unknown-date-000000-01.png');
  assert.equal(buildImageName('u', undefined, 3), 'u-unknown-date-000000-03.png');
  assert.equal(buildImageName('u', 'not-a-date', 1), 'u-unknown-date-000000-01.png');
});

test('buildImageName sanitizes the username', () => {
  assert.equal(buildImageName('bad/name', POST, 1), 'bad_name-2026-10-08-143022-01.png');
  assert.equal(buildImageName('', POST, 1), 'unknown-2026-10-08-143022-01.png');
});

test('buildImageName can disambiguate collisions with the shortcode', () => {
  assert.equal(
    buildImageName('u', POST, 1, { shortcode: 'ABC123def45', withShortcode: true }),
    'u-2026-10-08-143022-ABC123def45-01.png'
  );
  // without the flag the shortcode never appears
  assert.equal(buildImageName('u', POST, 1, { shortcode: 'ABC123def45' }), 'u-2026-10-08-143022-01.png');
});

test('extFromBuffer sniffs magic bytes', () => {
  assert.equal(extFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), '.jpg');
  assert.equal(extFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), '.png');
  const webp = Buffer.alloc(12);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  assert.equal(extFromBuffer(webp), '.webp');
  assert.equal(extFromBuffer(Buffer.from('GIF89a......', 'ascii')), '.gif');
});

test('extFromBuffer falls back to the URL, then to .jpg', () => {
  assert.equal(extFromBuffer(Buffer.alloc(0), 'https://x.test/pic.webp?_nc=1'), '.webp');
  assert.equal(extFromBuffer(Buffer.alloc(0), 'https://x.test/pic.jpeg'), '.jpeg');
  assert.equal(extFromBuffer(Buffer.alloc(0)), '.jpg');
});

test('toPng produces real PNG bytes', async () => {
  const { Jimp } = await import('jimp');
  const jpg = await new Jimp({ width: 8, height: 8, color: 0x3366ccff }).getBuffer('image/jpeg');
  assert.equal(jpg[0], 0xff); // starts as JPEG

  const conv = await toPng(jpg, 'https://x.test/a.jpg');
  assert.equal(conv.ext, '.png');
  assert.equal(conv.converted, true);
  assert.deepEqual([...conv.buffer.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // PNG magic
});

test('toPng falls back to original bytes on undecodable input', async () => {
  const junk = Buffer.from('RIFF....WEBP-not-really-a-decodable-image');
  const conv = await toPng(junk, 'https://x.test/a.webp');
  assert.equal(conv.converted, false);
  assert.equal(conv.ext, '.webp');  // kept honest: true extension, not .png
  assert.equal(conv.buffer, junk);
});
