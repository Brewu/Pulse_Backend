const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const { body, param, query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const NotificationMiddleware = require('../middleware/NotificationMiddleware');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../utils/cloudinary');

// ========== PUSH NOTIFICATION HELPER ==========
const sendPushNotification = async (userId, notificationData) => {
  try {
    if (!userId) return;
    const pushService = require('../services/pushNotificationService');
    await pushService.sendToUser(userId, notificationData);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};

// ========== SAFE MODEL IMPORTS ==========
let Post, User;

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

// ========== HELPERS ==========
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const toAbsoluteMedia = (req, media = []) => {
  if (!Array.isArray(media)) return [];
  return media.map(m => ({
    ...m,
    url: m.url?.startsWith('http') ? m.url : `${baseUrl(req)}/${m.url || ''}`
  }));
};

// ========== MULTER CONFIG ==========
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'posts',
    allowed_formats: ['jpg', 'png', 'gif', 'mp4', 'mov', 'webp'],
    resource_type: 'auto'
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ========== ASYNC HANDLER WRAPPER ==========
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ========== HEALTH CHECK ==========
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Posts API is operational',
    timestamp: new Date().toISOString(),
    models: {
      Post: !!Post,
      User: !!User
    },
    dbState: mongoose.connection.readyState
  });
});

// posts.js - Search routes
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 10, type, sort, timeRange } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const query = {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (type === 'image') {
      query['media.mediaType'] = 'image';
    } else if (type === 'video') {
      query['media.mediaType'] = 'video';
    } else if (type === 'post') {
      query.content = { $exists: true, $ne: '' };
    }

    if (timeRange !== 'all') {
      const now = new Date();
      const ranges = {
        today: new Date(now.setHours(0, 0, 0, 0)),
        week: new Date(now.setDate(now.getDate() - 7)),
        month: new Date(now.setMonth(now.getMonth() - 1)),
        year: new Date(now.setFullYear(now.getFullYear() - 1))
      };
      if (ranges[timeRange]) {
        query.createdAt = { $gte: ranges[timeRange] };
      }
    }

    let sortOptions = {};
    if (sort === 'recent') {
      sortOptions = { createdAt: -1 };
    } else if (sort === 'popular') {
      sortOptions = { likesCount: -1, commentsCount: -1 };
    } else if (sort === 'likes') {
      sortOptions = { likesCount: -1 };
    } else if (sort === 'comments') {
      sortOptions = { commentsCount: -1 };
    } else {
      sortOptions = { score: { $meta: 'textScore' } };
    }

    const posts = await Post.find(
      { $text: { $search: q }, ...query },
      { score: { $meta: 'textScore' } }
    )
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('author', 'username name profilePicture rank score');

    const total = await Post.countDocuments({ $text: { $search: q }, ...query });

    res.json({
      data: posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + posts.length < total
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/trending-tags', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trending = await Post.aggregate([
      { $match: { createdAt: { $gte: oneWeekAgo } } },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          engagement: { $sum: { $add: ['$likesCount', { $multiply: ['$commentsCount', 2] }] } }
        }
      },
      { $sort: { engagement: -1, count: -1 } },
      { $limit: 10 },
      {
        $project: {
          name: '$_id',
          count: 1,
          _id: 0
        }
      }
    ]);

    res.json({ data: trending });
  } catch (error) {
    console.error('Trending tags error:', error);
    res.status(500).json({ error: 'Failed to fetch trending tags' });
  }
});

// ========== PUBLIC ROUTES ==========

/**
 * @route   GET /api/posts/search
 * @desc    Search public posts
 * @access  Public
 */
