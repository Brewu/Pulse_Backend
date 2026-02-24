const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Please provide a username'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters']
  },

  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },

  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },

  name: {
    type: String,
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },

  profilePicture: {
    type: String,
    default: 'https://res.cloudinary.com/demo/image/upload/v1570979186/default-avatar.png'
  },

  coverPicture: {
    type: String,
    default: ''
  },

  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters'],
    default: ''
  },

  // Score and rank system - UPDATED WITH 10 RANKS
  score: {
    type: Number,
    default: 0,
    min: 0
  },

  rank: {
    type: String,
    enum: [
      'Rookie',
      'Bronze',
      'Silver',
      'Gold',
      'Platinum',
      'Diamond',
      'Master',
      'Grandmaster',
      'Legend',
      'Mythic'
    ],
    default: 'Rookie'
  },

  // Activity counts
  postsCount: {
    type: Number,
    default: 0,
    min: 0
  },

  commentsCount: {
    type: Number,
    default: 0,
    min: 0
  },

  likesReceived: {
    type: Number,
    default: 0,
    min: 0
  },

  // Social fields
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // ========== NEW: Push notification subscriptions ==========
  pushSubscriptions: [{
    endpoint: {
      type: String,
      required: true,
      unique: true
    },
    keys: {
      p256dh: String,
      auth: String
    },
    platform: {
      type: String,
      enum: ['web', 'ios', 'android', 'expo'],
      default: 'web'
    },
    deviceName: {
      type: String,
      default: 'Unknown Device'
    },
    deviceModel: String,
    appVersion: String,
    userAgent: String,
    createdAt: {
      type: Date,
      default: Date.now
    },
    lastUsed: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    },
    preferences: {
      sound: { type: Boolean, default: true },
      vibration: { type: Boolean, default: true },
      badge: { type: Boolean, default: true },
      lights: { type: Boolean, default: true }
    }
  }],

  // ========== UPDATED: Notification preferences with global and per-type settings ==========
  notificationPreferences: {
    // Global settings
    global: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      sound: { type: Boolean, default: true },
      vibration: { type: Boolean, default: true },
      doNotDisturb: {
        enabled: { type: Boolean, default: false },
        startTime: String, // Format: "HH:MM"
        endTime: String,   // Format: "HH:MM"
        timezone: { type: String, default: 'UTC' }
      }
    },
    // Per-type settings (override global)
    types: {
      new_message: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      },
      message_reaction: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      },
      message_reply: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      },
      new_follower: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
      },
      post_like: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      },
      post_comment: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      },
      comment_reply: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      },
      mention: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
      },
      friend_request: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
      },
      friend_request_accepted: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
      },
      event_invitation: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
      },
      group_invitation: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
      },
      system: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sound: { type: Boolean, default: true }
      }
    }
  },

  // Privacy settings
  privacySettings: {
    profileVisibility: {
      type: String,
      enum: ['public', 'private', 'followers_only'],
      default: 'public'
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    allowTags: {
      type: Boolean,
      default: true
    },
    allowMessagesFrom: {
      type: String,
      enum: ['everyone', 'followers_only', 'nobody'],
      default: 'everyone'
    }
  },

  // Account verification
  isVerified: {
    type: Boolean,
    default: false
  },

  // Account status
  isActive: {
    type: Boolean,
    default: true
  },

  // Last seen for online status
  lastSeen: {
    type: Date,
    default: Date.now
  },

  // Device info for push
  activeDevices: [{
    deviceId: String,
    deviceName: String,
    platform: String,
    lastActive: Date,
    pushToken: String
  }]

}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.__v;
      // Remove sensitive push subscription keys from JSON output
      if (ret.pushSubscriptions) {
        ret.pushSubscriptions = ret.pushSubscriptions.map(sub => ({
          ...sub,
          keys: undefined // Don't expose crypto keys in API responses
        }));
      }
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ========== INDEXES ==========
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });
userSchema.index({ score: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ 'pushSubscriptions.endpoint': 1 }); // For faster subscription lookups
userSchema.index({ lastSeen: -1 }); // For online status queries
// In backend/models/User.js - add before module.exports

