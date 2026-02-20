// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  archiveNotification,
  getUnreadCount,
  getPreferences,
  updatePreferences
} = require('../controllers/notificationController');

// All notification routes are protected
router.use(protect);

// GET /api/notifications - Get user's notifications
router.get('/', getNotifications);

// GET /api/notifications/unread-count - Get unread count
router.get('/unread-count', getUnreadCount);

// GET /api/notifications/preferences - Get notification preferences
router.get('/preferences', getPreferences);

// PUT /api/notifications/preferences - Update notification preferences
router.put('/preferences', updatePreferences);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', markAsRead);

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', markAllAsRead);

// PUT /api/notifications/:id/archive - Archive notification
router.put('/:id/archive', archiveNotification);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', deleteNotification);

module.exports = router;