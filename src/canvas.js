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

function firstCategoryName(entry) {
  const c = (entry.categories || [])[0];
  if (!c) return '';
  return typeof c === 'string' ? c : c.name || '';
}

function entrySubtitle(entry, { showCategory } = {}) {
  const parts = [];
  if (showCategory) {
    const cat = firstCategoryName(entry);
    if (cat) parts.push(cat);
  }
  const when = formatShippedDate(entry.date);
  if (when) parts.push(`Shipped ${when}`);
  if (typeof entry.commentCount === 'number' && entry.commentCount > 0) {
    parts.push(
      `${entry.commentCount} ${entry.commentCount === 1 ? 'comment' : 'comments'}`,
    );
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Markdown → plain-text. Canvas Kit text components don't render markdown,
// so we strip syntax and rely on paragraph breaks for visual structure.
// ---------------------------------------------------------------------------
function stripMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '')        // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')  // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → just text
    .replace(/^#{1,6}\s+/gm, '')           // headings
    .replace(/^\s*>\s?/gm, '')             // blockquotes
    .replace(/(\*\*|__)(.+?)\1/g, '$2')    // bold
    .replace(/(\*|_)(.+?)\1/g, '$2')       // italic
    .replace(/^[\-\*\+]\s+/gm, '• ')       // bullet list
    .replace(/^\d+\.\s+/gm, '')            // numbered list
    .replace(/<[^>]+>/g, '')               // strip any HTML tags
    .replace(/\n{3,}/g, '\n\n')            // collapse runs of blank lines
    .trim();
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
 * @param {boolean} [opts.expanded]  - Show all entries vs. top COLLAPSED_COUNT.
 * @param {string}  [opts.baseUrl]   - Public URL of this server, used to build
 *                                     absolute sheet URLs per item.
 */
export function homeCanvas(entries, opts = {}) {
  const expanded = Boolean(opts.expanded);
  const baseUrl = opts.baseUrl || '';
  const showCategoryBadge = !config.featurebase.category;

  const total = entries.length;
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_COUNT);
  const hiddenCount = Math.max(total - visible.length, 0);

  const components = [
    { type: 'text', id: 'header', text: 'Recently shipped', style: 'header' },
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
      const subtitle = entrySubtitle(e, { showCategory: showCategoryBadge });
      const image = extractImage(e);
      const item = {
        type: 'item',
        id: `item_${e.id}`,
        title: e.title,
        // Sheet action opens the detail canvas inside Messenger instead of
        // kicking the user out to a browser tab.
        action: {
          type: 'sheet',
          url: `${baseUrl}/sheet/${encodeURIComponent(e.id)}`,
        },
      };
      if (subtitle) item.subtitle = subtitle;
      if (image) {
        item.image = image;
        item.rounded_image = false;
      }
      return item;
    });
    components.push({ type: 'list', id: 'shipped_list', items });
  }

  if (total > COLLAPSED_COUNT) {
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

  components.push(
    { type: 'spacer', id: 'sp_footer', size: 'xs' },
    {
      type: 'button',
      id: 'full_roadmap',
      label: 'See full roadmap',
      style: 'primary',
      action: { type: 'url', url: config.roadmapUrl },
    },
  );

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
 * @param {object|null} entry - The changelog entry to render, or null if it
 *                              couldn't be loaded.
 */
export function detailCanvas(entry) {
  if (!entry) return detailNotFoundCanvas();

  const components = [];

  const image = extractImage(entry);
  if (image) {
    components.push({
      type: 'image',
      id: 'hero',
      url: image,
      width: 600,
      height: 300,
      rounded: false,
    });
    components.push({ type: 'spacer', id: 'sp_hero', size: 'xs' });
  }

  components.push({
    type: 'text',
    id: 'd_title',
    text: entry.title,
    style: 'header',
  });

  const meta = [];
  const when = formatShippedDate(entry.date);
  if (when) meta.push(`Shipped ${when}`);
  const cat = firstCategoryName(entry);
  if (cat) meta.push(cat);
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

  // Body content — prefer markdownContent, fall back to content (stripped of
  // HTML), split into paragraphs, cap total length to avoid a wall of text.
  const raw = entry.markdownContent || entry.content || '';
  const stripped = stripMarkdown(raw);
  const { text, truncated } = truncate(stripped, DETAIL_BODY_CHAR_LIMIT);
  if (text) {
    components.push({ type: 'spacer', id: 'sp_body', size: 'xs' });
    const paragraphs = text.split(/\n{2,}/).filter(Boolean);
    paragraphs.forEach((p, i) => {
      components.push({
        type: 'text',
        id: `d_body_${i}`,
        text: p,
        style: 'paragraph',
      });
    });
    if (truncated) {
      components.push({
        type: 'text',
        id: 'd_body_more',
        text: 'Continue reading on the full post →',
        style: 'muted',
      });
    }
  }

  components.push({ type: 'spacer', id: 'sp_d_footer', size: 'xs' });

  if (entry.url) {
    components.push({
      type: 'button',
      id: 'd_open_full',
      label: 'Open on Featurebase',
      style: 'primary',
      action: { type: 'url', url: entry.url },
    });
  }

  return { canvas: { content: { components } } };
}

function detailNotFoundCanvas() {
  return {
    canvas: {
      content: {
        components: [
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