// ========== INDEXES FOR PERFORMANCE ==========
userSchema.index({ username: 1 }); // For username lookups (already have unique)
userSchema.index({ email: 1 }); // For email lookups (already have unique)
userSchema.index({ followers: 1 }); // For follower counts and lists
userSchema.index({ following: 1 }); // For following lists
userSchema.index({ score: -1 }); // For leaderboards/ranking
userSchema.index({ createdAt: -1 }); // For sorting by join date
userSchema.index({ 'pushSubscriptions.endpoint': 1 }); // For push notification lookups
userSchema.index({ lastSeen: -1 }); // For online status queries
userSchema.index({ isActive: 1, createdAt: -1 }); // For active users
// ========== VIRTUALS ==========
userSchema.virtual('followerCount').get(function () {
  return this.followers ? this.followers.length : 0;
});

userSchema.virtual('followingCount').get(function () {
  return this.following ? this.following.length : 0;
});

userSchema.virtual('isOnline').get(function () {
  // Consider user online if lastSeen within last 5 minutes
  return this.lastSeen && (Date.now() - this.lastSeen < 5 * 60 * 1000);
});

// ========== PRE-SAVE MIDDLEWARE ==========
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Update lastSeen on save
userSchema.pre('save', function () {
  this.lastSeen = new Date();
});

// ========== PRE-REMOVE MIDDLEWARE ==========
userSchema.pre('remove', async function () {
  console.log(`🗑️ Removing user ${this._id} and cleaning up references...`);

  await mongoose.model('User').updateMany(
    { followers: this._id },
    { $pull: { followers: this._id } }
  );

  await mongoose.model('User').updateMany(
    { following: this._id },
    { $pull: { following: this._id } }
  );

  await mongoose.model('Post').deleteMany({ author: this._id });
  await mongoose.model('Comment').deleteMany({ author: this._id });
});

// ========== INSTANCE METHODS ==========
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.getPublicProfile = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.__v;
  delete userObject.privacySettings;
  delete userObject.notificationPreferences;
  delete userObject.pushSubscriptions;
  delete userObject.activeDevices;
  return userObject;
};

// ========== NEW: Push notification subscription methods ==========
// Add a push subscription
userSchema.methods.addPushSubscription = async function (subscriptionData) {
  // Check if subscription already exists
  const existingIndex = this.pushSubscriptions.findIndex(
    sub => sub.endpoint === subscriptionData.endpoint
  );

  const newSubscription = {
    endpoint: subscriptionData.endpoint,
    keys: subscriptionData.keys || {},
    platform: subscriptionData.platform || 'web',
    deviceName: subscriptionData.deviceName || 'Unknown Device',
    deviceModel: subscriptionData.deviceModel,
    appVersion: subscriptionData.appVersion,
    userAgent: subscriptionData.userAgent,
    lastUsed: new Date(),
    isActive: true,
    preferences: {
      sound: subscriptionData.preferences?.sound ?? true,
      vibration: subscriptionData.preferences?.vibration ?? true,
      badge: subscriptionData.preferences?.badge ?? true,
      lights: subscriptionData.preferences?.lights ?? true
    }
  };

  if (existingIndex >= 0) {
    // Update existing subscription
    this.pushSubscriptions[existingIndex] = {
      ...this.pushSubscriptions[existingIndex].toObject(),
      ...newSubscription,
      createdAt: this.pushSubscriptions[existingIndex].createdAt
    };
  } else {
    // Add new subscription
    this.pushSubscriptions.push(newSubscription);
  }

  await this.save();
  return this.pushSubscriptions;
};

// Remove a push subscription
userSchema.methods.removePushSubscription = async function (endpoint) {
  this.pushSubscriptions = this.pushSubscriptions.filter(
    sub => sub.endpoint !== endpoint
  );
  await this.save();
  return this.pushSubscriptions;
};

