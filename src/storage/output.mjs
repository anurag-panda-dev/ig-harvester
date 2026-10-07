/**
 * Output writers — JSON, CSV, and SQLite.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Write JSON file. */
export async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

/** Write CSV file. */
export async function writeCsv(filePath, rows, cols) {
  if (!rows.length) return null;
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    cols.join(','),
    ...rows.map(r => cols.map(c => esc(r[c])).join(','))
  ];
  await fs.writeFile(filePath, lines.join('\r\n'), 'utf8');
  return filePath;
}

/** Write a SQLite database with all data. */
export async function writeSqlite(dbPath, { profile, posts, followers, following }) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      username TEXT PRIMARY KEY, url TEXT, name TEXT, bio TEXT,
      posts INTEGER, followers INTEGER, following INTEGER,
      scraped_at TEXT
    );
    CREATE TABLE IF NOT EXISTS posts (
      shortcode TEXT PRIMARY KEY, url TEXT, type TEXT, caption TEXT,
      likes INTEGER, views INTEGER, comment_count INTEGER,
      timestamp TEXT, location TEXT,
      is_carousel INTEGER DEFAULT 0, media_count INTEGER DEFAULT 1,
      hashtags TEXT, mentions TEXT
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shortcode TEXT, username TEXT, text TEXT, likes INTEGER,
      verified INTEGER DEFAULT 0, reply_to TEXT
    );
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shortcode TEXT, type TEXT, url TEXT, thumbnail TEXT,
      position INTEGER
    );
    CREATE TABLE IF NOT EXISTS followers (
      username TEXT PRIMARY KEY, name TEXT, verified INTEGER
    );
    CREATE TABLE IF NOT EXISTS following (
      username TEXT PRIMARY KEY, name TEXT, verified INTEGER
    );
  `);

  if (profile) {
    db.prepare(`
      INSERT OR REPLACE INTO profile (username, url, name, bio, posts, followers, following, scraped_at)
      VALUES (@username, @url, @name, @bio, @posts, @followers, @following, @scraped_at)
    `).run({
      username  : profile.username,
      url       : profile.url,
      name      : profile.name,
      bio       : profile.bio,
      posts     : profile.posts,
      followers : profile.followers,
      following : profile.following,
      scraped_at: profile.scrapedAt,
    });
  }

  if (posts.length) {
    const postStmt = db.prepare(`
      INSERT OR REPLACE INTO posts (shortcode, url, type, caption, likes, views, comment_count, timestamp, location, is_carousel, media_count, hashtags, mentions)
      VALUES (@shortcode, @url, @type, @caption, @likes, @views, @comment_count, @timestamp, @location, @is_carousel, @media_count, @hashtags, @mentions)
    `);
    const commentStmt = db.prepare(`
      INSERT INTO comments (shortcode, username, text, likes, verified, reply_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const mediaStmt = db.prepare(`
      INSERT INTO media (shortcode, type, url, thumbnail, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((rows) => {
      for (const p of rows) {
        postStmt.run({
          shortcode   : p.shortcode,
          url         : p.url,
          type        : p.type,
          caption     : p.caption,
          likes       : p.likes,
          views       : p.views,
          comment_count: p.commentCount,
          timestamp   : p.timestamp ? p.timestamp.toISOString() : null,
          location    : p.location,
          is_carousel : p.isCarousel ? 1 : 0,
          media_count: p.mediaCount || 1,
          hashtags    : JSON.stringify(p.hashtags || []),
          mentions    : JSON.stringify(p.mentions || []),
        });
        // Comments
        for (const c of p.comments || []) {
          commentStmt.run(p.shortcode, c.username, c.text, c.likes || 0, c.verified ? 1 : 0, null);
          for (const r of c.replies || []) {
            commentStmt.run(p.shortcode, r.username, r.text, r.likes || 0, r.verified ? 1 : 0, c.username);
          }
        }
        // Media items
        (p.mediaItems || []).forEach((m, idx) => {
          mediaStmt.run(p.shortcode, m.type, m.url, m.thumbnail || null, idx);
        });
      }
    });
    tx(posts);
  }

  if (followers.length) {
    const stmt = db.prepare('INSERT OR REPLACE INTO followers (username, name, verified) VALUES (?, ?, ?)');
    const tx = db.transaction((rows) => { for (const f of rows) stmt.run(f.username, f.name, f.verified ? 1 : 0); });
    tx(followers);
  }

  if (following.length) {
    const stmt = db.prepare('INSERT OR REPLACE INTO following (username, name, verified) VALUES (?, ?, ?)');
    const tx = db.transaction((rows) => { for (const f of rows) stmt.run(f.username, f.name, f.verified ? 1 : 0); });
    tx(following);
  }

  db.close();
  return dbPath;
}

/** Flatten a post for CSV export. */
export function flatPost(p) {
  return {
    shortcode: p.shortcode,
    url: p.url,
    type: p.type,
    likes: p.likes,
    views: p.views ?? '',
    comment_count: p.commentCount,
    timestamp: p.timestamp ? p.timestamp.toISOString() : '',
    location: p.location ?? '',
    caption: (p.caption || '').replace(/\s+/g, ' '),
    top_comments: p.comments.slice(0, 5).map(c => `${c.username}: ${c.text}`).join(' | '),
    is_carousel: p.isCarousel ? 'true' : 'false',
    media_count: p.mediaCount || 1,
    hashtags: (p.hashtags || []).join(' '),
    mentions: (p.mentions || []).join(' '),
  };
}
