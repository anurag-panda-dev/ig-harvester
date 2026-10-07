/**
 * Unit tests for parser utilities.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, parseTimestamp, sanitizeText, extractShortcode, mediaType } from '../src/extractors/parser.mjs';

test('parseCount handles plain numbers', () => {
  assert.equal(parseCount('1234'), 1234);
  assert.equal(parseCount('1,234'), 1234);
  assert.equal(parseCount('0'), undefined); // must be > 0
});

test('parseCount handles K/M/B suffixes', () => {
  assert.equal(parseCount('2.3K'), 2300);
  assert.equal(parseCount('686M'), 686000000);
  assert.equal(parseCount('1.5B'), 1500000000);
  assert.equal(parseCount('10K'), 10000);
});

test('parseCount rejects implausible values', () => {
  assert.equal(parseCount('99999999999'), undefined); // > 1e10
  assert.equal(parseCount('abc'), undefined);
  assert.equal(parseCount(null), undefined);
  assert.equal(parseCount(''), undefined);
});

test('parseCount handles thin spaces', () => {
  assert.equal(parseCount('686 M'), 686000000);
  assert.equal(parseCount('1 234'), 1234);
});

test('parseTimestamp handles Unix seconds', () => {
  const d = parseTimestamp(1609459200);
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2021-01-01T00:00:00.000Z');
});

test('parseTimestamp handles ISO strings', () => {
  const d = parseTimestamp('2021-01-01T00:00:00Z');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2021-01-01T00:00:00.000Z');
});

test('parseTimestamp handles null', () => {
  assert.equal(parseTimestamp(null), null);
  assert.equal(parseTimestamp(undefined), null);
});

test('sanitizeText collapses whitespace and strips control chars', () => {
  assert.equal(sanitizeText('  hello   world  '), 'hello world');
  assert.equal(sanitizeText('hello\x00world'), 'helloworld');
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText(''), '');
});

test('extractShortcode extracts from permalink', () => {
  assert.equal(extractShortcode('/p/ABC123/'), 'ABC123');
  assert.equal(extractShortcode('/reel/XYZ789/'), 'XYZ789');
  assert.equal(extractShortcode('/tv/DEF456/'), 'DEF456');
  assert.equal(extractShortcode('/p/ABC123/?utm_source=ig'), 'ABC123');
});

test('mediaType detects post type', () => {
  assert.equal(mediaType('/p/ABC123/'), 'photo');
  assert.equal(mediaType('/reel/XYZ789/'), 'reel');
  assert.equal(mediaType('/tv/DEF456/'), 'igtv');
});
