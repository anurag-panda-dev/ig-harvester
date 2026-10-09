#!/usr/bin/env node
/**
 * ig-harvester — IndexNow submitter
 *
 * Pushes URLs to the IndexNow index so Bing, Yandex, Naver and Seznam pick
 * them up within minutes instead of waiting for the next crawl.
 * (Google does NOT use IndexNow — use Search Console for that.)
 *
 * The API key lives at docs/<key>.txt and is served from
 *   https://anurag-panda-dev.github.io/ig-harvester/<key>.txt
 * and must be reachable by the engines before submitting.
 *
 * Usage:
 *   node dependencies/indexnow.mjs                         # submit the site root
 *   node dependencies/indexnow.mjs <url> [<url> ...]       # submit specific pages
 *   npm run indexnow
 *
 * Exit codes: 0 = accepted (200/202), 1 = rejected / network failure.
 */

const KEY = '63ea7ec56896e788c5373b204b481b0c';
const HOST = 'anurag-panda-dev.github.io';
const KEY_LOCATION = `https://${HOST}/ig-harvester/${KEY}.txt`;
const DEFAULT_URLS = ['https://anurag-panda-dev.github.io/ig-harvester/'];
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const urls = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const urlList = urls.length ? urls : DEFAULT_URLS;

// The key must live on the same host as every submitted URL.
for (const url of urlList) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`error: not a valid URL: ${url}`);
    process.exit(1);
  }
  if (parsed.hostname !== HOST) {
    console.error(
      `error: ${parsed.hostname} does not match key host ${HOST} — ` +
        'IndexNow keys are host-specific (submit github.com URLs from a key hosted on github.com).'
    );
    process.exit(1);
  }
}

async function main() {
  const body = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  };

  console.log(`indexnow: posting ${urlList.length} URL(s) to ${ENDPOINT}`);
  for (const u of urlList) console.log(`  - ${u}`);
  console.log(`  key: ${KEY_LOCATION}`);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });

    const text = (await res.text()).trim();
    console.log(`indexnow: HTTP ${res.status}${text ? ` — ${text}` : ''}`);

    if (res.status === 200) {
      console.log('indexnow: OK — URLs queued for indexing.');
      process.exit(0);
    }
    if (res.status === 202) {
      console.log(
        'indexnow: accepted (202). The key will be validated against ' +
          KEY_LOCATION + ' before the URLs are indexed.'
      );
      process.exit(0);
    }
    console.error(`indexnow: rejected (${res.status}).`);
    if (res.status === 400) console.error('  400 = malformed request — check the URL list.');
    if (res.status === 403) console.error('  403 = key mismatch — the key file must be reachable at keyLocation.');
    if (res.status === 422) console.error('  422 = URLs do not belong to the key host.');
    if (res.status === 429) console.error('  429 = too many requests — wait before retrying.');
    process.exit(1);
  } catch (err) {
    console.error(`indexnow: network failure — ${err.message}`);
    process.exit(1);
  }
}

main();
