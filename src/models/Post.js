const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const postSchema = new mongoose.Schema({
  // Reference to the author
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Post author is required'],
    index: true
  },

  // Content
  content: {
    type: String,
    required: [false, 'Post content is required'],
    maxlength: [5000, 'Post content cannot exceed 5000 characters'],
    trim: true
  },

  // Media attachments
  media: [{
    url: {
      type: String,
      required: true
    },
    mediaType: {
      type: String,
      enum: ['image', 'video', 'gif'],
      default: 'image'
    },
    edits: {
      brightness: Number,
      contrast: Number,
      saturation: Number,
      filter: String,
      rotation: Number,
      crop: {
        x: Number,
        y: Number,
        width: Number,
        height: Number
      }
    },
    thumbnail: String,
    altText: String
  }],

  // Visibility settings
  visibility: {
    type: String,
    enum: ['public', 'private', 'followers'],
    default: 'public'
  },

  // Categories/Tags
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }],

  // Engagement metrics
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  likesCount: {
    type: Number,
    default: 0,
    min: 0
  },

  comments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],

  commentsCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // View tracking
  views: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    }
  }],

  viewsCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Post metrics
  engagementScore: {
    type: Number,
    default: 0,
    min: 0
  },

  // Location data
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    },
    name: String
  },


  // Link preview
  linkPreview: {
    url: String,
    title: String,
    description: String,
    image: String,
    siteName: String
  },

  // Polls
  poll: {
    question: {
      type: String,
      maxlength: [200, 'Poll question cannot exceed 200 characters']
    },
    options: [{
      text: {
        type: String,
        required: true,
        maxlength: [100, 'Poll option cannot exceed 100 characters']
      },
      votes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }],
      votesCount: {
        type: Number,
        default: 0
      }
    }],
    endsAt: Date,
    isMultiChoice: {
      type: Boolean,
      default: false
    },
    totalVotes: {
      type: Number,
      default: 0
    }
  },

  // Content warnings
  hasContentWarning: {
    type: Boolean,
    default: false
  },

  contentWarning: {
    type: String,
    maxlength: [200, 'Content warning cannot exceed 200 characters']
  },

  // Moderation flags
  isEdited: {
    type: Boolean,
    default: false
  },

  editedAt: Date,

  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }],

  isHidden: {
    type: Boolean,
    default: false
  },

  isPinned: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ========== VIRTUALS ==========
postSchema.virtual('engagementRate').get(function () {
  if (this.viewsCount === 0) return 0;
  const rate = ((this.likesCount + this.commentsCount * 2) / this.viewsCount) * 100;
  return Math.min(rate, 100).toFixed(2);
});

postSchema.virtual('readTime').get(function () {
  const words = this.content.split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return `${minutes} min read`;
});

postSchema.virtual('popularityScore').get(function () {
  const ageInHours = (Date.now() - this.createdAt) / (1000 * 60 * 60);
  const engagement = this.likesCount * 1 + this.commentsCount * 2;
  const timeWeight = Math.max(1, 24 - ageInHours) / 24;
  return Math.round(engagement * timeWeight);
});

// ========== INDEXES ==========
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ likesCount: -1 });
postSchema.index({ commentsCount: -1 });
postSchema.index({ 'location.coordinates': '2dsphere' });
postSchema.index({ tags: 1 });
postSchema.index({ visibility: 1 });
postSchema.index({ engagementScore: -1 });
postSchema.index({ 'poll.endsAt': 1 });
postSchema.index({ content: 'text', tags: 'text' });
// In your Post model - add these indexes
postSchema.index({ author: 1, createdAt: -1 }); // For user posts
postSchema.index({ visibility: 1, createdAt: -1 }); // For public feed
postSchema.index({ 'media.mediaType': 1 }); // For video/reels queries
postSchema.index({ tags: 1 }); // For hashtag searches
postSchema.index({ createdAt: -1 }); // For general sorting
// ========== MIDDLEWARE - NO NEXT() ==========
// ✅ FIXED: No next() parameter
postSchema.pre('save', async function () {
  console.log('Post pre-save middleware running...');

  // Update engagement score
  this.engagementScore = (
    this.likesCount * 1 +
    this.commentsCount * 2 +
    this.viewsCount * 0.1
  );

  // Update timestamps
  this.updatedAt = new Date();

  // Extract hashtags from content
  const hashtagRegex = /#(\w+[a-zA-Z0-9_]*)/g;
  const matches = this.content.match(hashtagRegex) || [];
  const extractedTags = matches
    .map(tag => tag.slice(1).toLowerCase().trim())
    .filter(tag => tag.length > 0);

  // Merge with existing tags (dedupe)
  this.tags = Array.from(new Set([...this.tags, ...extractedTags]));

  // If post is edited, update edit history
  if (this.isModified('content') && !this.isNew) {
    console.log('Post content was modified, updating edit history...');
    this.isEdited = true;
    this.editedAt = new Date();

    if (this.editHistory.length >= 5) {
      this.editHistory.shift();
    }
    this.editHistory.push({
      content: this.content,
      editedAt: new Date()
    });
  }

  console.log('Pre-save middleware completed');
});

