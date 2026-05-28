import { config } from './config.js';

// ---------------------------------------------------------------------------
// Time range filter options. `id` is what's sent back in submit input_values.
// Keep this list short — Canvas Kit dropdowns hold their height open whether
// they have 3 options or 30.
// ---------------------------------------------------------------------------
export const TIME_RANGES = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

export const DEFAULT_TIME_RANGE = '30d';
export const COLLAPSED_COUNT = 3;

export function rangeFor(id) {
  return TIME_RANGES.find((r) => r.id === id) || TIME_RANGES.find((r) => r.id === DEFAULT_TIME_RANGE);
}

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
// handle string URL, { url }, { src }, or array-of-images conventions.
// ---------------------------------------------------------------------------
function extractImage(entry) {
  const f = entry.featuredImage;
  if (!f) return null;
  if (typeof f === 'string') return f;
  if (typeof f === 'object') {
    return f.url || f.src || f.href || null;
  }
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
// Main canvas builder
// ---------------------------------------------------------------------------
/**
 * @param {Array} entries - Filtered changelog entries to render.
 * @param {object} [opts]
 * @param {string}  [opts.timeRange]   - Currently-selected time range id.
 * @param {boolean} [opts.expanded]    - Show all entries vs. collapsed (3).
 * @param {boolean} [opts.showFilter]  - Render the time range dropdown.
 */
export function doneCanvas(entries, opts = {}) {
  const timeRange = opts.timeRange || DEFAULT_TIME_RANGE;
  const expanded = Boolean(opts.expanded);
  const showFilter = opts.showFilter !== false;
  const range = rangeFor(timeRange);
  const showCategoryBadge = !config.featurebase.category;

  const total = entries.length;
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_COUNT);
  const hiddenCount = Math.max(total - visible.length, 0);

  const components = [
    {
      type: 'text',
      id: 'header',
      text: 'Recently shipped',
      style: 'header',
    },
    {
      type: 'text',
      id: 'subhead',
      text: subheadText(total, range),
      style: 'muted',
    },
  ];

  if (showFilter) {
    components.push(
      { type: 'spacer', id: 'sp_filter', size: 'xs' },
      {
        type: 'single-select',
        id: 'time_range',
        label: 'Show',
        value: timeRange,
        options: TIME_RANGES.map((r) => ({ type: 'option', id: r.id, text: r.label })),
        action: { type: 'submit' },
      },
    );
  }

  components.push({ type: 'spacer', id: 'sp_list', size: 'xs' });

  if (total === 0) {
    components.push({
      type: 'text',
      id: 'empty',
      text: emptyText(range),
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
        action: { type: 'url', url: e.url },
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

  // See more / Show less toggle. Only render when there's something to toggle.
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

  // Persist UI state across Intercom submits. Canvas Kit requires all values
  // in stored_data to be strings.
  const stored_data = {
    expanded: expanded ? 'true' : 'false',
    time_range: timeRange,
  };

  return { canvas: { content: { components }, stored_data } };
}

function subheadText(count, range) {
  if (count === 0) {
    return range.days
      ? `Nothing shipped in the ${range.label.toLowerCase()}.`
      : 'No shipped features yet.';
  }
  const noun = count === 1 ? 'feature' : 'features';
  if (!range.days) {
    return `${count} ${noun} shipped so far.`;
  }
  return `${count} ${noun} in the ${range.label.toLowerCase()}.`;
}

function emptyText(range) {
  if (!range.days) return 'Nothing shipped yet — check back soon!';
  return `Nothing in the ${range.label.toLowerCase()}. Try a wider range.`;
}

// ---------------------------------------------------------------------------
// Error fallback
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
