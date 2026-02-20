const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  participantDetails: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isArchived: {
      type: Boolean,
      default: false
    },
    isPinned: {
      type: Boolean,
      default: false
    },
    isMuted: {
      type: Boolean,
      default: false
    },
    mutedUntil: {
      type: Date
    },
    isBlocked: {
      type: Boolean,
      default: false
    },
    blockedReason: String,
    lastReadMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    unreadCount: {
      type: Number,
      default: 0
    },
    deletedForMe: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    }]
  }],
  type: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct'
  },
  groupName: String,
  groupAvatar: String,
  groupDescription: String,
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// Ensure exactly 2 participants for direct messages - without next callback
conversationSchema.pre('save', function() {
  if (this.type === 'direct' && this.participants.length !== 2) {
    throw new Error('Direct conversation must have exactly 2 participants');
  }
});

// Index for faster queries
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ 'participantDetails.user': 1, 'participantDetails.isArchived': 1 });

module.exports = mongoose.model('Conversation', conversationSchema);