router.get('/search', [
  query('q').isLength({ min: 2 }).withMessage('Search query must be at least 2 characters'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { q, page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;
  const searchRegex = new RegExp(q, 'i');

  const posts = await Post.find({
    visibility: 'public',
    isHidden: false,
    $or: [
      { content: searchRegex },
      { hashtags: { $in: [searchRegex] } }
    ]
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture')
    .lean();

  const total = await Post.countDocuments({
    visibility: 'public',
    isHidden: false,
    $or: [
      { content: searchRegex },
      { hashtags: { $in: [searchRegex] } }
    ]
  });

  const postsWithMedia = posts.map(p => ({
    ...p,
    media: toAbsoluteMedia(req, p.media),
    isLiked: req.user ? p.likes?.some(id => id.toString() === req.user._id.toString()) : false
  }));

  res.json({
    success: true,
    data: postsWithMedia,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total
    }
  });
}));

/**
 * @route   GET /api/posts/trending
 * @desc    Get trending posts
 * @access  Public
 */
router.get('/trending', asyncHandler(async (req, res) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const posts = await Post.find({
    visibility: 'public',
    isHidden: false,
    createdAt: { $gte: oneWeekAgo }
  })
    .sort({ likesCount: -1, commentsCount: -1 })
    .limit(10)
    .populate('author', 'username profilePicture')
    .lean();

  const postsWithMedia = posts.map(p => ({
    ...p,
    media: toAbsoluteMedia(req, p.media),
    isLiked: req.user ? p.likes?.some(id => id.toString() === req.user._id.toString()) : false
  }));

  res.json({ success: true, data: postsWithMedia });
}));

/**
 * @route   GET /api/posts/tag/:tag
 * @desc    Get posts by hashtag
 * @access  Public
 */
router.get('/tag/:tag', [
  param('tag').isString().trim().notEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const tag = req.params.tag.toLowerCase().trim();

  const posts = await Post.find({
    hashtags: tag,
    visibility: 'public',
    isHidden: false
  })
    .sort({ createdAt: -1 })
    .populate('author', 'username profilePicture')
    .lean();

  const postsWithMedia = posts.map(p => ({
    ...p,
    media: toAbsoluteMedia(req, p.media),
    isLiked: req.user ? p.likes?.some(id => id.toString() === req.user._id.toString()) : false
  }));

  res.json({ success: true, data: postsWithMedia });
}));

// ========== PROTECTED ROUTES ==========

/**
 * @route   GET /api/posts
 * @desc    Get authenticated user's feed
 * @access  Private
 */
// ========== PROTECTED ROUTES ==========

/**
 * @route   GET /api/posts
 * @desc    Get authenticated user's feed with feed type support
 * @query   page - Page number
 * @query   limit - Posts per page
 * @query   feedType - 'mixed', 'following', or 'public'
 * @access  Private
 */
router.get('/', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('following');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const following = user.following || [];
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  // Get feed type from query params (default to 'mixed')
  const { feedType = 'mixed' } = req.query;

  let query = { isHidden: false };
  let countQuery = { isHidden: false };

  // Apply feed type filters
  switch (feedType) {
    case 'following':
      // Only show posts from users the current user follows and their own posts
      query.author = { $in: [...following, req.user._id] };
      query.visibility = { $in: ['public', 'followers'] };
      countQuery = { ...query };
      break;

    case 'public':
      // Only show public posts from users they don't follow
      query.author = { $nin: [...following, req.user._id] };
      query.visibility = 'public';
      countQuery = { ...query };
      break;

    case 'mixed':
    default:
      // Mixed feed: posts from followed users + public posts
      query = {
        isHidden: false,
        $or: [
          { author: { $in: following }, visibility: { $in: ['public', 'followers'] } },
          { author: { $nin: [...following, req.user._id] }, visibility: 'public' },
          { author: req.user._id } // Include user's own posts
        ]
      };
      countQuery = {
        isHidden: false,
        $or: [
          { author: { $in: following }, visibility: { $in: ['public', 'followers'] } },
          { author: { $nin: [...following, req.user._id] }, visibility: 'public' },
          { author: req.user._id }
        ]
      };
      break;
  }

  // Get posts
  const posts = await Post.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture')
    .lean();

  // Get total count for pagination
  const total = await Post.countDocuments(countQuery);

  const postsWithMedia = posts.map(p => ({
    ...p,
    media: toAbsoluteMedia(req, p.media),
    isLiked: p.likes?.some(id => id.toString() === req.user._id.toString()) || false,
    source: getPostSource(p, req.user._id, following)
  }));

  res.json({
    success: true,
    data: postsWithMedia,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total
    }
  });
}));

// Helper function to determine post source
function getPostSource(post, userId, following) {
  if (post.author._id.toString() === userId.toString()) {
    return 'own';
  }
  if (following.includes(post.author._id.toString())) {
    return 'following';
  }
  return 'public';
}

/**
 * @route   GET /api/posts/user/:userId
 * @desc    Get user's posts (respects visibility)
 * @access  Public/Private
 */
