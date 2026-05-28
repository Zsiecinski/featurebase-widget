import { config } from './config.js';

// Format upvote count as a short, scannable subtitle line for each list item.
function postSubtitle(p) {
  const parts = [];
  if (typeof p.upvotes === 'number' && p.upvotes > 0) {
    parts.push(`${p.upvotes} ${p.upvotes === 1 ? 'upvote' : 'upvotes'}`);
  }
  if (typeof p.commentCount === 'number' && p.commentCount > 0) {
    parts.push(`${p.commentCount} ${p.commentCount === 1 ? 'comment' : 'comments'}`);
  }
  return parts.join(' · ');
}

export function doneCanvas(posts) {
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

  if (posts.length === 0) {
    components.push({
      type: 'text',
      id: 'empty',
      text: 'Nothing shipped yet — check back soon!',
      align: 'center',
      style: 'muted',
    });
  } else {
    const items = posts.map((p) => {
      const subtitle = postSubtitle(p);
      const item = {
        type: 'item',
        id: `item_${p.id}`,
        title: p.title,
        action: { type: 'url', url: p.postUrl },
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
