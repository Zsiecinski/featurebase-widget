import { config } from './config.js';

// Format an ISO date string as a short, human-friendly relative-or-absolute
// label like "today", "3 days ago", or "Mar 15".
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

function entrySubtitle(entry) {
  const parts = [];
  const when = formatShippedDate(entry.date);
  if (when) parts.push(`Shipped ${when}`);
  if (typeof entry.commentCount === 'number' && entry.commentCount > 0) {
    parts.push(
      `${entry.commentCount} ${entry.commentCount === 1 ? 'comment' : 'comments'}`,
    );
  }
  return parts.join(' · ');
}

export function doneCanvas(entries) {
  const components = [
    {
      type: 'text',
      id: 'header',
      text: 'Recently shipped',
      style: 'header',
    },
    {
      type: 'text',
      id: 'subheader',
      text: 'Features we just launched. Tap an item for details.',
      style: 'muted',
    },
    { type: 'spacer', id: 'spacer_top', size: 'xs' },
  ];

  if (entries.length === 0) {
    components.push({
      type: 'text',
      id: 'empty',
      text: 'Nothing shipped yet — check back soon!',
      align: 'center',
      style: 'muted',
    });
  } else {
    const items = entries.map((e) => {
      const subtitle = entrySubtitle(e);
      const item = {
        type: 'item',
        id: `item_${e.id}`,
        title: e.title,
        action: { type: 'url', url: e.url },
      };
      if (subtitle) item.subtitle = subtitle;
      return item;
    });

    components.push({
      type: 'list',
      id: 'shipped_list',
      items,
    });
  }

  components.push(
    { type: 'spacer', id: 'spacer_bottom', size: 'xs' },
    {
      type: 'button',
      id: 'full_roadmap',
      label: 'See full roadmap',
      style: 'primary',
      action: { type: 'url', url: config.roadmapUrl },
    },
  );

  return { canvas: { content: { components } } };
}

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