router.get('/user/:userId', [
  param('userId').isMongoId().withMessage('Invalid user ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const targetUserId = req.params.userId;
  const isOwn = req.user?._id?.toString() === targetUserId;

  let visibilityFilter = { visibility: 'public' };

  if (isOwn) {
    visibilityFilter = {};
  } else if (req.user) {
    const viewer = await User.findById(req.user._id).select('following');
    if (viewer?.following?.some(id => id.toString() === targetUserId)) {
      visibilityFilter = { visibility: { $in: ['public', 'followers'] } };
    }
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const [posts, total] = await Promise.all([
    Post.find({
      author: targetUserId,
      isHidden: false,
      ...visibilityFilter
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username profilePicture')
      .lean(),
    Post.countDocuments({
      author: targetUserId,
      isHidden: false,
      ...visibilityFilter
    })
  ]);

  const postsWithMedia = posts.map(p => ({
    ...p,
    media: toAbsoluteMedia(req, p.media),
    isLiked: req.user ? p.likes?.some(id => id.toString() === req.user._id.toString()) : false
  }));

  res.json({
    success: true,
    data: postsWithMedia,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total
    }
  });
}));

/**
 * @route   POST /api/posts
 * @desc    Create a new post
 * @access  Private
 */
router.post(
  '/',
  protect,
  upload.array('media', 10),
  [
    body('content').optional().trim().isLength({ max: 5000 }).withMessage('Content cannot exceed 5000 characters'),
    body('visibility').optional().isIn(['public', 'followers', 'private']),
    body('hashtags').optional().isString(),
    body('mediaEdits').optional().isString()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Check if there's either content or media
    if (!req.body.content && (!req.files || req.files.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Post must have either content or media'
      });
    }

    let hashtags = [];
    if (req.body.hashtags) {
      hashtags = req.body.hashtags
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);
    }

    // Parse media edits if provided
    let mediaEdits = [];
    if (req.body.mediaEdits) {
      try {
        mediaEdits = JSON.parse(req.body.mediaEdits);
        console.log('Received media edits:', mediaEdits);
      } catch (e) {
        console.error('Failed to parse media edits:', e);
      }
    }

    // Process media files with their edits
    const media = (req.files || []).map((file, index) => {
      const mediaItem = {
        url: file.path,
        publicId: file.filename,
        mediaType: file.mimetype.startsWith('video/') ? 'video' : 'image',
        format: file.format,
        width: file.width,
        height: file.height
      };

      // Attach edits if available for this index
      if (mediaEdits[index]) {
        mediaItem.edits = mediaEdits[index];
      }

      return mediaItem;
    });

    const post = await Post.create({
      author: req.user._id,
      content: req.body.content ? req.body.content.trim() : '',
      visibility: req.body.visibility || 'public',
      hashtags,
      media,
      likesCount: 0,
      commentsCount: 0,
      viewsCount: 0
    });

    await post.populate('author', 'username profilePicture');

    console.log('Created post with media edits:', post.media.map(m => m.edits));

    // ========== 🔥 REAL-TIME UPDATE ==========
    // Emit to all connected clients
    if (req.io) {
      req.io.emit('post:new', {
        post,
        message: 'New post created'
      });
    }

    // ========== 🔔 NOTIFY FOLLOWERS ==========
    setImmediate(async () => {
      try {
        // Find users who follow this author
        const followers = await User.find({
          following: req.user._id,
          'notificationPreferences.types.post_created': { $ne: false }
        }).select('_id');

        console.log(`📢 Notifying ${followers.length} followers about new post`);

        // Send push notification to each follower
        for (const follower of followers) {
          const notificationData = {
            title: '📝 New Post',
            body: `${req.user.username} just posted: ${post.content?.substring(0, 50)}${post.content?.length > 50 ? '...' : ''}`,
            type: 'post_created',
            icon: '/icons/post-icon.png',
            badge: '/badge-post.png',
            data: {
              url: `/posts/${post._id}`,
              postId: post._id,
              authorId: req.user._id,
              authorUsername: req.user.username,
              authorProfilePicture: req.user.profilePicture,
              postPreview: post.content?.substring(0, 100),
              hasMedia: post.media?.length > 0,
              timestamp: new Date().toISOString()
            },
            actions: [
              {
                action: 'view',
                title: 'View Post'
              },
              {
                action: 'dismiss',
                title: 'Dismiss'
              }
            ]
          };

          // Send push notification
          sendPushNotification(follower._id, notificationData).catch(console.error);
        }
      } catch (error) {
        console.error('Error notifying followers:', error);
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...post.toObject(),
        media: toAbsoluteMedia(req, post.media),
        isLiked: false
      }
    });
  })
);

