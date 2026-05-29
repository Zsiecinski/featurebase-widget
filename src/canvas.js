import { config } from './config.js';

export const COLLAPSED_COUNT = 3;
// Cap the detail content to avoid a wall of text in a Messenger sheet.
const DETAIL_BODY_CHAR_LIMIT = 600;

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------
function formatShippedDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays < 0) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Featured image extraction. Featurebase doesn't document the exact shape;
// handle string URL, { url }, { src }, or array conventions.
// ---------------------------------------------------------------------------
function extractImage(entry) {
  const f = entry.featuredImage;
  if (!f) return null;
  if (typeof f === 'string') return f;
  if (typeof f === 'object') return f.url || f.src || f.href || null;
  return null;
}

// Featurebase tags each changelog entry with one of three "type" categories
// alongside its board category. We surface the type as a visible colored
// badge image on every list item — Canvas Kit text components can't render
// styled chips, so we render proper PNG badges and use them as item.image
// (the slot Intercom shows on the left of each list row).
//
// The PNG sources live in assets/ and are served by the express.static
// /assets handler in src/server.js.
const TYPE_CATEGORIES = new Set(['new', 'improved', 'fixed']);
const TYPE_BADGE_IMAGE = {
  NEW: '/assets/pill-new.png',
  IMPROVED: '/assets/pill-improved.png',
  FIXED: '/assets/pill-fixed.png',
};
// 3:1 aspect to match the 180x60 pill SVG. Rendered ~60x20 in the avatar slot.
const BADGE_IMAGE_WIDTH = 60;
const BADGE_IMAGE_HEIGHT = 20;

// In-progress posts in the "Coming next" section get a fixed blue pill —
// they don't have NEW/IMPROVED/FIXED type tags, just "currently being built."
const IN_PROGRESS_BADGE_IMAGE = '/assets/pill-in-progress.png';

function categoryNames(entry) {
  return (entry.categories || []).map((c) =>
    typeof c === 'string' ? c : c?.name || '',
  );
}

export function typeBadge(entry) {
  const names = categoryNames(entry);
  for (const name of names) {
    if (TYPE_CATEGORIES.has(name.toLowerCase())) {
      return name.toUpperCase();
    }
  }
  return '';
}

/**
 * Absolute URL for the badge PNG matching this entry's type, or null.
 * Intercom needs absolute URLs for images; relative ones won't load.
 */