// Update subscription last used time
userSchema.methods.updateSubscriptionLastUsed = async function (endpoint) {
  const subscription = this.pushSubscriptions.find(
    sub => sub.endpoint === endpoint
  );
  if (subscription) {
    subscription.lastUsed = new Date();
    await this.save();
  }
};

// Get active push subscriptions
userSchema.methods.getActiveSubscriptions = function () {
  return this.pushSubscriptions.filter(sub => sub.isActive);
};

// ========== NEW: Notification preference methods ==========
// Check if user wants to receive this type of notification
userSchema.methods.shouldNotify = function (type, channel = 'push') {
  // Check global DND
  if (this.notificationPreferences.global.doNotDisturb.enabled) {
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });

    const { startTime, endTime } = this.notificationPreferences.global.doNotDisturb;

    if (startTime && endTime) {
      if (startTime <= endTime) {
        if (currentTime >= startTime && currentTime <= endTime) {
          return false; // DND active
        }
      } else {
        // Overnight DND
        if (currentTime >= startTime || currentTime <= endTime) {
          return false; // DND active
        }
      }
    }
  }

  // Check global preference for this channel
  if (!this.notificationPreferences.global[channel]) {
    return false;
  }

  // Check type-specific preference
  const typePrefs = this.notificationPreferences.types[type];
  if (typePrefs && typePrefs[channel] !== undefined) {
    return typePrefs[channel];
  }

  // Default to true
  return true;
};

// Update notification preferences
userSchema.methods.updateNotificationPreferences = async function (preferences) {
  if (preferences.global) {
    this.notificationPreferences.global = {
      ...this.notificationPreferences.global,
      ...preferences.global
    };
  }

  if (preferences.types) {
    this.notificationPreferences.types = {
      ...this.notificationPreferences.types,
      ...preferences.types
    };
  }

  await this.save();
  return this.notificationPreferences;
};

// UPDATED: Score update method with 10 ranks
userSchema.methods.updateScore = function (action) {
  const scoreMap = {
    'post_created': 20,
    'comment_created': 5,
    'like_received': 1,
    'comment_like_received': 1,
    'follower_gained': 10,
    'profile_completed': 15
  };

  if (scoreMap[action]) {
    if (!this.score) this.score = 0;
    this.score += scoreMap[action];
    if (this.score > 1000000) this.score = 1000000;
  }

  // 10 Ranks with score thresholds
  const rankThresholds = [
    { name: 'Rookie', min: 0, max: 999 },
    { name: 'Bronze', min: 1000, max: 4999 },
    { name: 'Silver', min: 5000, max: 9999 },
    { name: 'Gold', min: 10000, max: 24999 },
    { name: 'Platinum', min: 25000, max: 49999 },
    { name: 'Diamond', min: 50000, max: 99999 },
    { name: 'Master', min: 100000, max: 249999 },
    { name: 'Grandmaster', min: 250000, max: 499999 },
    { name: 'Legend', min: 500000, max: 999999 },
    { name: 'Mythic', min: 1000000, max: 1000000 }
  ];

  for (const rank of rankThresholds) {
    if (this.score >= rank.min) {
      this.rank = rank.name;
    } else {
      break;
    }
  }

  return this;
};

// Helper method to get next rank information
userSchema.methods.getNextRankInfo = function () {
  const rankThresholds = [
    { name: 'Rookie', next: 'Bronze', threshold: 1000, color: '#9ca3af', icon: '🌱' },
    { name: 'Bronze', next: 'Silver', threshold: 5000, color: '#b45309', icon: '🥉' },
    { name: 'Silver', next: 'Gold', threshold: 10000, color: '#9ca3af', icon: '🥈' },
    { name: 'Gold', next: 'Platinum', threshold: 25000, color: '#fbbf24', icon: '🥇' },
    { name: 'Platinum', next: 'Diamond', threshold: 50000, color: '#6ee7b7', icon: '💎' },
    { name: 'Diamond', next: 'Master', threshold: 100000, color: '#34d399', icon: '🔷' },
    { name: 'Master', next: 'Grandmaster', threshold: 250000, color: '#8b5cf6', icon: '👑' },
    { name: 'Grandmaster', next: 'Legend', threshold: 500000, color: '#ec4899', icon: '⚡' },
    { name: 'Legend', next: 'Mythic', threshold: 1000000, color: '#f59e0b', icon: '🔥' },
    { name: 'Mythic', next: null, threshold: null, color: '#f97316', icon: '🌟' }
  ];

  const currentRankIndex = rankThresholds.findIndex(r => r.name === this.rank);
  return rankThresholds[currentRankIndex] || rankThresholds[0];
};