/**
 * @route   GET /api/posts/:id
 * @desc    Get single post (respects visibility)
 * @access  Public/Private
 */
router.get('/:id', [
  param('id').isMongoId().withMessage('Invalid post ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  let post = await Post.findById(req.params.id);
  if (!post || post.isHidden) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  // Visibility check
  const isPublic = post.visibility === 'public';
  let hasPermission = isPublic;

  if (!hasPermission && req.user) {
    const isOwn = post.author.toString() === req.user._id.toString();
    if (isOwn || post.visibility === 'private') {
      hasPermission = true;
    } else if (post.visibility === 'followers') {
      const viewer = await User.findById(req.user._id).select('following');
      if (viewer?.following?.some(id => id.toString() === post.author.toString())) {
        hasPermission = true;
      }
    }
  }

  if (!hasPermission) {
    return res.status(403).json({ success: false, message: 'Not authorized to view this post' });
  }

  // Increment view if authenticated
  if (req.user) {
    await post.addView(req.user._id);
  }

  post = await Post.findById(req.params.id)
    .populate('author', 'username profilePicture')
    .lean();

  const isLiked = req.user ? post.likes?.some(id => id.toString() === req.user._id.toString()) : false;

  res.json({
    success: true,
    data: {
      ...post,
      media: toAbsoluteMedia(req, post.media),
      isLiked
    }
  });
}));

/**
 * @route   PUT /api/posts/:id
 * @desc    Update post (owner only)
 * @access  Private
 */
router.put('/:id', protect, [
  param('id').isMongoId(),
  body('content').optional().trim().isLength({ min: 1, max: 5000 }),
  body('visibility').optional().isIn(['public', 'followers', 'private']),
  body('hashtags').optional().isString()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const post = await Post.findById(req.params.id);
  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  if (post.author.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (req.body.content !== undefined) post.content = req.body.content.trim();
  if (req.body.visibility) post.visibility = req.body.visibility;
  if (req.body.hashtags !== undefined) {
    post.hashtags = req.body.hashtags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t);
  }

  post.isEdited = true;
  post.editedAt = new Date();
  await post.save();
  await post.populate('author', 'username profilePicture');

  // 🔥 Emit post update
  if (req.io) {
    req.io.emit('post:updated', {
      postId: post._id,
      updates: {
        content: post.content,
        visibility: post.visibility,
        hashtags: post.hashtags,
        isEdited: post.isEdited,
        editedAt: post.editedAt
      }
    });
  }

  res.json({
    success: true,
    data: {
      ...post.toObject(),
      media: toAbsoluteMedia(req, post.media),
      isLiked: post.likes?.some(id => id.toString() === req.user._id.toString()) || false
    }
  });
}));

/**
 * @route   POST /api/posts/:id/like
 * @desc    Like a post
 * @access  Private
 */
router.post('/:id/like', protect,
  [
    param('id').isMongoId()
  ],
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const post = await Post.findById(req.params.id)
      .populate('author', 'username profilePicture');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Don't like if already liked
    if (post.likes?.some(id => id.toString() === req.user._id.toString())) {
      return res.json({
        success: true,
        likesCount: post.likesCount,
        isLiked: true
      });
    }

    // Attach post for middleware
    req.post = post;

    await post.addLike(req.user._id);

    // 🔥 Emit like update
    if (req.io) {
      req.io.emit('post:liked', {
        postId: post._id,
        userId: req.user._id,
        likesCount: post.likesCount,
        action: 'like'
      });
    }

    // 🔔 Send rich push notification to post author (if not self-like)
    if (post.author._id.toString() !== req.user._id.toString()) {
      const notificationData = {
        title: '❤️ New Like',
        body: `${req.user.username} liked your post`,
        type: 'like',
        icon: '/icons/like-icon.png',
        badge: '/badge-like.png',
        data: {
          url: `/posts/${post._id}`,
          postId: post._id,
          senderId: req.user._id,
          senderUsername: req.user.username,
          senderProfilePicture: req.user.profilePicture,
          postContent: post.content?.substring(0, 100),
          timestamp: new Date().toISOString()
        }
      };

      // Send push notification asynchronously
      sendPushNotification(post.author._id, notificationData).catch(console.error);
    }

    res.json({
      success: true,
      likesCount: post.likesCount,
      isLiked: true
    });

    // Notification middleware (fire-and-forget)
    setImmediate(() => {
      NotificationMiddleware.afterPostLike(req, res, next);
    });
  })
);

