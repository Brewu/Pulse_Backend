const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

module.exports = {
  init: (server) => {
    io = socketIo(server, {
      cors: {
        origin: [
          'http://localhost:3000',
         "https://main.pulse-social.pages.dev/",
    "https://2a4b7aaf.pulse-social.pages.dev/",
          'http://localhost:5173',
          "https://pulse-eta-cyan.vercel.app",
          "http://192.168.56.1:3000",
          "https://pulse-swart-nine.vercel.app",
          "https://vercel.com/brewu-richard-appiahs-projects/rabbiespulse/7JQR9SL4LSvEAYpMrG5uY7oogNE5",
          "https://rabbiespulse.vercel.app/"
          // Add production frontend URL here, e.g.:
          // 'https://yourdomain.com'
        ],
        methods: ['GET', 'POST'],
        credentials: true
      },
      // Optional: tune for production
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Socket.io authentication middleware (shared logic with HTTP protect)
    io.use(async (socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Optionally fetch full user (without password)
        // const user = await User.findById(decoded.id).select('-password');
        // socket.user = user;

        socket.user = decoded; // At minimum, attach decoded payload
        next();
      } catch (error) {
        console.error('Socket auth error:', error.message);
        if (error.name === 'TokenExpiredError') {
          return next(new Error('Authentication error: Token expired'));
        }
        return next(new Error('Authentication error: Invalid token'));
      }
    });

    io.on('connection', (socket) => {
      console.log('New WebSocket connection:', socket.id, 'User:', socket.user?.id);

      // Automatically join the authenticated user's private room
      if (socket.user?.id) {
        socket.join(`user:${socket.user.id}`);
        console.log(`User ${socket.user.id} auto-joined their room`);
      }

      // Optional: Keep manual 'join' for additional rooms (e.g., group chats)
      socket.on('join', (room) => {
        socket.join(room);
        console.log(`Socket ${socket.id} joined room: ${room}`);
      });

      // Optional: 'leave' event
      socket.on('leave', (room) => {
        socket.leave(room);
        console.log(`Socket ${socket.id} left room: ${room}`);
      });

      socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
      });
    });

    return io;
  },

  getIO: () => {
    if (!io) {
      throw new Error('WebSocket not initialized! Call init(server) first.');
    }
    return io;
  }
};
