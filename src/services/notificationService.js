const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPushNotification } = require('./pushService'); // You'll need to create this
const { sendEmail, sendSMS } = require('./notificationService'); // Your existing email/SMS service

/**
 * Centralized notification service
 * Use this service to create notifications from anywhere in your app
 */
class NotificationService {

  /**
   * Create a new notification
   * @param {Object} data - Notification data
   * @param {string} data.recipient - Recipient user ID
   * @param {string} data.sender - Sender user ID
   * @param {string} data.type - Notification type
   * @param {Object} data.reference - Reference object { model, id }
   * @param {Object} data.metadata - Additional metadata
   * @param {boolean} data.sendPush - Whether to send push notification (default: true)
   * @param {boolean} data.sendEmail - Whether to send email (default: false)
   * @param {boolean} data.sendSMS - Whether to send SMS (default: false)
   */
  static async create(data) {
    try {
      // Check if recipient has this notification type enabled
      const recipient = await User.findById(data.recipient).select('notificationPreferences pushSubscriptions email phoneNumber');

      if (recipient && recipient.notificationPreferences) {
        const isEnabled = recipient.notificationPreferences[data.type];
        if (isEnabled === false) {
          console.log(`📝 Notification type ${data.type} is disabled for user ${data.recipient}`);
          return null;
        }
      }

      // Create notification
      const notification = new Notification({
        recipient: data.recipient,
        sender: data.sender,
        type: data.type,
        reference: data.reference,
        metadata: data.metadata || {},
        isRead: false,
        isArchived: false
      });

      await notification.save();

      // Populate sender info
      await notification.populate('sender', 'username name profilePicture');

      // Emit real-time event via WebSocket
      this.emitRealTime(notification);

      // Send push notification if enabled
      if (data.sendPush !== false) {
        await this.sendPushNotification(notification, recipient);
      }

      // Send email if requested
      if (data.sendEmail) {
        await this.sendEmailNotification(notification, recipient);
      }

      // Send SMS if requested
      if (data.sendSMS) {
        await this.sendSMSNotification(notification, recipient);
      }

      return notification;
    } catch (error) {
      console.error('❌ Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create multiple notifications (bulk)
   * @param {Array} notifications - Array of notification data objects
   */
  static async createBulk(notifications) {
    try {
      const createdNotifications = [];

      for (const data of notifications) {
        const notification = await this.create(data);
        if (notification) {
          createdNotifications.push(notification);
        }
      }

      return createdNotifications;
    } catch (error) {
      console.error('❌ Error creating bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Emit real-time notification via WebSocket
   */
  static emitRealTime(notification) {
    try {
      const io = require('./websocket').getIO();
      if (io) {
        io.to(`user:${notification.recipient}`).emit('notification:new', notification);
        console.log(`📡 Real-time notification sent to user:${notification.recipient}`);
      }
    } catch (error) {
      console.log('⚠️ WebSocket not available, skipping real-time notification');
    }
  }

  /**
   * Send push notification to user's devices
   */
  static async sendPushNotification(notification, recipient) {
    try {
      if (!recipient || !recipient.pushSubscriptions || recipient.pushSubscriptions.length === 0) {
        return;
      }

      const { getNotificationTitle, getNotificationBody } = this.getNotificationContent(notification);

      const pushService = require('./pushService');
      await pushService.sendToUser(recipient._id, {
        title: getNotificationTitle(),
        body: getNotificationBody(),
        data: {
          type: notification.type,
          notificationId: notification._id,
          reference: notification.reference,
          metadata: notification.metadata,
          url: this.getNotificationUrl(notification)
        }
      });

      console.log(`📱 Push notification sent to user ${recipient._id}`);
    } catch (error) {
      console.error('❌ Error sending push notification:', error);
    }
  }

  /**
   * Send email notification
   */
  static async sendEmailNotification(notification, recipient) {
    try {
      if (!recipient || !recipient.email) {
        console.log('⚠️ No email address found for user');
        return;
      }

      const { getNotificationTitle, getNotificationBody, getEmailHTML } = this.getNotificationContent(notification);

      await sendEmail({
        email: recipient.email,
        subject: getNotificationTitle(),
        html: getEmailHTML(notification, recipient)
      });

      console.log(`📧 Email notification sent to ${recipient.email}`);
    } catch (error) {
      console.error('❌ Error sending email notification:', error);
    }
  }

  /**
   * Send SMS notification
   */
  static async sendSMSNotification(notification, recipient) {
    try {
      if (!recipient || !recipient.phoneNumber) {
        console.log('⚠️ No phone number found for user');
        return;
      }

      const { getNotificationBody } = this.getNotificationContent(notification);

      await sendSMS({
        phoneNumber: `${recipient.phoneCountryCode || '+1'}${recipient.phoneNumber}`,
        message: getNotificationBody()
      });

      console.log(`📱 SMS notification sent to ${recipient.phoneNumber}`);
    } catch (error) {
      console.error('❌ Error sending SMS notification:', error);
    }
  }

  /**
   * Get notification content based on type
   */
  static getNotificationContent(notification) {
    const senderName = notification.sender?.name || notification.sender?.username || 'Someone';

    const contents = {
      // Follow notifications
      new_follower: {
        title: () => 'New Follower',
        body: () => `${senderName} started following you`,
        emailHTML: (notif, user) => `
          <h2>New Follower! 🎉</h2>
          <p><strong>${senderName}</strong> started following you on Pulse.</p>
          <a href="${process.env.FRONTEND_URL}/profile/${notification.sender?.username}" class="button">View Profile</a>
        `
      },

      // Like notifications
      post_like: {
        title: () => 'New Like',
        body: () => `${senderName} liked your post`,
        emailHTML: (notif, user) => `
          <h2>New Like! ❤️</h2>
          <p><strong>${senderName}</strong> liked your post.</p>
          <a href="${process.env.FRONTEND_URL}/posts/${notification.metadata?.postId}" class="button">View Post</a>
        `
      },

      // Comment notifications
      post_comment: {
        title: () => 'New Comment',
        body: () => `${senderName} commented on your post`,
        emailHTML: (notif, user) => `
          <h2>New Comment! 💬</h2>
          <p><strong>${senderName}</strong> commented: "${notification.metadata?.commentPreview || '...'}"</p>
          <a href="${process.env.FRONTEND_URL}/posts/${notification.metadata?.postId}" class="button">View Comment</a>
        `
      },

      // Reply notifications
      comment_reply: {
        title: () => 'New Reply',
        body: () => `${senderName} replied to your comment`,
        emailHTML: (notif, user) => `
          <h2>New Reply! ↩️</h2>
          <p><strong>${senderName}</strong> replied: "${notification.metadata?.replyPreview || '...'}"</p>
          <a href="${process.env.FRONTEND_URL}/posts/${notification.metadata?.postId}" class="button">View Reply</a>
        `
      },

      // Mention notifications
      mention: {
        title: () => 'You were mentioned',
        body: () => `${senderName} mentioned you in a post`,
        emailHTML: (notif, user) => `
          <h2>You Were Mentioned! 📢</h2>
          <p><strong>${senderName}</strong> mentioned you in a post.</p>
          <a href="${process.env.FRONTEND_URL}/posts/${notification.metadata?.postId}" class="button">View Post</a>
        `
      },

      // Message notifications
      message: {
        title: () => 'New Message',
        body: () => `${senderName} sent you a message`,
        emailHTML: (notif, user) => `
          <h2>New Message! 💬</h2>
          <p><strong>${senderName}</strong> sent you a message.</p>
          <a href="${process.env.FRONTEND_URL}/messages/${notification.metadata?.conversationId}" class="button">Open Chat</a>
        `
      },

      // Password reset notifications
      password_reset: {
        title: () => 'Password Reset Request',
        body: () => 'Password reset link was requested for your account',
        emailHTML: (notif, user) => `
          <h2>Password Reset Request 🔐</h2>
          <p>A password reset was requested for your Pulse account.</p>
          <p>If you didn't request this, please ignore this email or contact support.</p>
          <a href="${process.env.FRONTEND_URL}/reset-password/${notification.metadata?.resetToken}" class="button">Reset Password</a>
          <p class="warning">⚠️ This link expires in 10 minutes.</p>
        `
      },

      // Phone verification
      phone_verification: {
        title: () => 'Verify Your Phone',
        body: () => `Your verification code is: ${notification.metadata?.verificationCode}`,
        emailHTML: (notif, user) => `
          <h2>Verify Your Phone Number 📱</h2>
          <p>Your Pulse verification code is:</p>
          <div class="code">${notification.metadata?.verificationCode}</div>
          <p>Enter this code in the app to verify your phone number.</p>
          <p class="warning">⚠️ This code expires in 10 minutes.</p>
        `
      },

      // Account security
      login_from_new_device: {
        title: () => 'New Device Login',
        body: () => `New login detected from ${notification.metadata?.device || 'unknown device'}`,
        emailHTML: (notif, user) => `
          <h2>New Device Login 🔒</h2>
          <p>A new login was detected on your Pulse account.</p>
          <ul>
            <li><strong>Device:</strong> ${notification.metadata?.device || 'Unknown'}</li>
            <li><strong>Location:</strong> ${notification.metadata?.location || 'Unknown'}</li>
            <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
          </ul>
          <p>If this wasn't you, please change your password immediately.</p>
          <a href="${process.env.FRONTEND_URL}/settings/security" class="button">Review Security</a>
        `
      },

      // Welcome notification for new users
      welcome: {
        title: () => 'Welcome to Pulse! 🎉',
        body: () => 'Welcome to Pulse! Start connecting with friends.',
        emailHTML: (notif, user) => `
          <h2>Welcome to Pulse! 🎉</h2>
          <p>Hi <strong>${user?.name || user?.username}</strong>,</p>
          <p>We're excited to have you on Pulse! Here's what you can do:</p>
          <ul>
            <li>📝 Create posts and share your thoughts</li>
            <li>📸 Share photos and videos</li>
            <li>💬 Connect with friends via messages</li>
            <li>🔔 Get notified about important updates</li>
          </ul>
          <a href="${process.env.FRONTEND_URL}" class="button">Get Started</a>
        `
      }
    };

    return contents[notification.type] || {
      title: () => 'New Notification',
      body: () => 'You have a new notification',
      emailHTML: (notif, user) => `
        <h2>New Notification</h2>
        <p>You have a new notification on Pulse.</p>
        <a href="${process.env.FRONTEND_URL}/notifications" class="button">View Notifications</a>
      `
    };
  }

  /**
   * Get notification URL based on type
   */
  static getNotificationUrl(notification) {
    const urls = {
      new_follower: `/profile/${notification.sender?.username}`,
      post_like: `/posts/${notification.metadata?.postId}`,
      post_comment: `/posts/${notification.metadata?.postId}`,
      comment_reply: `/posts/${notification.metadata?.postId}`,
      mention: `/posts/${notification.metadata?.postId}`,
      message: `/messages/${notification.metadata?.conversationId}`,
      password_reset: `/reset-password/${notification.metadata?.resetToken}`,
      phone_verification: '/settings/security',
      login_from_new_device: '/settings/security',
      welcome: '/'
    };

    return urls[notification.type] || '/notifications';
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: userId },
        {
          isRead: true,
          readAt: new Date()
        },
        { new: true }
      );

      if (notification) {
        // Emit read event
        try {
          const io = require('./websocket').getIO();
          if (io) {
            io.to(`user:${userId}`).emit('notification:read', { notificationId });
          }
        } catch (error) {
          console.log('WebSocket not available');
        }
      }

      return notification;
    } catch (error) {
      console.error('❌ Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId) {
    try {
      const result = await Notification.updateMany(
        { recipient: userId, isRead: false },
        {
          isRead: true,
          readAt: new Date()
        }
      );

      // Emit bulk read event
      try {
        const io = require('./websocket').getIO();
        if (io) {
          io.to(`user:${userId}`).emit('notifications:read', { count: result.modifiedCount });
        }
      } catch (error) {
        console.log('WebSocket not available');
      }

      return result;
    } catch (error) {
      console.error('❌ Error marking all as read:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  static async delete(notificationId, userId) {
    try {
      const result = await Notification.findOneAndDelete({
        _id: notificationId,
        recipient: userId
      });

      // Emit delete event
      try {
        const io = require('./websocket').getIO();
        if (io) {
          io.to(`user:${userId}`).emit('notification:deleted', { notificationId });
        }
      } catch (error) {
        console.log('WebSocket not available');
      }

      return result;
    } catch (error) {
      console.error('❌ Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Archive notification
   */
  static async archive(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: userId },
        { isArchived: true },
        { new: true }
      );

      return notification;
    } catch (error) {
      console.error('❌ Error archiving notification:', error);
      throw error;
    }
  }

  /**
   * Get unread count for a user
   */
  static async getUnreadCount(userId) {
    try {
      const count = await Notification.countDocuments({
        recipient: userId,
        isRead: false,
        isArchived: false
      });

      return count;
    } catch (error) {
      console.error('❌ Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Clean up old notifications
   */
  static async cleanupOldNotifications(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await Notification.deleteMany({
        createdAt: { $lt: cutoffDate },
        isRead: true,
        isArchived: true
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old notifications`);
      return result;
    } catch (error) {
      console.error('❌ Error cleaning up notifications:', error);
      throw error;
    }
  }
}

module.exports = NotificationService;