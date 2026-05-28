import { config } from './config.js';

export function doneCanvas(posts) {
  const components = [
    {
      type: 'text',
      id: 'header',
      text: '✅ Recently Shipped',
      align: 'center',
      style: 'header',
    },
  ];

  if (posts.length === 0) {
    components.push({
      type: 'text',
      id: 'empty',
      text: 'Nothing here yet — check back soon!',
      align: 'center',
      style: 'muted',
    });
  } else {
    for (const p of posts) {
      components.push({
        type: 'text',
        id: `title_${p.id}`,
        text: `**${p.title}**`,
        style: 'paragraph',
      });
      components.push({
        type: 'button',
        id: `view_${p.id}`,
        label: 'View details',
        style: 'link',
        action: { type: 'url', url: p.postUrl },
      });
      components.push({ type: 'divider', id: `div_${p.id}` });
    }
  }

  components.push({
    type: 'button',
    id: 'full_roadmap',
    label: 'See full roadmap',
    style: 'secondary',
    action: { type: 'url', url: config.roadmapUrl },
  });

  return { canvas: { content: { components } } };
}

export function errorCanvas() {
  return {
    canvas: {
      content: {
        components: [
          {
            type: 'text',
            id: 'err',
            text: "Couldn't load the roadmap right now.",
            align: 'center',
            style: 'error',
          },
          {
            type: 'button',
            id: 'full_roadmap',
            label: 'Open roadmap',
            style: 'secondary',
            action: { type: 'url', url: config.roadmapUrl },
          },
        ],
      },
    },
  };
}
