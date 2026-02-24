const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 1000,
    trim: true
  },
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  likesCount: {
    type: Number,
    default: 0
  },
  repliesCount: {
    type: Number,
    default: 0
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  isHidden: {
    type: Boolean,
    default: false
  },
  media: [{
    url: String,
    publicId: String,
    mediaType: {
      type: String,
      enum: ['image', 'video']
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for replies
commentSchema.virtual('replies', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'parentComment'
});

// Indexes
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1 });
// In backend/models/Comment.js



// ========== INDEXES FOR PERFORMANCE ==========
commentSchema.index({ post: 1, createdAt: -1 }); // For post comments
commentSchema.index({ author: 1, createdAt: -1 }); // For user comments
commentSchema.index({ parentComment: 1, createdAt: -1 }); // For replies
commentSchema.index({ likes: 1 }); // For liked comments
commentSchema.index({ isHidden: 1, createdAt: -1 }); // For moderation
commentSchema.index({ post: 1, parentComment: { $exists: true }, createdAt: -1 }); // For replies count

module.exports = mongoose.model('Comment', commentSchema);
// ========== PRE-SAVE MIDDLEWARE ==========
commentSchema.pre('save', function () {
  if (this.isModified('content') && !this.isNew) {
    this.isEdited = true;
    this.editedAt = new Date();
  }

  if (this.isModified('likes')) {
    this.likesCount = this.likes.length;
  }
});

// ========== LIKE METHODS ==========
commentSchema.methods.addLike = async function (userId) {
  if (!userId) return this;

  const userIdStr = userId.toString();
  const exists = this.likes.some(id => id.toString() === userIdStr);

  if (!exists) {
    const updated = await this.constructor.findByIdAndUpdate(
      this._id,
      {
        $addToSet: { likes: userId },
        $set: { likesCount: this.likes.length + 1 }
      },
      {
        new: true,
        runValidators: true
      }
    ).populate('author', 'username profilePicture rank');

    return updated || this;
  }

  return this;
};

commentSchema.methods.removeLike = async function (userId) {
  if (!userId) return this;

  const userIdStr = userId.toString();
  const exists = this.likes.some(id => id.toString() === userIdStr);

  if (exists) {
    const updated = await this.constructor.findByIdAndUpdate(
      this._id,
      {
        $pull: { likes: userId },
        $inc: { likesCount: -1 }
      },
      {
        new: true,
        runValidators: true
      }
    ).populate('author', 'username profilePicture rank');

    return updated || this;
  }

  return this;
};

commentSchema.methods.isLikedBy = function (userId) {
  if (!userId) return false;
  return this.likes.some(id => id.toString() === userId.toString());
};

// ========== POST-SAVE MIDDLEWARE ==========
commentSchema.post('save', async function (doc) {
  if (doc.parentComment) {
    try {
      await mongoose.model('Comment').findByIdAndUpdate(
        doc.parentComment,
        { $inc: { repliesCount: 1 } }
      );
    } catch (error) {
      console.error('Error updating parent repliesCount:', error);
    }
  }
});

commentSchema.post('remove', async function (doc) {
  if (doc.parentComment) {
    try {
      await mongoose.model('Comment').findByIdAndUpdate(
        doc.parentComment,
        { $inc: { repliesCount: -1 } }
      );
    } catch (error) {
      console.error('Error updating parent repliesCount:', error);
    }
  }
});

// ========== STATIC METHODS ==========
// ========== STATIC METHODS ==========
commentSchema.statics.getByPostOptimized = async function (postId, page = 1, limit = 20, includeReplies = false) {
  const skip = (page - 1) * limit;

  // Get top-level comments (no parent)
  const topComments = await this.find({
    post: postId,
    parentComment: null,
    isHidden: false
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture rank')
    .lean();

  // If we need to include replies
  if (includeReplies && topComments.length > 0) {
    const topCommentIds = topComments.map(c => c._id.toString());

    // Fetch ALL comments for this post
    const allComments = await this.find({
      post: postId,
      isHidden: false
    })
      .sort({ createdAt: 1 })
      .populate('author', 'username profilePicture rank')
      .lean();

    // Create a map of comments by ID
    const commentMap = {};
    allComments.forEach(comment => {
      comment.replies = [];
      commentMap[comment._id.toString()] = comment;
    });

    // Build the reply tree
    allComments.forEach(comment => {
      if (comment.parentComment) {
        const parentId = comment.parentComment.toString();
        if (commentMap[parentId]) {
          commentMap[parentId].replies.push(comment);
        }
      }
    });

    // Attach replies to top comments
    topComments.forEach(comment => {
      const commentId = comment._id.toString();
      if (commentMap[commentId]) {
        comment.replies = commentMap[commentId].replies || [];
      } else {
        comment.replies = [];
      }
    });
  }

  // Get total count for pagination
  const total = await this.countDocuments({
    post: postId,
    parentComment: null,
    isHidden: false
  });

  return {
    comments: topComments,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
};

// ========== STATIC METHODS ==========
commentSchema.statics.deleteWithReplies = async function (commentId) {
  const Comment = this;

  try {
    // Function to recursively get all reply IDs
    const getAllReplyIds = async (id) => {
      const replies = await Comment.find({ parentComment: id }).select('_id');
      let ids = replies.map(r => r._id.toString());

      for (const reply of replies) {
        const nestedIds = await getAllReplyIds(reply._id);
        ids = [...ids, ...nestedIds];
      }

      return ids;
    };

    // Get all reply IDs
    const replyIds = await getAllReplyIds(commentId);

    // Include the original comment
    const allIds = [commentId, ...replyIds];

    // Delete all comments
    const result = await Comment.deleteMany({ _id: { $in: allIds } });

    // Update parent comment's repliesCount if this was a reply
    const comment = await Comment.findById(commentId);
    if (comment?.parentComment) {
      await Comment.findByIdAndUpdate(
        comment.parentComment,
        { $inc: { repliesCount: -1 } }
      );
    }

    return result;
  } catch (error) {
    console.error('Error in deleteWithReplies:', error);
    throw error;
  }
};

// ========== VALIDATION ==========
commentSchema.pre('validate', function () {
  if (this.media && this.media.length > 0) {
    this.media = this.media.filter(m => m.url && m.url.trim().length > 0);
  }
});

module.exports = mongoose.models.Comment || mongoose.model('Comment', commentSchema);