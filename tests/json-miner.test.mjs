/**
 * Unit tests for the JSON media miner — especially extractSidecarChildren,
 * whose old regex silently returned [] when Instagram reordered node fields
 * (the root cause of "only the first carousel image is saved").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSidecarChildren } from '../src/extractors/json-miner.mjs';

const node = (fields) => `"node": {${fields}}`;

test('extracts children in canonical field order', () => {
  const blob = `x "edge_sidecar_to_children": { "edges": [
    ${node('"__typename": "GraphImage", "display_url": "https://cdn/v/a.jpg", "is_video": false')},
    ${node('"__typename": "GraphVideo", "display_url": "https://cdn/v/b.jpg", "is_video": true, "video_url": "https://cdn/v/b.mp4"')}
  ]} y`;
  const out = extractSidecarChildren(blob);
  assert.equal(out.length, 2);
  assert.equal(out[0].displayUrl, 'https://cdn/v/a.jpg');
  assert.equal(out[0].isVideo, false);
  assert.equal(out[1].isVideo, true);
  assert.equal(out[1].videoUrl, 'https://cdn/v/b.mp4');
  assert.equal(out[1].type, 'GraphVideo');
});

test('field order is irrelevant (reordered payload still parses)', () => {
  const blob = `x "edge_sidecar_to_children": { "edges": [
    ${node('"is_video": true, "display_url": "https://cdn/v/z.jpg", "__typename": "GraphVideo", "video_url": "https://cdn/v/z.mp4"')},
    ${node('"display_url": "https://cdn/v/y.jpg", "is_video": false, "__typename": "GraphImage"')}
  ]} y`;
  const out = extractSidecarChildren(blob);
  assert.equal(out.length, 2);
  assert.equal(out[0].isVideo, true);
  assert.equal(out[0].videoUrl, 'https://cdn/v/z.mp4');
  assert.equal(out[1].isVideo, false);
});

test('detects video without is_video via video_url / typename / media_type', () => {
  const blob = `"edge_sidecar_to_children": { "edges": [
    ${node('"display_url": "https://cdn/v/1.jpg", "video_url": "https://cdn/v/1.mp4"')},
    ${node('"__typename": "GraphVideo", "display_url": "https://cdn/v/2.jpg"')},
    ${node('"media_type": 2, "display_url": "https://cdn/v/3.jpg"')}
  ]}`;
  const out = extractSidecarChildren(blob);
  assert.equal(out.length, 3);
  assert.ok(out.every(c => c.isVideo), 'all three should be detected as video');
  assert.equal(out[0].videoUrl, 'https://cdn/v/1.mp4');
});

test('ignores non-media nodes inside the block', () => {
  const blob = `"edge_sidecar_to_children": { "edges": [
    ${node('"__typename": "GraphImage", "display_url": "https://cdn/v/a.jpg", "is_video": false')},
    {"node": {"owner": {"username": "someone"}, "edge_liked_by": {"count": 5}}}
  ]}`;
  const out = extractSidecarChildren(blob);
  assert.equal(out.length, 1);
});

test('shortcode hint picks this post\'s block over an earlier one', () => {
  const other = `"shortcode": "AAAAAAAAAAA", "edge_sidecar_to_children": { "edges": [
    ${node('"display_url": "https://cdn/other.jpg", "is_video": false')}
  ]}`;
  const mine = `"shortcode": "BBBBBBBBBBB", "edge_sidecar_to_children": { "edges": [
    ${node('"display_url": "https://cdn/mine.jpg", "is_video": false')}
  ]}`;
  const withHint = extractSidecarChildren(`${other} ${mine}`, { shortcode: 'BBBBBBBBBBB' });
  assert.equal(withHint.length, 1);
  assert.equal(withHint[0].displayUrl, 'https://cdn/mine.jpg');

  // Without the hint the first block still parses (old behavior)
  const noHint = extractSidecarChildren(`${other} ${mine}`);
  assert.equal(noHint[0].displayUrl, 'https://cdn/other.jpg');
});

test('unescapes JSON url strings', () => {
  const blob = `"edge_sidecar_to_children": { "edges": [
    ${node('"display_url": "https:\\/\\/cdn\\/v\\/a.jpg?x=1", "is_video": false')}
  ]}`;
  assert.equal(extractSidecarChildren(blob)[0].displayUrl, 'https://cdn/v/a.jpg?x=1');
});

test('returns [] for empty, missing, or sidecar-free blobs', () => {
  assert.deepEqual(extractSidecarChildren(null), []);
  assert.deepEqual(extractSidecarChildren(''), []);
  assert.deepEqual(extractSidecarChildren('{"taken_at":1791479422}'), []);
});
