import express from 'express';
import { config } from './config.js';
import { getDonePosts } from './featurebase.js';
import { doneCanvas, errorCanvas } from './canvas.js';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mock: config.mock,
    uptime: process.uptime(),
  });
});

app.get('/', (_req, res) => {
  res.type('text').send(
    `Kiwi Done app is running${config.mock ? ' (MOCK mode)' : ''}.`,
  );
});

async function renderDoneCanvas(_req, res) {
  try {
    const posts = await getDonePosts();
    res.send(doneCanvas(posts));
  } catch (err) {
    console.error('[featurebase] failed:', err.message);
    res.send(errorCanvas());
  }
}

app.post('/initialize', renderDoneCanvas);
app.post('/submit', renderDoneCanvas);

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    const mode = config.mock ? ' (MOCK mode — no API key set)' : '';
    console.log(`Listening on ${config.port}${mode}`);
  });
}

export default app;