function typeBadgeImageUrl(entry, baseUrl) {
  const badge = typeBadge(entry);
  if (!badge) return null;
  const path = TYPE_BADGE_IMAGE[badge];
  if (!path) return null;
  if (!baseUrl) return path; // graceful fallback for tests / mock dev
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function boardCategoryName(entry) {
  const names = categoryNames(entry);
  return names.find((name) => !TYPE_CATEGORIES.has(name.toLowerCase())) || '';
}

// Inline-text type badge with colored circle emoji prefix. Plain text falls
// back gracefully if the renderer strips the emoji.
const TYPE_ICONS = {
  NEW: '🟢',
  IMPROVED: '🟣',
  FIXED: '🟠',
};

function typeBadgeText(entry) {
  const badge = typeBadge(entry);
  if (!badge) return '';
  const icon = TYPE_ICONS[badge];
  return icon ? `${icon} ${badge}` : badge;
}

// Title is now plain (no inline emoji) — the visual badge is the item.image
// thumbnail to the left. If list-item images fail again, we'll revert to
// prefixing the title with the colored emoji as a fallback.
function entryTitle(entry) {
  return entry.title;
}

function entrySubtitle(entry, { showBoard, showComments = true } = {}) {
  const parts = [];
  if (showBoard) {
    const board = boardCategoryName(entry);
    if (board) parts.push(board);
  }
  const when = formatShippedDate(entry.date);
  if (when) parts.push(`Updated ${when}`);
  if (showComments && typeof entry.commentCount === 'number' && entry.commentCount > 0) {
    parts.push(
      `${entry.commentCount} ${entry.commentCount === 1 ? 'comment' : 'comments'}`,
    );
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Markdown → plain-text. Canvas Kit text components don't render markdown,
// so we strip inline syntax (bold, italic, links, code) and rely on
// paragraph breaks for visual structure. Headers are preserved through this
// pass so the renderer can detect them and assign a distinct text style.
// ---------------------------------------------------------------------------
function stripMarkdownInline(md) {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '')        // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')  // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → just text
    // NOTE: leave heading markers (#) intact — detected per-block below.
    .replace(/^\s*>\s?/gm, '')             // blockquotes
    .replace(/(\*\*|__)(.+?)\1/g, '$2')    // bold
    .replace(/(\*|_)(.+?)\1/g, '$2')       // italic
    .replace(/^[\-\*\+]\s+/gm, '• ')       // bullet list
    .replace(/^\d+\.\s+/gm, '')            // numbered list
    .replace(/<[^>]+>/g, '')               // strip any HTML tags
    .replace(/\n{3,}/g, '\n\n')            // collapse runs of blank lines
    .trim();
}

// Split content into blocks (paragraph-separated chunks) and classify each as
// a header or a paragraph based on leading markdown # markers.
function parseBodyBlocks(text) {
  const chunks = text.split(/\n{2,}/).filter(Boolean);
  return chunks.map((raw) => {
    const m = raw.match(/^(#{1,6})\s+(.+)$/);
    if (m) return { type: 'header', text: m[2].trim() };
    // Strip any stray # markers from mid-paragraph (rare).
    return { type: 'paragraph', text: raw.replace(/^#{1,6}\s+/gm, '') };
  });
}

function truncate(text, limit) {
  if (text.length <= limit) return { text, truncated: false };
  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf(' ');
  return { text: cut.slice(0, lastBreak > 0 ? lastBreak : limit) + '…', truncated: true };
}

// ---------------------------------------------------------------------------
// Home canvas — the card users see when they tap Loop in Messenger Home.
// ---------------------------------------------------------------------------
/**
 * @param {Array} entries
 * @param {object} [opts]
 * @param {boolean} [opts.expanded]      - Show all entries vs. top COLLAPSED_COUNT.
 * @param {string}  [opts.baseUrl]       - Public URL of this server.
 * @param {Array}   [opts.inProgress]    - In-progress posts for Coming Next.
 * @param {boolean} [opts.showComingNext]  Per-instance toggle.
 * @param {boolean} [opts.showPills]       Per-instance toggle. Default true.
 * @param {boolean} [opts.showFullRoadmap] Per-instance toggle. Default true.
 * @param {boolean} [opts.showComments]    Per-instance toggle. Default true.
 * @param {string}  [opts.headerText]      Override for the main header.
 * @param {string}  [opts.comingHeaderText] Override for the Coming next title.
 * @param {string}  [opts.footerLabel]     Override for the footer button.
 * @param {string}  [opts.footerUrl]       Override for the footer URL.
 */
export function homeCanvas(entries, opts = {}) {
  const expanded = Boolean(opts.expanded);
  const baseUrl = opts.baseUrl || '';
  const inProgress = opts.inProgress || [];
  const showComingNext = Boolean(opts.showComingNext) && inProgress.length > 0;
  const showPills = opts.showPills !== false;
  const showFullRoadmap = opts.showFullRoadmap !== false;
  const showComments = opts.showComments !== false;
  const collapsedCount = Number(opts.collapsedCount) || COLLAPSED_COUNT;
  const headerText = opts.headerText || 'Recently shipped';
  const comingHeaderText = opts.comingHeaderText || 'Coming next';
  const footerLabel = opts.footerLabel || 'See full roadmap';
  const footerUrl = opts.footerUrl || config.roadmapUrl;
  // Show the board category name (e.g. "Kiwi Sizing") only when no
  // category filter is set — otherwise every row repeats the same value.
  const showBoardName = !config.featurebase.category;

  const total = entries.length;
  const visible = expanded ? entries : entries.slice(0, collapsedCount);
  const hiddenCount = Math.max(total - visible.length, 0);

  const components = [
    { type: 'text', id: 'header', text: headerText, style: 'header' },
    {
      type: 'text',
      id: 'subhead',
      text: 'Features we just launched. Tap an item for details.',
      style: 'muted',
    },
    { type: 'spacer', id: 'sp_list', size: 'xs' },
  ];

  if (total === 0) {
    components.push({
      type: 'text',
      id: 'empty',
      text: 'Nothing shipped yet — check back soon!',
      align: 'center',
      style: 'muted',
    });
  } else {
    const items = visible.map((e) => {
      const subtitle = entrySubtitle(e, { showBoard: showBoardName, showComments });
      const item = {
        type: 'item',
        id: `item_${e.id}`,
        title: entryTitle(e),
        // Submit action replaces the current canvas with the detail view.
        action: { type: 'submit' },
      };
      if (subtitle) item.subtitle = subtitle;

      // Pill badge thumbnail in the list item's image slot. Skipped entirely
      // when the teammate disabled pills in Loop settings.
      if (showPills) {
        const badgeUrl = typeBadgeImageUrl(e, baseUrl);
        if (badgeUrl) {
          item.image = badgeUrl;
          item.image_width = BADGE_IMAGE_WIDTH;
          item.image_height = BADGE_IMAGE_HEIGHT;
        }
      }
      // Fall back to entry's own featuredImage when no pill is shown.
      if (!item.image) {
        const featured = extractImage(e);
        if (featured) item.image = featured;
      }
      return item;
    });
    components.push({ type: 'list', id: 'shipped_list', items });
  }

  if (total > collapsedCount) {
    components.push({ type: 'spacer', id: 'sp_toggle', size: 'xs' });
    if (!expanded) {
      components.push({
        type: 'button',
        id: 'see_more',
        label: `Show ${hiddenCount} more ↓`,
        style: 'link',
        action: { type: 'submit' },
      });
    } else {
      components.push({
        type: 'button',
        id: 'show_less',
        label: 'Show less ↑',
        style: 'link',
        action: { type: 'submit' },
      });
    }
  }

  // ─── Coming Next section ────────────────────────────────────────────
  if (showComingNext) {
    components.push(
      { type: 'spacer', id: 'sp_coming_top', size: 's' },
      { type: 'divider', id: 'd_coming' },
      { type: 'spacer', id: 'sp_coming_top2', size: 's' },
      {
        type: 'text',
        id: 'coming_header',
        text: comingHeaderText,
        style: 'header',
      },
      {
        type: 'text',
        id: 'coming_subhead',
        text: "What we're actively building.",
        style: 'muted',
      },
      { type: 'spacer', id: 'sp_coming_list', size: 'xs' },
    );

    const comingItems = inProgress.map((p) => {
      const item = {
        type: 'item',
        id: `coming_${p.id}`,
        title: p.title,
        action: { type: 'url', url: p.url },
      };
      if (showPills) {
        item.image = `${baseUrl.replace(/\/$/, '')}${IN_PROGRESS_BADGE_IMAGE}`;
        item.image_width = BADGE_IMAGE_WIDTH;
        item.image_height = BADGE_IMAGE_HEIGHT;
      }
      const parts = [];
      if (typeof p.upvotes === 'number' && p.upvotes > 0) {
        parts.push(`${p.upvotes} ${p.upvotes === 1 ? 'upvote' : 'upvotes'}`);
      }
      if (showComments && typeof p.commentCount === 'number' && p.commentCount > 0) {
        parts.push(`${p.commentCount} ${p.commentCount === 1 ? 'comment' : 'comments'}`);
      }
      if (parts.length > 0) item.subtitle = parts.join(' · ');
      return item;
    });
    components.push({ type: 'list', id: 'coming_list', items: comingItems });
  }
  // ────────────────────────────────────────────────────────────────────

  if (showFullRoadmap) {
    components.push(
      { type: 'spacer', id: 'sp_footer', size: 'xs' },
      {
        type: 'button',
        id: 'full_roadmap',
        label: footerLabel,
        style: 'primary',
        action: { type: 'url', url: footerUrl },
      },
    );
  }

  return {
    canvas: {
      content: { components },
      stored_data: { expanded: expanded ? 'true' : 'false' },
    },
  };
}

// ---------------------------------------------------------------------------
// Detail canvas — the slide-over sheet a user sees when tapping a list item.
// ---------------------------------------------------------------------------
/**
 * @param {object|null} entry  - The changelog entry to render, or null.
 * @param {object} [opts]
 * @param {boolean} [opts.expanded] - Preserved across Back so home returns
 *                                    to the same state the user came from.
 * @param {string}  [opts.baseUrl]  - Public URL of this server. Used to build
 *                                    the absolute URL for the pill badge
 *                                    image at the top of the detail.
 */
export function detailCanvas(entry, opts = {}) {
  const expanded = Boolean(opts.expanded);
  const baseUrl = opts.baseUrl || '';
  if (!entry) return detailNotFoundCanvas({ expanded });

  const components = [
    {
      type: 'button',
      id: 'back_to_home',
      label: '← Back to all',
      style: 'link',
      action: { type: 'submit' },
    },
    { type: 'spacer', id: 'sp_back', size: 'xs' },
  ];

  // Colored pill badge at the top — same visual language as the home list.
  const pillUrl = typeBadgeImageUrl(entry, baseUrl);
  if (pillUrl) {
    components.push({
      type: 'image',
      id: 'd_pill',
      url: pillUrl,
      width: 90,
      height: 30,
    });
    components.push({ type: 'spacer', id: 'sp_pill', size: 's' });
  }

  // Optional featured image hero, only if the entry has one. Most Featurebase
  // entries don't, so this is rare in practice but keeps the layout flexible.
  const image = extractImage(entry);
  if (image) {
    components.push({
      type: 'image',
      id: 'hero',
      url: image,
      width: 600,
      height: 300,
    });
    components.push({ type: 'spacer', id: 'sp_hero', size: 's' });
  }

  components.push({
    type: 'text',
    id: 'd_title',
    text: entry.title,
    style: 'header',
  });

  // Meta line: drop the type word (pill carries it now) and the board name
  // when a category filter is active (would just repeat for every entry).
  const meta = [];
  const when = formatShippedDate(entry.date);
  if (when) meta.push(`Updated ${when}`);
  if (!config.featurebase.category) {
    const board = boardCategoryName(entry);
    if (board) meta.push(board);
  }
  if (typeof entry.commentCount === 'number' && entry.commentCount > 0) {
    meta.push(`${entry.commentCount} ${entry.commentCount === 1 ? 'comment' : 'comments'}`);
  }
  if (meta.length > 0) {
    components.push({
      type: 'text',
      id: 'd_meta',
      text: meta.join(' · '),
      style: 'muted',
    });
  }

  components.push(
    { type: 'spacer', id: 'sp_meta_div', size: 'xs' },
    { type: 'divider', id: 'd_divider' },
    { type: 'spacer', id: 'sp_div_body', size: 'xs' },
  );

  // Body content — prefer markdownContent, fall back to content (stripped of
  // HTML), parse into typed blocks (headers vs paragraphs), cap total length
  // to avoid a wall of text.
  const raw = entry.markdownContent || entry.content || '';
  const stripped = stripMarkdownInline(raw);
  const { text, truncated } = truncate(stripped, DETAIL_BODY_CHAR_LIMIT);
  if (text) {
    const blocks = parseBodyBlocks(text);
    blocks.forEach((b, i) => {
      if (b.type === 'header') {
        // Section header rendered in Canvas Kit's 'header' style — bold,
        // prominent. Preserves the case the publisher wrote in their
        // markdown so '## What changed' renders as "What changed", not
        // SHOUTING. Spacer above for visual separation between sections.
        if (i > 0) {
          components.push({ type: 'spacer', id: `sp_h${i}`, size: 's' });
        }
        components.push({
          type: 'text',
          id: `d_body_${i}`,
          text: b.text,
          style: 'header',
        });
      } else {
        components.push({
          type: 'text',
          id: `d_body_${i}`,
          text: b.text,
          style: 'paragraph',
        });
      }
    });
    if (truncated) {
      components.push({ type: 'spacer', id: 'sp_more', size: 'xs' });
      components.push({
        type: 'text',
        id: 'd_body_more',
        text: 'Continue reading on the full post →',
        style: 'muted',
      });
    }
  }

  components.push({ type: 'spacer', id: 'sp_d_footer', size: 's' });

  if (entry.url) {
    components.push({
      type: 'button',
      id: 'd_open_full',
      label: 'Open on Featurebase',
      style: 'primary',
      action: { type: 'url', url: entry.url },
    });
  }

  return {
    canvas: {
      content: { components },
      stored_data: { expanded: expanded ? 'true' : 'false' },
    },
  };
}

function detailNotFoundCanvas({ expanded = false } = {}) {
  return {
    canvas: {
      content: {
        components: [
          {
            type: 'button',
            id: 'back_to_home',
            label: '← Back to all',
            style: 'link',
            action: { type: 'submit' },
          },
          { type: 'spacer', id: 'd_nf_sp_top', size: 'xs' },
          { type: 'text', id: 'd_nf_title', text: 'Update unavailable', style: 'header' },
          {
            type: 'text',
            id: 'd_nf_body',
            text: "We couldn't load this update. It may have been removed.",
            style: 'muted',
          },
          { type: 'spacer', id: 'd_nf_sp', size: 'xs' },
          {
            type: 'button',
            id: 'd_nf_btn',
            label: 'See full roadmap',
            style: 'primary',
            action: { type: 'url', url: config.roadmapUrl },
          },
        ],
      },
      stored_data: { expanded: expanded ? 'true' : 'false' },
    },
  };
}

// ---------------------------------------------------------------------------
// Needs-setup canvas — rendered for multi-tenant tenants who haven't yet
// connected their Featurebase API key via the Configure flow.
// ---------------------------------------------------------------------------
export function needsSetupCanvas({ reason = 'not_configured' } = {}) {
  const body =
    reason === 'not_installed'
      ? "We couldn't find a Loop install for this Intercom workspace. Reinstall the app from the Intercom App Store to connect."
      : 'Loop needs a Featurebase API key before it can show your roadmap. Ask an admin to open Loop settings (the gear icon on this card in Messenger settings) and paste your Featurebase API key.';

  return {
    canvas: {
      content: {
        components: [
          { type: 'text', id: 'setup_title', text: 'Loop needs setup', style: 'header' },
          { type: 'text', id: 'setup_body', text: body, style: 'paragraph' },
          { type: 'spacer', id: 'setup_sp', size: 's' },
          {
            type: 'text',
            id: 'setup_hint',
            text: "Once configured, this card will show recently shipped features from your Featurebase roadmap.",
            style: 'muted',
          },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Generic error canvas (network / API failures).
// ---------------------------------------------------------------------------
export function errorCanvas() {
  return {
    canvas: {
      content: {
        components: [
          {
            type: 'text',
            id: 'err_title',
            text: "Couldn't load the roadmap",
            style: 'header',
          },
          {
            type: 'text',
            id: 'err_body',
            text: 'We hit a snag fetching the latest shipped items. Try again in a moment.',
            style: 'muted',
          },
          { type: 'spacer', id: 'err_spacer', size: 'xs' },
          {
            type: 'button',
            id: 'full_roadmap',
            label: 'Open roadmap',
            style: 'primary',
            action: { type: 'url', url: config.roadmapUrl },
          },
        ],
      },
    },
  };
}
