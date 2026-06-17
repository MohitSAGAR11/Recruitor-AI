import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config, logProviderStatus } from './config/env.js';
import { pingDb } from './db/pool.js';
import { errorMiddleware } from './middleware/error.middleware.js';

const app = express();
const PORT = config.port;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('dev'));
app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'RecruitAI backend is running' });
});

app.use(errorMiddleware);

app.listen(PORT, async () => {
  console.log(`RecruitAI backend running on port ${PORT}`);
  logProviderStatus();
  const ok = await pingDb();
  console.log(`   DB ping: ${ok ? 'reachable' : 'unreachable'}`);
});

export default app;
