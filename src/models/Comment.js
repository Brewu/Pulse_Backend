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

// ========== PRE-SAVE MIDDLEWARE ==========
commentSchema.pre('save', function() {
  if (this.isModified('content') && !this.isNew) {
    this.isEdited = true;
    this.editedAt = new Date();
  }
  
  if (this.isModified('likes')) {
    this.likesCount = this.likes.length;
  }
});

// ========== LIKE METHODS ==========
commentSchema.methods.addLike = async function(userId) {
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

commentSchema.methods.removeLike = async function(userId) {
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

commentSchema.methods.isLikedBy = function(userId) {
  if (!userId) return false;
  return this.likes.some(id => id.toString() === userId.toString());
};

// ========== POST-SAVE MIDDLEWARE ==========
commentSchema.post('save', async function(doc) {
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

commentSchema.post('remove', async function(doc) {
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
commentSchema.statics.getByPostOptimized = async function(postId, page = 1, limit = 20, includeReplies = false) {
  const skip = (page - 1) * limit;

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

  const commentMap = {};
  allComments.forEach(comment => {
    comment.replies = [];
    commentMap[comment._id.toString()] = comment;
  });

  // Build tree
  allComments.forEach(comment => {
    if (comment.parentComment) {
      const parent = commentMap[comment.parentComment.toString()];
      if (parent) {
        parent.replies.push(comment);
      }
    }
  });

  // Attach full nested replies only to the paginated top comments
  topComments.forEach(comment => {
    const fullComment = commentMap[comment._id.toString()];
    comment.replies = fullComment?.replies || [];
  });
}

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

commentSchema.statics.deleteWithReplies = async function(commentId) {
  const Comment = this;

  const getAllNestedIds = async (id) => {
    const children = await Comment.find({ parentComment: id }, '_id');
    let ids = children.map(c => c._id.toString());
    
    for (const child of children) {
      const nestedIds = await getAllNestedIds(child._id);
      ids = ids.concat(nestedIds);
    }
    
    return ids;
  };

  try {
    const nestedIds = await getAllNestedIds(commentId);
    const allIds = [commentId, ...nestedIds];

    await Comment.deleteMany({ _id: { $in: allIds } });

    const comment = await Comment.findById(commentId);
    if (comment?.parentComment) {
      await Comment.findByIdAndUpdate(
        comment.parentComment,
        { $inc: { repliesCount: -1 } }
      );
    }

    return { deletedCount: allIds.length };
  } catch (error) {
    console.error('Error deleting comment with replies:', error);
    throw error;
  }
};

// ========== VALIDATION ==========
commentSchema.pre('validate', function() {
  if (this.media && this.media.length > 0) {
    this.media = this.media.filter(m => m.url && m.url.trim().length > 0);
  }
});

module.exports = mongoose.models.Comment || mongoose.model('Comment', commentSchema);