// Calculate progress to next rank
userSchema.methods.getRankProgress = function () {
  const rankThresholds = [
    { min: 0, max: 999 },
    { min: 1000, max: 4999 },
    { min: 5000, max: 9999 },
    { min: 10000, max: 24999 },
    { min: 25000, max: 49999 },
    { min: 50000, max: 99999 },
    { min: 100000, max: 249999 },
    { min: 250000, max: 499999 },
    { min: 500000, max: 999999 },
    { min: 1000000, max: 1000000 }
  ];

  const rankIndex = ['Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Legend', 'Mythic']
    .indexOf(this.rank);

  if (rankIndex === -1) return 0;

  const current = rankThresholds[rankIndex];

  // For Mythic rank (max)
  if (this.rank === 'Mythic') {
    return 100;
  }

  const nextThreshold = rankThresholds[rankIndex + 1]?.min || current.max;
  const progress = ((this.score - current.min) / (nextThreshold - current.min)) * 100;

  return Math.min(100, Math.max(0, progress));
};

// ========== PRIVACY CHECK METHODS ==========
userSchema.methods.canViewProfile = function (viewer) {
  if (!viewer) return this.privacySettings.profileVisibility === 'public';

  const visibility = this.privacySettings.profileVisibility;

  if (viewer._id.toString() === this._id.toString()) return true;
  if (visibility === 'public') return true;
  if (visibility === 'private') return false;
  if (visibility === 'followers_only') {
    return this.followers.includes(viewer._id);
  }

  return false;
};

userSchema.methods.canMessageUser = function (sender) {
  if (!sender) return false;

  const messageSetting = this.privacySettings.allowMessagesFrom;

  if (messageSetting === 'everyone') return true;
  if (messageSetting === 'nobody') return false;
  if (messageSetting === 'followers_only') {
    return this.followers.includes(sender._id);
  }

  return false;
};

// ========== STATIC METHODS ==========
userSchema.statics.emailExists = async function (email) {
  const user = await this.findOne({ email });
  return !!user;
};

userSchema.statics.usernameExists = async function (username) {
  const user = await this.findOne({ username });
  return !!user;
};

userSchema.statics.search = async function (query, currentUserId, limit = 20) {
  const regex = new RegExp(query, 'i');

  return await this.find({
    $and: [
      {
        $or: [
          { username: regex },
          { name: regex },
          { email: regex }
        ]
      },
      { _id: { $ne: currentUserId } },
      { isActive: true }
    ]
  })
    .select('username name profilePicture bio followers rank score lastSeen')
    .limit(limit)
    .lean();
};

userSchema.statics.getSuggestions = async function (userId, limit = 5) {
  const user = await this.findById(userId).select('following');

  if (!user) return [];

  const following = user.following || [];

  return await this.find({
    _id: {
      $nin: [...following, userId]
    },
    isActive: true
  })
    .select('username name profilePicture bio followers rank score lastSeen')
    .sort({ score: -1, followers: -1 })
    .limit(limit)
    .lean();
};

// ========== NEW: Clean up stale push subscriptions ==========
userSchema.statics.cleanupStaleSubscriptions = async function (daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await this.updateMany(
    {},
    {
      $pull: {
        pushSubscriptions: {
          lastUsed: { $lt: cutoffDate }
        }
      }
    }
  );

  console.log(`🧹 Cleaned up stale push subscriptions: ${result.modifiedCount} users affected`);
  return result;
};

// ========== EXPORT ==========
const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;