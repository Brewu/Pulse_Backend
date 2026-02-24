const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const { body, param, query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../utils/cloudinary');
const NotificationMiddleware = require('../middleware/NotificationMiddleware'); // ADDED
// ========== PUSH NOTIFICATION HELPER ==========
const sendPushNotification = async (userId, notificationData) => {
  try {
    // Don't send if no userId
    if (!userId) return;

    const pushService = require('../services/pushNotificationService');
    await pushService.sendToUser(userId, notificationData);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};
// ========== SAFE MODEL IMPORTS ==========
let Comment, Post, User;

try {
  Comment = mongoose.model('Comment');
} catch {
  Comment = require('../models/Comment');
}

try {
  Post = mongoose.model('Post');
} catch {
  Post = require('../models/Post');
}

try {
  User = mongoose.model('User');
} catch {
  User = require('../models/User');
}

// ========== MULTER CONFIG ==========
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'comments',
    allowed_formats: ['jpg', 'png', 'gif', 'webp'],
    resource_type: 'image'
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ========== ASYNC HANDLER ==========
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ========== MIDDLEWARE ==========

/**
 * Check if comment exists and user has access
 */
const checkCommentAccess = asyncHandler(async (req, res, next) => {
  const comment = await Comment.findById(req.params.commentId)
    .populate('author', 'username profilePicture rank');

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: 'Comment not found'
    });
  }

  // Check if comment is hidden
  if (comment.isHidden) {
    return res.status(403).json({
      success: false,
      message: 'This comment has been hidden'
    });
  }

  req.comment = comment;
  next();
});

/**
 * Check if user owns the comment (for edit/delete)
 */
const checkCommentOwnership = asyncHandler(async (req, res, next) => {
  if (req.comment.author._id.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to modify this comment'
    });
  }
  next();
});

// ========== PUBLIC ROUTES ==========

/**
 * @route   GET /api/comments/post/:postId
 * @desc    Get comments for a post (with pagination)
 * @access  Public
 */
router.get('/post/:postId', [
  param('postId').isMongoId().withMessage('Invalid post ID'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('includeReplies').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { postId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const includeReplies = req.query.includeReplies === 'true';

  const result = await Comment.getByPostOptimized(postId, page, limit, includeReplies);

  // Add isLiked flag for authenticated users
  const addIsLikedRecursively = (comments, userId) => {
    return comments.map(comment => {
      const updated = {
        ...comment,
        isLiked: comment.likes?.some(id => id.toString() === userId) || false
      };

      if (comment.replies?.length) {
        updated.replies = addIsLikedRecursively(comment.replies, userId);
      }

      return updated;
    });
  };

  if (req.user) {
    result.comments = addIsLikedRecursively(result.comments, req.user.id);
  }

  res.json({
    success: true,
    data: result.comments,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasMore: result.page < result.totalPages
    }
  });
}));

/**
 * @route   GET /api/comments/:commentId/replies
 * @desc    Get replies for a specific comment
 * @access  Public
 */