/**
 * @route   POST /api/posts/:id/unlike
 * @desc    Unlike a post
 * @access  Private
 */
router.post('/:id/unlike', protect, [
  param('id').isMongoId()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const post = await Post.findById(req.params.id);
  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  await post.removeLike(req.user._id);

  // 🔥 Emit unlike update
  if (req.io) {
    req.io.emit('post:liked', {
      postId: post._id,
      userId: req.user._id,
      likesCount: post.likesCount,
      action: 'unlike'
    });
  }

  res.json({
    success: true,
    likesCount: post.likesCount,
    isLiked: false
  });
}));

/**
 * @route   DELETE /api/posts/:id
 * @desc    Delete post (owner only)
 * @access  Private
 */
router.delete('/:id', protect, [
  param('id').isMongoId()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const post = await Post.findById(req.params.id);
  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  if (post.author.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  // Delete media from Cloudinary
  if (post.media?.length) {
    await Promise.allSettled(
      post.media.map(m => m.publicId && cloudinary.uploader.destroy(m.publicId, {
        resource_type: m.mediaType === 'video' ? 'video' : 'image'
      }))
    );
  }

  await post.deleteOne();

  // 🔥 Emit post deletion
  if (req.io) {
    req.io.emit('post:deleted', {
      postId: post._id,
      userId: req.user._id
    });
  }

  res.json({ success: true, message: 'Post deleted' });
}));

// ========== VIEW TRACKING ==========

/**
 * @route   POST /api/posts/:id/view
 * @desc    Track post view
 * @access  Private
 */
router.post('/:id/view', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Don't track views on own posts
    if (post.author.toString() === req.user.id) {
      return res.json({
        success: true,
        message: 'Own post view not tracked'
      });
    }

    // Check if user already viewed in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingView = post.views?.find(v =>
      v.user.toString() === req.user.id &&
      v.viewedAt > oneDayAgo
    );

    if (!existingView) {
      // Add new view
      post.views = post.views || [];
      post.views.push({
        user: req.user.id,
        viewedAt: new Date()
      });
      post.viewsCount = post.views.length;
      await post.save();

      // Update user's score (optional)
      await User.findByIdAndUpdate(post.author, {
        $inc: { score: 1 }
      });
    }

    res.json({
      success: true,
      viewsCount: post.viewsCount,
      hasViewed: true
    });

  } catch (error) {
    console.error('Error tracking view:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track view'
    });
  }
});

/**
 * @route   GET /api/posts/:id/viewers
 * @desc    Get post viewers (for post owner)
 * @access  Private
 */
router.get('/:id/viewers', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('views.user', 'username profilePicture');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Only post owner can see viewers
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view post viewers'
      });
    }

    const viewers = (post.views || [])
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .map(view => ({
        user: view.user,
        viewedAt: view.viewedAt
      }));

    res.json({
      success: true,
      data: viewers
    });

  } catch (error) {
    console.error('Error fetching viewers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch viewers'
    });
  }
});

// ========== UPDATED POSTS ROUTE WITH PROPER VIEWS ==========

/**
 * @route   GET /api/posts
 * @desc    Get feed with customizable distribution
 * @query   followingRatio - Percentage from following (default: 60)
 * @query   mixStrategy - 'balanced', 'chronological', or 'weighted'
 * @access  Private
 */
