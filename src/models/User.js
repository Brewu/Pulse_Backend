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
  
  // Notification preferences
  notificationPreferences: {
    type: {
      new_message: { type: Boolean, default: true },
      message_reaction: { type: Boolean, default: true },
      message_reply: { type: Boolean, default: true },
      new_follower: { type: Boolean, default: true },
      post_like: { type: Boolean, default: true },
      post_comment: { type: Boolean, default: true },
      comment_reply: { type: Boolean, default: true },
      mention: { type: Boolean, default: true },
      friend_request: { type: Boolean, default: true },
      friend_request_accepted: { type: Boolean, default: true },
      event_invitation: { type: Boolean, default: true },
      group_invitation: { type: Boolean, default: true },
      system: { type: Boolean, default: true }
    },
    default: {}
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
  }
  
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.__v;
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

// ========== VIRTUALS ==========
userSchema.virtual('followerCount').get(function() {
  return this.followers ? this.followers.length : 0;
});

userSchema.virtual('followingCount').get(function() {
  return this.following ? this.following.length : 0;
});

// ========== PRE-SAVE MIDDLEWARE ==========
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ========== PRE-REMOVE MIDDLEWARE ==========
userSchema.pre('remove', async function() {
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
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.getPublicProfile = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.__v;
  delete userObject.privacySettings;
  delete userObject.notificationPreferences;
  return userObject;
};

// UPDATED: Score update method with 10 ranks
userSchema.methods.updateScore = function(action) {
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

// NEW: Helper method to get next rank information
userSchema.methods.getNextRankInfo = function() {
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

// NEW: Calculate progress to next rank
userSchema.methods.getRankProgress = function() {
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
userSchema.methods.canViewProfile = function(viewer) {
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

userSchema.methods.canMessageUser = function(sender) {
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
userSchema.statics.emailExists = async function(email) {
  const user = await this.findOne({ email });
  return !!user;
};

userSchema.statics.usernameExists = async function(username) {
  const user = await this.findOne({ username });
  return !!user;
};

userSchema.statics.search = async function(query, currentUserId, limit = 20) {
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
  .select('username name profilePicture bio followers rank score')
  .limit(limit)
  .lean();
};

userSchema.statics.getSuggestions = async function(userId, limit = 5) {
  const user = await this.findById(userId).select('following');
  
  if (!user) return [];
  
  const following = user.following || [];
  
  return await this.find({
    _id: { 
      $nin: [...following, userId] 
    },
    isActive: true
  })
  .select('username name profilePicture bio followers rank score')
  .sort({ score: -1, followers: -1 })
  .limit(limit)
  .lean();
};

// ========== EXPORT ==========
const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;