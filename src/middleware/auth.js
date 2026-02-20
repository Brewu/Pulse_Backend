const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect routes - verify JWT and attach authenticated user to req.user
 */
const protect = async (req, res, next) => {
  let token;

  // Extract token from Authorization header (Bearer <token>)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // No token provided
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');

    // Find user by ID from token payload (exclude password)
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.',
      });
    }

    // Optional: check if account is active
    // if (!user.isActive) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: 'Account is disabled.' 
    //   });
    // }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    // Specific JWT errors for better feedback
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please log in again.',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }

    // Unexpected error (log it for debugging)
    console.error('Authentication error:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized.',
    });
  }
};

/**
 * Check if users are blocked from interacting
 * Use after protect middleware on routes that require user interaction
 */
const checkBlocked = async (req, res, next) => {
  try {
    const targetUserId = req.params.id || req.params.userId;
    const currentUserId = req.user._id;

    // Don't check if interacting with self
    if (currentUserId.toString() === targetUserId.toString()) {
      return next();
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findById(currentUserId).select('blockedUsers'),
      User.findById(targetUserId).select('blockedUsers')
    ]);

    // Check if target user exists
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    // Check if either user has blocked the other
    if (currentUser.blockedUsers.includes(targetUserId) || 
        targetUser.blockedUsers.includes(currentUserId)) {
      return res.status(403).json({ 
        success: false,
        message: 'Action not allowed. User interaction is blocked.' 
      });
    }

    next();
  } catch (error) {
    console.error('Block check error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error while checking user status.'
    });
  }
};

/**
 * Optional: Check if user is admin
 */
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
};

module.exports = { protect, checkBlocked, admin };