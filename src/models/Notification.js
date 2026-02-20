const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
   senderUsername: {
    type: String,
    trim: true
  },
  
  type: {
    type: String,
    enum: [
      'new_message',
      'message_reaction',
      'message_reply',
      'new_follower',
      'post_like',
      'post_comment',
      'comment_reply',
      'mention',
      'friend_request',
      'friend_request_accepted',
      'event_invitation',
      'group_invitation',
      'system'
    ],
    required: true
  },
  
  // Reference to the related entity
  reference: {
    model: {
      type: String,
      enum: ['User', 'Post', 'Comment', 'Message', 'Conversation', 'Event', 'Group']
    },
    id: {
      type: mongoose.Schema.Types.ObjectId
    }
  },
  
  title: {
    type: String,
    trim: true,
    maxlength: 200
  },
  
  message: {
    type: String,
    trim: true,
    maxlength: 500
  },
  
  // For deep linking
  actionUrl: {
    type: String,
    trim: true
  },
  
  // Notification status
  isRead: {
    type: Boolean,
    default: false
  },
  
  isArchived: {
    type: Boolean,
    default: false
  },
  
  // For push notifications
  pushSent: {
    type: Boolean,
    default: false
  },
  
  pushSentAt: Date,
  
  // For email notifications
  emailSent: {
    type: Boolean,
    default: false
  },
  
  emailSentAt: Date,
  
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  readAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });

// Virtual for formatted date
notificationSchema.virtual('timeAgo').get(function() {
  const seconds = Math.floor((new Date() - this.createdAt) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1
  };

  for (const [unit, value] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / value);
    if (interval >= 1) {
      return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
    }
  }
  
  return 'just now';
});

// Method to generate notification content based on type (no next() callback)
notificationSchema.methods.generateNotificationContent = function() {
  const notificationTemplates = {
    'new_message': {
      title: 'New Message',
      message: 'sent you a message',
      actionUrl: this.reference?.id ? `/messages/${this.reference.id}` : '/messages'
    },
    'message_reaction': {
      title: 'Reaction to your message',
      message: 'reacted to your message',
      actionUrl: this.reference?.id ? `/messages/${this.reference.id}` : '/messages'
    },
    'message_reply': {
      title: 'Reply to your message',
      message: 'replied to your message',
      actionUrl: this.reference?.id ? `/messages/${this.reference.id}` : '/messages'
    },
    'new_follower': {
      title: 'New Follower',
      message: 'started following you',
      actionUrl: this.sender ? `/profile/${this.sender}` : '/profile'
    },
    'post_like': {
      title: 'Post Liked',
      message: 'liked your post',
      actionUrl: this.reference?.id ? `/posts/${this.reference.id}` : '/'
    },
    'post_comment': {
      title: 'New Comment',
      message: 'commented on your post',
      actionUrl: this.reference?.id ? `/posts/${this.reference.id}` : '/'
    },
    'comment_reply': {
      title: 'Reply to your comment',
      message: 'replied to your comment',
      actionUrl: this.reference?.id ? `/posts/${this.reference.id}` : '/'
    },
    'mention': {
      title: 'You were mentioned',
      message: 'mentioned you in a post',
      actionUrl: this.reference?.id ? `/posts/${this.reference.id}` : '/'
    },
    'friend_request': {
      title: 'Friend Request',
      message: 'sent you a friend request',
      actionUrl: '/friends/requests'
    },
    'friend_request_accepted': {
      title: 'Friend Request Accepted',
      message: 'accepted your friend request',
      actionUrl: this.sender ? `/profile/${this.sender}` : '/profile'
    },
    'event_invitation': {
      title: 'Event Invitation',
      message: 'invited you to an event',
      actionUrl: this.reference?.id ? `/events/${this.reference.id}` : '/events'
    },
    'group_invitation': {
      title: 'Group Invitation',
      message: 'invited you to join a group',
      actionUrl: this.reference?.id ? `/groups/${this.reference.id}` : '/groups'
    },
    'system': {
      title: 'System Notification',
      message: '',
      actionUrl: '/'
    }
  };

  const template = notificationTemplates[this.type] || {
    title: 'Notification',
    message: '',
    actionUrl: '/'
  };

  // Set title if not already set
  if (!this.title) {
    this.title = template.title;
  }

  // Build message with sender info if available
  if (!this.message) {
    this.message = this.sender 
      ? `@${this.senderUsername || 'Someone'} ${template.message}`
      : template.message;
  }

  // Set action URL if not already set
  if (!this.actionUrl) {
    this.actionUrl = template.actionUrl;
  }
};

// Pre-save hook without next() callback - using async function
notificationSchema.pre('save', async function() {
  // Generate content if title or message is missing
  if (!this.title || !this.message) {
    this.generateNotificationContent();
  }

  // If sender is provided but we need username for the message
  if (this.sender && !this.senderUsername) {
    try {
      const User = mongoose.model('User');
      const senderUser = await User.findById(this.sender).select('username');
      if (senderUser) {
        this.senderUsername = senderUser.username;
        // Regenerate message with username
        if (!this.message.includes('@')) {
          this.generateNotificationContent();
        }
      }
    } catch (error) {
      console.error('Error fetching sender username:', error);
    }
  }
});

// Pre-find hook to populate sender username
notificationSchema.pre(/^find/, function() {
  this.populate('sender', 'username profilePicture');
});

// Static method to create notification (no callback)
notificationSchema.statics.createNotification = async function(data) {
  try {
    // Fetch sender username if sender ID is provided
    if (data.sender && !data.senderUsername) {
      const User = mongoose.model('User');
      const sender = await User.findById(data.sender).select('username');
      if (sender) {
        data.senderUsername = sender.username;
      }
    }

    // Create notification instance
    const notification = new this(data);
    
    // Generate content if not provided
    if (!notification.title || !notification.message) {
      notification.generateNotificationContent();
    }

    // Save to database
    await notification.save();

    // Emit real-time event via Socket.io
    try {
      const io = require('../services/websocket').getIO?.();
      if (io) {
        io.to(`user:${notification.recipient}`).emit('notification:new', notification);
      }
    } catch (socketError) {
      console.error('Failed to emit socket notification:', socketError);
    }

    return notification;
  } catch (error) {
    console.error('Failed to create notification:', error);
    throw error;
  }
};

// Method to mark as read (no callback)
notificationSchema.methods.markAsRead = async function() {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
    await this.save();
  }
  return this;
};

// Method to mark as unread
notificationSchema.methods.markAsUnread = async function() {
  if (this.isRead) {
    this.isRead = false;
    this.readAt = null;
    await this.save();
  }
  return this;
};

// Method to archive
notificationSchema.methods.archive = async function() {
  this.isArchived = true;
  await this.save();
  return this;
};

// Static method to mark multiple as read
notificationSchema.statics.markAllAsRead = async function(recipientId) {
  const result = await this.updateMany(
    { recipient: recipientId, isRead: false },
    { 
      isRead: true, 
      readAt: new Date() 
    }
  );
  return result;
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function(recipientId) {
  return await this.countDocuments({ 
    recipient: recipientId, 
    isRead: false,
    isArchived: false 
  });
};

// Static method to clean up old notifications
notificationSchema.statics.cleanup = async function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const result = await this.deleteMany({
    createdAt: { $lt: cutoffDate },
    isRead: true,
    isArchived: true
  });
  
  return result;
};

module.exports = mongoose.model('Notification', notificationSchema);