router.get('/:commentId/replies', [
  param('commentId').isMongoId().withMessage('Invalid comment ID'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { commentId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const [replies, total] = await Promise.all([
    Comment.find({
      parentComment: commentId,
      isHidden: false
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username profilePicture rank')
      .lean(),
    Comment.countDocuments({
      parentComment: commentId,
      isHidden: false
    })
  ]);

  // Add isLiked flag for authenticated users
  if (req.user) {
    replies.forEach(reply => {
      reply.isLiked = reply.likes?.some(id => id.toString() === req.user.id) || false;
    });
  }

  res.json({
    success: true,
    data: replies,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + replies.length < total
    }
  });
}));

// ========== PROTECTED ROUTES ==========

/**
 * @route   POST /api/comments/post/:postId
 * @desc    Create a new comment on a post
 * @access  Private
 */
/**
 * @route   POST /api/comments/post/:postId
 * @desc    Create a new comment on a post
 * @access  Private
 */
router.post('/post/:postId',
  protect,
  upload.array('media', 5),
  [
    param('postId').isMongoId().withMessage('Invalid post ID'),
    body('content')
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage('Comment must be between 1 and 1000 characters'),
    body('parentComment').optional().isMongoId().withMessage('Invalid parent comment ID')
  ],
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { postId } = req.params;
    const { content, parentComment } = req.body;

    // Verify post exists
    const post = await Post.findById(postId).populate('author', 'username profilePicture');
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Verify parent comment exists if provided
    if (parentComment) {
      const parent = await Comment.findById(parentComment).populate('author', 'username profilePicture');

      if (!parent || parent.post.toString() !== postId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid parent comment'
        });
      }
      req.parentComment = parent; // Store for notification middleware
    }

    // Process media
    const media = (req.files || []).map(f => ({
      url: f.path,
      publicId: f.filename,
      mediaType: f.mimetype.startsWith('video/') ? 'video' : 'image'
    }));

    // Create comment
    const comment = await Comment.create({
      post: postId,
      author: req.user.id,
      content: content.trim(),
      parentComment: parentComment || null,
      media
    });

    // Update counts
    await Promise.all([
      Post.findByIdAndUpdate(postId, {
        $inc: { commentsCount: 1 }
      }),
      User.findByIdAndUpdate(req.user.id, {
        $inc: {
          commentsCount: 1,
          score: 5
        }
      })
    ]);

    // Populate author
    await comment.populate('author', 'username profilePicture rank');

    // Attach to request for notification middleware
    req.post = post;
    req.comment = comment;

    res.status(201).json({
      success: true,
      data: {
        ...comment.toObject(),
        isLiked: false,
        replies: [],
        repliesCount: 0
      }
    });

    // 🔔 Send push notifications based on comment type
    setImmediate(async () => {
      try {
        // If it's a reply to another comment
        if (parentComment && req.parentComment) {
          // Notify the parent comment author (if not the same user)
          if (req.parentComment.author._id.toString() !== req.user.id) {
            const replyNotification = {
              title: '↩️ New Reply',
              body: `${req.user.username} replied to your comment: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
              type: 'reply',
              icon: '/icons/reply-icon.png',
              badge: '/badge-reply.png',
              data: {
                url: `/posts/${postId}?comment=${comment._id}`,
                postId: postId,
                commentId: comment._id,
                parentCommentId: parentComment,
                senderId: req.user.id,
                senderUsername: req.user.username,
                senderProfilePicture: req.user.profilePicture,
                replyContent: content.substring(0, 200),
                timestamp: new Date().toISOString()
              }
            };
            await sendPushNotification(req.parentComment.author._id, replyNotification);
          }
        }
        // If it's a top-level comment on a post
        else {
          // Notify the post author (if not the same user)
          if (post.author._id.toString() !== req.user.id) {
            const commentNotification = {
              title: '💬 New Comment',
              body: `${req.user.username} commented on your post: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
              type: 'comment',
              icon: '/icons/comment-icon.png',
              badge: '/badge-comment.png',
              data: {
                url: `/posts/${postId}?comment=${comment._id}`,
                postId: postId,
                commentId: comment._id,
                senderId: req.user.id,
                senderUsername: req.user.username,
                senderProfilePicture: req.user.profilePicture,
                commentContent: content.substring(0, 200),
                postContent: post.content?.substring(0, 100),
                timestamp: new Date().toISOString()
              }
            };
            await sendPushNotification(post.author._id, commentNotification);
          }
        }

        // Check for mentions in the comment content
        const mentionRegex = /@(\w+)/g;
        const mentions = content.match(mentionRegex);

        if (mentions) {
          const usernames = mentions.map(m => m.substring(1));
          const mentionedUsers = await User.find({
            username: { $in: usernames },
            _id: { $ne: req.user.id } // Exclude self
          }).select('_id username');

          for (const mentionedUser of mentionedUsers) {
            const mentionNotification = {
              title: '@ Mention',
              body: `${req.user.username} mentioned you in a comment: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
              type: 'mention',
              icon: '/icons/mention-icon.png',
              badge: '/badge-mention.png',
              data: {
                url: `/posts/${postId}?comment=${comment._id}`,
                postId: postId,
                commentId: comment._id,
                senderId: req.user.id,
                senderUsername: req.user.username,
                mentionedUsername: mentionedUser.username,
                mentionContext: content.substring(0, 200),
                timestamp: new Date().toISOString()
              }
            };
            await sendPushNotification(mentionedUser._id, mentionNotification);
          }
        }
      } catch (pushError) {
        console.error('Error sending push notifications:', pushError);
      }

      // Fire original notification middleware
      if (parentComment) {
        NotificationMiddleware.afterReply(req, res, next);
      } else {
        NotificationMiddleware.afterComment(req, res, next);
      }
    });
  }));

/**
 * @route   PUT /api/comments/:commentId
 * @desc    Edit a comment
 * @access  Private (Owner only)
 */
router.put('/:commentId',
  protect,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID'),
    body('content')
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage('Comment must be between 1 and 1000 characters')
  ],
  checkCommentAccess,
  checkCommentOwnership,
  asyncHandler(async (req, res) => {
    const { content } = req.body;

    req.comment.content = content.trim();
    req.comment.isEdited = true;
    req.comment.editedAt = new Date();
    await req.comment.save();

    res.json({
      success: true,
      data: req.comment
    });
  }));

/**
 * @route   DELETE /api/comments/:commentId
 * @desc    Delete a comment (and all its replies)
 * @access  Private (Owner only)
 */
router.delete('/:commentId',
  protect,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  checkCommentAccess,
  checkCommentOwnership,
  asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const comment = req.comment;

    // Delete comment and all replies
    const result = await Comment.deleteWithReplies(commentId);

    // Update counts
    await Promise.all([
      // Update post's comment count if this is a top-level comment
      !comment.parentComment && Post.findByIdAndUpdate(comment.post, {
        $inc: { commentsCount: -1 }
      }),
      // Update user's comment count
      User.findByIdAndUpdate(req.user.id, {
        $inc: { commentsCount: -1 }
      })
    ].filter(Boolean));

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      deletedCount: result.deletedCount
    });
  }));

/**
 * @route   POST /api/comments/:commentId/like
 * @desc    Like a comment
 * @access  Private
 */
/**
 * @route   POST /api/comments/:commentId/like
 * @desc    Like a comment
 * @access  Private
 */
router.post('/:commentId/like', protect,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  checkCommentAccess,
  asyncHandler(async (req, res) => {
    const comment = req.comment;

    // Check if already liked
    const isLiked = comment.likes?.some(id => id.toString() === req.user.id);

    if (isLiked) {
      return res.json({
        success: true,
        likesCount: comment.likesCount,
        isLiked: true
      });
    }

    // Add like and get updated comment
    const updatedComment = await comment.addLike(req.user.id);

    // Update user's likes received if not liking own comment
    if (comment.author._id.toString() !== req.user.id) {
      await User.findByIdAndUpdate(comment.author._id, {
        $inc: {
          likesReceived: 1,
          score: 1
        }
      });

      // 🔔 Send push notification for comment like (asynchronously)
      setImmediate(async () => {
        try {
          const likeNotification = {
            title: '❤️ Comment Like',
            body: `${req.user.username} liked your comment`,
            type: 'comment_like',
            icon: '/icons/like-icon.png',
            badge: '/badge-like.png',
            data: {
              url: `/posts/${comment.post}?comment=${comment._id}`,
              postId: comment.post,
              commentId: comment._id,
              senderId: req.user.id,
              senderUsername: req.user.username,
              senderProfilePicture: req.user.profilePicture,
              commentContent: comment.content?.substring(0, 100),
              timestamp: new Date().toISOString()
            }
          };

          const pushService = require('../services/pushNotificationService');
          await pushService.sendToUser(comment.author._id, likeNotification);
        } catch (pushError) {
          console.error('Error sending comment like push:', pushError);
        }
      });
    }

    res.json({
      success: true,
      likesCount: updatedComment.likesCount,
      isLiked: true
    });
  }));

/**
 * @route   POST /api/comments/:commentId/unlike
 * @desc    Unlike a comment
 * @access  Private
 */
router.post('/:commentId/unlike', protect,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  checkCommentAccess,
  asyncHandler(async (req, res) => {
    const comment = req.comment;

    // Check if already unliked
    const isLiked = comment.likes?.some(id => id.toString() === req.user.id);

    if (!isLiked) {
      return res.json({
        success: true,
        likesCount: comment.likesCount,
        isLiked: false
      });
    }

    // Remove like and get updated comment
    const updatedComment = await comment.removeLike(req.user.id);

    // Update user's likes received
    if (comment.author._id.toString() !== req.user.id) {
      await User.findByIdAndUpdate(comment.author._id, {
        $inc: {
          likesReceived: -1,
          score: -1
        }
      });
    }

    res.json({
      success: true,
      likesCount: updatedComment.likesCount,
      isLiked: false
    });
  }));

/**
 * @route   POST /api/comments/:commentId/hide
 * @desc    Hide a comment (moderator/admin only)
 * @access  Private (Admin/Mod)
 */
router.post('/:commentId/hide',
  protect,
  [
    param('commentId').isMongoId().withMessage('Invalid comment ID')
  ],
  checkCommentAccess,
  asyncHandler(async (req, res) => {
    // Check if user is admin or moderator
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to hide comments'
      });
    }

    req.comment.isHidden = true;
    req.comment.hiddenAt = new Date();
    req.comment.hiddenBy = req.user.id;
    await req.comment.save();

    res.json({
      success: true,
      message: 'Comment hidden successfully'
    });
  }));

// ========== ERROR HANDLING ==========
router.use((err, req, res, next) => {
  console.error('Comment Route Error:', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate entry'
    });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum is 5'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

module.exports = router;