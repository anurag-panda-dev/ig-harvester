/**
 * Explaining a grid that came back short — page facts plus a debug
 * screenshot, so "only 1 of 28 posts" turns into an answer instead of a
 * mystery. Used by both CLIs after link collection.
 */
import { diagnoseGridPage } from '../extractors/dom.mjs';
import { takeScreenshot } from './screenshot.mjs';
import { logger } from '../utils/logger.mjs';

export async function explainShortGrid(page, username, cfg) {
  try {
    const d = await diagnoseGridPage(page);

    logger.warn(
      `grid diag: ${d.permalinks} grid link(s) | ${d.anchors} anchors | ${d.imgs} images | ` +
      `${d.jsonShortcodes} shortcodes in the page JSON`
    );
    logger.warn(
      `grid diag: scroll y=${d.winY} of ${d.docH}px (viewport ${d.winH}px, ` +
      `main ${d.mainH}px/${d.mainClientH}px) | ${d.isPrivateWall ? 'PRIVATE WALL ON SCREEN' : 'no private wall'}`
    );
    logger.warn(`grid diag: page "${d.title}" - ${d.snippet.slice(0, 220)}`);

    if (d.jsonShortcodes > d.permalinks + 2) {
      logger.warn(
        'grid diag: the posts ARE in the page JSON but never rendered as thumbnails - ' +
        'Instagram served a degraded/slow grid (re-run, or log in again)'
      );
    } else if (d.permalinks === 0 && !d.isPrivateWall && d.jsonShortcodes === 0) {
      logger.warn('grid diag: no posts anywhere on the page - wrong/blocked page, or the profile does not exist');
    }

    await takeScreenshot(page, `${username}-grid-debug`, { fullPage: false, outDir: cfg.outDir });
  } catch (e) {
    logger.debug(`grid diag failed: ${String(e?.message || e).split('\n')[0]}`);
  }
}