router.get('/', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('following');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const following = user.following || [];
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  // Customizable ratio (default 60%)
  const followingRatio = parseInt(req.query.followingRatio) || 60;
  const followingCount = Math.floor(limit * (followingRatio / 100));
  const publicCount = limit - followingCount;

  // Mix strategy
  const mixStrategy = req.query.mixStrategy || 'weighted';

  // Get user's own posts (always included, doesn't count towards ratio)
  const userPosts = await Post.find({
    author: req.user._id,
    isHidden: false
  })
    .sort({ createdAt: -1 })
    .limit(3)
    .populate('author', 'username profilePicture')
    .lean();

  // Get posts from followed users
  const followingPosts = await Post.find({
    author: { $in: following },
    isHidden: false,
    visibility: { $in: ['public', 'followers'] }
  })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, (page - 1) * followingCount))
    .limit(followingCount)
    .populate('author', 'username profilePicture')
    .lean();

  // Get public posts
  const publicPosts = await Post.find({
    author: { $nin: [...following, req.user._id] },
    visibility: 'public',
    isHidden: false
  })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, (page - 1) * publicCount))
    .limit(publicCount)
    .populate('author', 'username profilePicture')
    .lean();

  // Mix posts based on strategy
  let mixedPosts = [];

  switch (mixStrategy) {
    case 'chronological':
      mixedPosts = [...userPosts, ...followingPosts, ...publicPosts]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;

    case 'balanced':
      mixedPosts = interleavePosts(userPosts, followingPosts, publicPosts);
      break;

    case 'weighted':
    default:
      mixedPosts = weightedShuffle([...userPosts, ...followingPosts, ...publicPosts]);
      break;
  }

  // Track views
  const viewPromises = mixedPosts.map(post => {
    if (post.author._id.toString() !== req.user._id.toString()) {
      return Post.findById(post._id).then(p => p.addView(req.user._id));
    }
    return Promise.resolve();
  });
  Promise.allSettled(viewPromises).catch(console.error);

  const postsWithMedia = mixedPosts.map(p => ({
    ...p,
    media: toAbsoluteMedia(req, p.media),
    isLiked: p.likes?.some(id => id.toString() === req.user._id.toString()) || false,
    hasViewed: p.views?.some(v => v.user.toString() === req.user._id.toString()) || false
  }));

  // Get totals for pagination
  const [followingTotal, publicTotal] = await Promise.all([
    Post.countDocuments({ author: { $in: following }, isHidden: false }),
    Post.countDocuments({ author: { $nin: [...following, req.user._id] }, visibility: 'public', isHidden: false })
  ]);

  const total = followingTotal + publicTotal;
  const totalPages = Math.ceil(total / limit);

  res.json({
    success: true,
    data: postsWithMedia,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      distribution: {
        following: followingPosts.length,
        public: publicPosts.length,
        own: userPosts.length,
        ratio: followingRatio
      },
      hasMore: page < totalPages
    }
  });
}));

// Helper function to interleave posts
function interleavePosts(own, following, public_) {
  const result = [];
  const maxLength = Math.max(own.length, following.length, public_.length);

  for (let i = 0; i < maxLength; i++) {
    if (i < own.length) result.push(own[i]);

    for (let j = 0; j < 3; j++) {
      const followingIndex = i * 3 + j;
      if (followingIndex < following.length) {
        result.push(following[followingIndex]);
      }
    }

    for (let j = 0; j < 2; j++) {
      const publicIndex = i * 2 + j;
      if (publicIndex < public_.length) {
        result.push(public_[publicIndex]);
      }
    }
  }

  return result;
}

/**
 * @route   GET /api/posts/analytics/:id
 * @desc    Get post analytics (owner only)
 * @access  Private
 */
router.get('/analytics/:id', protect, [
  param('id').isMongoId()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const post = await Post.findById(req.params.id)
    .populate('views.user', 'username profilePicture')
    .populate('likes', 'username profilePicture');

  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  if (post.author.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentViews = post.views?.filter(v => v.viewedAt > last7Days) || [];

  const viewsByDay = {};
  post.views?.forEach(view => {
    const day = view.viewedAt.toISOString().split('T')[0];
    viewsByDay[day] = (viewsByDay[day] || 0) + 1;
  });

  res.json({
    success: true,
    data: {
      totalViews: post.viewsCount,
      uniqueViewers: post.uniqueViewers,
      totalLikes: post.likesCount,
      recentViews: recentViews.length,
      viewsByDay,
      recentViewers: post.views
        ?.sort((a, b) => b.viewedAt - a.viewedAt)
        .slice(0, 10)
        .map(v => ({
          user: v.user,
          viewedAt: v.viewedAt
        })),
      topLikers: post.likes?.slice(0, 10)
    }
  });
}));

// ========== REELS/VIDEO ENDPOINTS ==========

/**
 * @route   GET /api/posts/videos/random
 * @desc    Get random video posts for reels
 * @access  Public/Private (with auth for personalized)
 */
