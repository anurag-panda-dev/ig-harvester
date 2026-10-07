/**
 * SQLite cache for resume support. Stores scraped posts by shortcode
 * so interrupted runs can pick up where they left off.
 */
import { logger } from '../utils/logger.mjs';

export class Cache {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async open() {
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        shortcode TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        type TEXT,
        caption TEXT,
        likes INTEGER,
        views INTEGER,
        comment_count INTEGER,
        timestamp TEXT,
        location TEXT,
        comments TEXT,  -- JSON array
        scraped_at TEXT NOT NULL,
        is_carousel INTEGER DEFAULT 0,
        media_items TEXT,  -- JSON array
        media_count INTEGER DEFAULT 1,
        hashtags TEXT,  -- JSON array
        mentions TEXT  -- JSON array
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        posts_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running'
      );
      CREATE TABLE IF NOT EXISTS user_lists (
        target TEXT NOT NULL,
        kind TEXT NOT NULL,
        username TEXT NOT NULL,
        name TEXT,
        verified INTEGER DEFAULT 0,
        scraped_at TEXT NOT NULL,
        PRIMARY KEY (target, kind, username)
      );
    `);
    return this;
  }

  async close() {
    if (this.db) { this.db.close(); this.db = null; }
  }

  /** Get cached posts for a target, keyed by shortcode. */
  getCachedPosts() {
    if (!this.db) return new Map();
    const rows = this.db.prepare('SELECT * FROM posts').all();
    const map = new Map();
    for (const r of rows) {
      map.set(r.shortcode, {
        shortcode   : r.shortcode,
        url         : r.url,
        type        : r.type,
        caption     : r.caption,
        likes       : r.likes,
        views       : r.views,
        commentCount: r.comment_count,
        timestamp   : r.timestamp ? new Date(r.timestamp) : null,
        location    : r.location,
        comments    : r.comments ? JSON.parse(r.comments) : [],
        isCarousel  : !!r.is_carousel,
        mediaItems  : r.media_items ? JSON.parse(r.media_items) : [],
        mediaCount  : r.media_count || 1,
        hashtags    : r.hashtags ? JSON.parse(r.hashtags) : [],
        mentions    : r.mentions ? JSON.parse(r.mentions) : [],
      });
    }
    return map;
  }

  /** Save a scraped post to cache. */
  savePost(post) {
    if (!this.db) return;
    this.db.prepare(`
      INSERT OR REPLACE INTO posts (shortcode, url, type, caption, likes, views,
        comment_count, timestamp, location, comments, scraped_at,
        is_carousel, media_items, media_count, hashtags, mentions)
      VALUES (@shortcode, @url, @type, @caption, @likes, @views,
        @comment_count, @timestamp, @location, @comments, @scraped_at,
        @is_carousel, @media_items, @media_count, @hashtags, @mentions)
    `).run({
      shortcode   : post.shortcode,
      url         : post.url,
      type        : post.type,
      caption     : post.caption,
      likes       : post.likes,
      views       : post.views,
      comment_count: post.commentCount,
      timestamp   : post.timestamp ? post.timestamp.toISOString() : null,
      location    : post.location,
      comments    : JSON.stringify(post.comments || []),
      scraped_at  : new Date().toISOString(),
      is_carousel : post.isCarousel ? 1 : 0,
      media_items : JSON.stringify(post.mediaItems || []),
      media_count : post.mediaCount || 1,
      hashtags    : JSON.stringify(post.hashtags || []),
      mentions    : JSON.stringify(post.mentions || []),
    });
  }

  /** Start a run record. */
  startRun(target) {
    if (!this.db) return null;
    const info = this.db.prepare(
      'INSERT INTO runs (target, started_at) VALUES (?, ?)'
    ).run(target, new Date().toISOString());
    return info.lastInsertRowid;
  }

  /** Finish a run record. */
  finishRun(runId, status, postsCount) {
    if (!this.db || !runId) return;
    this.db.prepare(
      'UPDATE runs SET finished_at = ?, status = ?, posts_count = ? WHERE id = ?'
    ).run(new Date().toISOString(), status, postsCount, runId);
  }

  /** Save user list entries. */
  saveUserList(target, kind, users) {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_lists (target, kind, username, name, verified, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const tx = this.db.transaction((rows) => {
      for (const u of rows) {
        stmt.run(target, kind, u.username, u.name || '', u.verified ? 1 : 0, now);
      }
    });
    tx(users);
  }

  /** Get cached user list. */
  getUserList(target, kind) {
    if (!this.db) return [];
    return this.db.prepare(
      'SELECT username, name, verified FROM user_lists WHERE target = ? AND kind = ?'
    ).all(target, kind).map(r => ({
      username: r.username,
      name    : r.name,
      verified: !!r.verified,
    }));
  }
}
