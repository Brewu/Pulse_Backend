const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * @desc    Get user's notifications
 * @route   GET /api/notifications
 * @access  Private
 */
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const { type, unreadOnly } = req.query;

    // Build query
    const query = {
      recipient: userId,
      isArchived: false
    };

    if (type) {
      query.type = type;
    }

    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    // Run queries in parallel
    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(query)
        .populate('sender', 'username name profilePicture')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      
      Notification.countDocuments({
        recipient: userId,
        isRead: false,
        isArchived: false
      }),
      
      Notification.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + notifications.length < total
      },
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipient: userId,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or already read'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await Notification.updateMany(
      {
        recipient: userId,
        isRead: false
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read'
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
};

/**
 * @desc    Archive notification
 * @route   PUT /api/notifications/:id/archive
 * @access  Private
 */
exports.archiveNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipient: userId
      },
      {
        isArchived: true
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification archived',
      data: notification
    });
  } catch (error) {
    console.error('Archive notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive notification'
    });
  }
};

/**
 * @desc    Get notification preferences
 * @route   GET /api/notifications/preferences
 * @access  Private
 */
exports.getPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('notificationPreferences');

    res.json({
      success: true,
      data: user?.notificationPreferences || {
        email: true,
        push: true,
        inApp: true,
        types: {
          new_message: true,
          new_follower: true,
          post_like: true,
          post_comment: true,
          mention: true
        }
      }
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get preferences'
    });
  }
};

/**
 * @desc    Update notification preferences
 * @route   PUT /api/notifications/preferences
 * @access  Private
 */
exports.updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: { notificationPreferences: preferences }
      },
      { new: true }
    ).select('notificationPreferences');

    res.json({
      success: true,
      message: 'Preferences updated',
      data: user?.notificationPreferences
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences'
    });
  }
};

/**
 * @desc    Get unread notification count
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const count = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
      isArchived: false
    });

    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
};

/**
 * @desc    Create a notification (internal use)
 * @access  Internal
 */
exports.createNotification = async (recipientId, senderId, type, reference = null, metadata = {}) => {
  try {
    const notification = await Notification.createNotification({
      recipient: recipientId,
      sender: senderId,
      type,
      reference,
      metadata
    });
    
    return notification;
  } catch (error) {
    console.error('Create notification error:', error);
    throw error;
  }
};

module.exports = exports;