router.get('/videos/random', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 30 }).toInt()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  let visibilityFilter = { visibility: 'public' };

  if (req.user) {
    const user = await User.findById(req.user._id).select('following');
    const following = user?.following || [];

    visibilityFilter = {
      $or: [
        { visibility: 'public' },
        { author: { $in: following }, visibility: 'followers' }
      ]
    };
  }

  const posts = await Post.aggregate([
    {
      $match: {
        ...visibilityFilter,
        isHidden: false,
        'media.mediaType': 'video',
        $expr: { $gt: [{ $size: '$media' }, 0] }
      }
    },
    { $sample: { size: limit * 2 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'author'
      }
    },
    { $unwind: '$author' },
    {
      $project: {
        content: 1,
        media: 1,
        hashtags: 1,
        likesCount: 1,
        commentsCount: 1,
        viewsCount: 1,
        createdAt: 1,
        'author._id': 1,
        'author.username': 1,
        'author.profilePicture': 1,
        'author.isVerified': 1
      }
    }
  ]);

  if (req.user) {
    posts.forEach(post => {
      post.isLiked = post.likes?.some(id =>
        id.toString() === req.user._id.toString()
      ) || false;
    });
  }

  if (req.user) {
    setImmediate(async () => {
      for (const post of posts) {
        if (post.author._id.toString() !== req.user._id.toString()) {
          await Post.findById(post._id).then(p => p.addView(req.user._id));
        }
      }
    });
  }

  const total = await Post.countDocuments({
    ...visibilityFilter,
    isHidden: false,
    'media.mediaType': 'video'
  });

  res.json({
    success: true,
    data: {
      posts: posts.map(p => ({
        ...p,
        media: toAbsoluteMedia(req, p.media)
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + posts.length < total
      }
    }
  });
}));

/**
 * @route   GET /api/posts/videos/trending
 * @desc    Get trending video posts
 * @access  Public
 */
router.get('/videos/trending', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 30 }).toInt()
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const posts = await Post.aggregate([
    {
      $match: {
        visibility: 'public',
        isHidden: false,
        'media.mediaType': 'video',
        createdAt: { $gte: oneWeekAgo }
      }
    },
    {
      $addFields: {
        trendingScore: {
          $add: [
            { $multiply: ['$viewsCount', 0.3] },
            { $multiply: ['$likesCount', 0.5] },
            { $multiply: ['$commentsCount', 0.2] }
          ]
        }
      }
    },
    { $sort: { trendingScore: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'author'
      }
    },
    { $unwind: '$author' }
  ]);

  if (req.user) {
    posts.forEach(post => {
      post.isLiked = post.likes?.some(id =>
        id.toString() === req.user._id.toString()
      ) || false;
    });
  }

  res.json({
    success: true,
    data: {
      posts: posts.map(p => ({
        ...p,
        media: toAbsoluteMedia(req, p.media)
      }))
    }
  });
}));

/**
 * @route   GET /api/posts/videos/user/:userId
 * @desc    Get video posts by specific user
 * @access  Public/Private (respects privacy)
 */
