import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { checkDatabaseConnection } from './lib/db.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import webhookRouter from './routes/webhook.js';
import apiRouter from './routes/api.js';
import path from "path";
import { fileURLToPath } from "url";


const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  credentials: true,
}));


app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP',
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: 'Too many requests from this IP',
});

app.get('/health', async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();

  if (dbHealthy) {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } else {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

app.use('/webhook', webhookLimiter, webhookRouter);
app.use('/api', apiLimiter, apiRouter);

/**
 * API 404s only (do NOT block frontend routes)
 */
app.use('/api', notFoundHandler);
app.use('/webhook', notFoundHandler);

/**
 * Serve built frontend (Vite) + SPA fallback
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDistPath = path.join(__dirname, "../dist");
app.use(express.static(clientDistPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.use(errorHandler);

async function startServer() {
  try {
    const dbHealthy = await checkDatabaseConnection();
    if (!dbHealthy) {
      console.error('Database connection failed. Server may not function correctly.');
    }

    app.listen(PORT, () => {
      console.log(`Digital Switchboard API running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
