import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';

// Route imports
import authRoutes from './routes/auth.js';
import hospitalRoutes from './routes/hospitals.js';
import appointmentRoutes from './routes/appointments.js';
import queueRoutes from './routes/queue.js';
import financialRoutes from './routes/financial.js';
import fileRoutes from './routes/files.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
  process.env.USER_FRONTEND_URL,
  process.env.ADMIN_FRONTEND_URL,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
].filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return /https?:\/\/.*\.(onrender\.com|render\.com)$/i.test(origin);
};

// ─── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ─── BODY PARSER ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ success: true, message: 'HealFund Backend API running', version: '2.0.0' });
});

// ─── STATIC UPLOADS ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/financial-cases', financialRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin-messages', messageRoutes);
app.use('/api/admin', adminRoutes);

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'HealFund API is running', timestamp: new Date() });
});

// ─── PUBLIC STATS (for home page) ──────────────────────────────────────────────
app.get('/api/public/stats', async (req, res) => {
  try {
    const [totalUsers, totalHospitals, totalFinancialCases] = await Promise.all([
      (await import('./models/User.js')).default.countDocuments({ role: 'patient' }),
      (await import('./models/Hospital.js')).default.countDocuments({ hospitalId: 'HOSP-001' }),
      (await import('./models/FinancialCase.js')).default.countDocuments({ status: 'Active' }),
    ]);
    res.json({ success: true, stats: { totalUsers, totalHospitals, totalFinancialCases } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── 404 HANDLER ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`HealFund backend running on http://localhost:${PORT}`);
});