// ✅ FIXED: No next() parameter
postSchema.pre('remove', async function () {
  console.log('Post pre-remove middleware running...');

  try {
    // Update user's post count
    await mongoose.model('User').updateOne(
      { _id: this.author },
      { $inc: { postsCount: -1 } }
    );

    // Remove all associated comments
    await mongoose.model('Comment').deleteMany({ post: this._id });

    console.log('Post removal cleanup completed');
  } catch (error) {
    console.error('Error in pre-remove middleware:', error);
    throw error;
  }
});

// ========== METHODS ==========
postSchema.methods.addLike = async function (userId) {
  if (!this.likes.includes(userId)) {
    this.likes.push(userId);
    this.likesCount += 1;

    await mongoose.model('User').updateOne(
      { _id: this.author },
      { $inc: { likesReceived: 1 } }
    );

    return await this.save();
  }
  return this;
};

postSchema.methods.removeLike = async function (userId) {
  const index = this.likes.indexOf(userId);
  if (index > -1) {
    this.likes.splice(index, 1);
    this.likesCount = Math.max(0, this.likesCount - 1);

    await mongoose.model('User').updateOne(
      { _id: this.author },
      { $inc: { likesReceived: -1 } }
    );

    return await this.save();
  }
  return this;
};

postSchema.methods.addView = async function (userId) {
  // Don't count author's own views
  if (this.author.toString() === userId.toString()) {
    return;
  }

  // Check if user already viewed in last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingView = this.views?.find(v =>
    v.user.toString() === userId.toString() &&
    v.viewedAt > oneDayAgo
  );

  if (!existingView) {
    // Add new view
    this.views = this.views || [];
    this.views.push({ user: userId, viewedAt: new Date() });
    this.viewsCount = this.views.length;
    await this.save();
  }
};
postSchema.virtual('uniqueViewers').get(function () {
  if (!this.views) return 0;
  const uniqueUsers = new Set(this.views.map(v => v.user.toString()));
  return uniqueUsers.size;
});

postSchema.methods.voteOnPoll = async function (userId, optionIndex) {
  if (!this.poll || !this.poll.options[optionIndex]) {
    throw new Error('Invalid poll option');
  }

  if (this.poll.endsAt && new Date() > this.poll.endsAt) {
    throw new Error('Poll has ended');
  }

  const option = this.poll.options[optionIndex];

  if (!this.poll.isMultiChoice) {
    const hasVoted = this.poll.options.some(opt =>
      opt.votes.includes(userId)
    );

    if (hasVoted) {
      throw new Error('You have already voted on this poll');
    }
  }

  option.votes.push(userId);
  option.votesCount += 1;
  this.poll.totalVotes += 1;

  return await this.save();
};

// ========== STATIC METHODS ==========



postSchema.statics.getTrending = async function (limit = 10) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return await this.find({
    createdAt: { $gte: oneWeekAgo },
    visibility: 'public',
    isHidden: false
  })
    .sort({ popularityScore: -1 })
    .limit(limit)
    .populate('author', 'username profilePicture rank')
    .lean();
};

postSchema.statics.getByTag = async function (tag, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return await this.find({
    tags: tag.toLowerCase(),
    visibility: 'public',
    isHidden: false
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture rank')
    .lean();
};

postSchema.statics.getUserPosts = async function (userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return await this.find({
    author: userId,
    isHidden: false
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture rank')
    .lean();
};

postSchema.statics.search = async function (query, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return await this.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture rank')
    .lean();
};

// ========== EXPORT ==========
const Post = mongoose.models.Post || mongoose.model('Post', postSchema);
module.exports = Post;