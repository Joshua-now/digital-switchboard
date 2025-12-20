import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { checkDatabaseConnection } from './lib/db.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import webhookRouter from './routes/webhook.js';
import apiRouter from './routes/api.js';
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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
    }
    else {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
        });
    }
});
app.use('/webhook', webhookLimiter, webhookRouter);
app.use('/api', apiLimiter, apiRouter);
app.use(notFoundHandler);
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
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
