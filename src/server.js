require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const mongoose = require('mongoose');
const connectDB = require('./config/database');
const conversationRoutes = require('./routes/conversationRoutes');
const messageRoutes = require('./routes/messageRoutes');
// Import the clean websocket service
const websocketService = require('./services/websocket'); // Adjust path if needed

const app = express();
// In your server.js, add this middleware BEFORE your routes

app.use((req, res, next) => {
  // Set COOP and COEP headers to allow popup communication
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
const server = http.createServer(app);

// Initialize WebSocket with the service (secure, auto-join, no globals)
websocketService.init(server);

// Get the io instance from websocket service
const io = websocketService.getIO();

// Connect to DB
connectDB();

// CORS middleware (single source of truth)
app.use(cors({
  origin: [
    "https://pulse-backend-tpg8.onrender.com",
    "https://pulse-eta-cyan.vercel.app",
    "http://localhost:3000",
    "http://192.168.56.1:3000"
    // Add production origins here
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ✅ IMPORTANT: Attach io to every request - MUST come before routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ========== LOAD MODELS ==========
console.log('\n🔧 Loading models...');

['User', 'Post', 'Comment', 'Notification', 'Conversation', 'Message'].forEach(model => {
  if (!mongoose.models[model]) {
    try {
      require(`./models/${model}`);
      console.log(`✅ ${model} model loaded`);
    } catch (error) {
      console.log(`❌ ${model} model error:`, error.message);
    }
  } else {
    console.log(`✅ ${model} model already registered`);
  }
});

// ========== LOAD ROUTES ==========
console.log('\n🔧 Loading routes...');

// First, load the main routes
const routes = [
  { path: '/api/users', file: './routes/userRoutes' },
  { path: '/api/auth', file: './routes/auth' },
  { path: '/api/posts', file: './routes/posts' },
  { path: '/api/comments', file: './routes/commentRoutes' },
  { path: '/api/notifications', file: './routes/notificationRoutes' },
  { path: '/api/conversations', file: './routes/conversationRoutes' }

];

routes.forEach(route => {
  try {
    const router = require(route.file);
    app.use(route.path, router);
    console.log(`✅ Loaded ${route.path}`);
  } catch (error) {
    console.log(`❌ Failed to load ${route.path}:`, error.message);
  }
});

// IMPORTANT: Mount message routes UNDER conversations
// This ensures /api/conversations/:conversationId/messages works
try {
  const messageRouter = require('./routes/messageRoutes');
  app.use('/api/conversations', messageRouter);
  console.log(`✅ Loaded message routes under /api/conversations`);
} catch (error) {
  console.log(`❌ Failed to load message routes:`, error.message);
}
try {
  const pushRoutes = require('./routes/pushRoutes');
  app.use('/api/push', pushRoutes);
  console.log(`✅ Loaded push notification routes`);
} catch (error) {
  console.log(`❌ Failed to load push routes:`, error.message);
}

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket ready at ws://localhost:${PORT}`);
  console.log(`\n📊 Registered Mongoose models:`, Object.keys(mongoose.models));
});