router.get('/videos/user/:userId', [
  param('userId').isMongoId(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 30 }).toInt()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const targetUserId = req.params.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  let visibilityFilter = { visibility: 'public' };

  if (req.user) {
    const isOwn = req.user._id.toString() === targetUserId;
    if (isOwn) {
      visibilityFilter = {};
    } else {
      const viewer = await User.findById(req.user._id).select('following');
      if (viewer?.following?.some(id => id.toString() === targetUserId)) {
        visibilityFilter = { visibility: { $in: ['public', 'followers'] } };
      }
    }
  }

  const [posts, total] = await Promise.all([
    Post.find({
      author: targetUserId,
      isHidden: false,
      'media.mediaType': 'video',
      ...visibilityFilter
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username profilePicture isVerified')
      .lean(),
    Post.countDocuments({
      author: targetUserId,
      isHidden: false,
      'media.mediaType': 'video',
      ...visibilityFilter
    })
  ]);

  if (req.user) {
    posts.forEach(post => {
      post.isLiked = post.likes?.some(id =>
        id.toString() === req.user._id.toString()
      ) || false;
    });
  }

  res.json({
    success: true,
    data: {
      posts: posts.map(p => ({
        ...p,
        media: toAbsoluteMedia(req, p.media)
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + posts.length < total
      }
    }
  });
}));

/**
 * @route   GET /api/posts/videos/recommended
 * @desc    Get recommended videos based on user interests
 * @access  Private
 */
router.get('/videos/recommended', protect, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 30 }).toInt()
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const userLikedPosts = await Post.find({
    likes: req.user._id,
    'media.mediaType': 'video'
  })
    .select('hashtags author')
    .limit(50)
    .lean();

  const followedUsers = req.user.following || [];
  const likedHashtags = userLikedPosts.flatMap(p => p.hashtags || []);
  const likedAuthors = userLikedPosts.map(p => p.author);

  const recommendationQuery = {
    visibility: 'public',
    isHidden: false,
    'media.mediaType': 'video',
    author: { $ne: req.user._id },
    $or: [
      ...(followedUsers.length ? [{ author: { $in: followedUsers } }] : []),
      ...(likedHashtags.length ? [{ hashtags: { $in: likedHashtags } }] : []),
      ...(likedAuthors.length ? [{ author: { $in: likedAuthors } }] : [])
    ]
  };

  if (followedUsers.length === 0 && likedHashtags.length === 0 && likedAuthors.length === 0) {
    return res.redirect(`/api/posts/videos/random?page=${page}&limit=${limit}`);
  }

  const posts = await Post.find(recommendationQuery)
    .sort({ createdAt: -1, likesCount: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture isVerified')
    .lean();

  posts.forEach(post => {
    post.isLiked = post.likes?.some(id =>
      id.toString() === req.user._id.toString()
    ) || false;
  });

  setImmediate(async () => {
    for (const post of posts) {
      if (post.author._id.toString() !== req.user._id.toString()) {
        await Post.findById(post._id).then(p => p.addView(req.user._id));
      }
    }
  });

  const total = await Post.countDocuments(recommendationQuery);

  res.json({
    success: true,
    data: {
      posts: posts.map(p => ({
        ...p,
        media: toAbsoluteMedia(req, p.media)
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + posts.length < total
      }
    }
  });
}));

/**
 * @route   GET /api/posts/videos/:id/next
 * @desc    Get next video in sequence (for seamless scrolling)
 * @access  Public/Private
 */
router.get('/videos/:id/next', [
  param('id').isMongoId()
], asyncHandler(async (req, res) => {
  const currentPost = await Post.findById(req.params.id);
  if (!currentPost) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  let visibilityFilter = { visibility: 'public' };
  if (req.user) {
    const user = await User.findById(req.user._id).select('following');
    const following = user?.following || [];
    visibilityFilter = {
      $or: [
        { visibility: 'public' },
        { author: { $in: following }, visibility: 'followers' }
      ]
    };
  }

  const nextPost = await Post.findOne({
    ...visibilityFilter,
    isHidden: false,
    'media.mediaType': 'video',
    _id: { $ne: currentPost._id },
    createdAt: { $lt: currentPost.createdAt }
  })
    .sort({ createdAt: -1 })
    .populate('author', 'username profilePicture isVerified')
    .lean();

  if (!nextPost) {
    const random = await Post.aggregate([
      {
        $match: {
          ...visibilityFilter,
          isHidden: false,
          'media.mediaType': 'video',
          _id: { $ne: currentPost._id }
        }
      },
      { $sample: { size: 1 } },
      {
        $lookup: {
          from: 'users',
          localField: 'author',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: '$author' }
    ]);

    if (random.length) {
      random[0].isLiked = req.user ? random[0].likes?.some(id =>
        id.toString() === req.user._id.toString()
      ) || false : false;

      return res.json({
        success: true,
        data: {
          ...random[0],
          media: toAbsoluteMedia(req, random[0].media)
        }
      });
    }

    return res.status(404).json({ success: false, message: 'No more videos' });
  }

  if (req.user) {
    nextPost.isLiked = nextPost.likes?.some(id =>
      id.toString() === req.user._id.toString()
    ) || false;
  }

  res.json({
    success: true,
    data: {
      ...nextPost,
      media: toAbsoluteMedia(req, nextPost.media)
    }
  });
}));

// ========== ERROR HANDLING ==========
router.use((err, req, res, next) => {
  console.error('Posts Route Error:', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack
  });

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large (max 10MB)' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Server error'
  });
});

module.exports = router;