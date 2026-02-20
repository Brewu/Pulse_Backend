// services/expiryService.js
// Create this new file

const mongoose = require('mongoose');
const cron = require('node-cron'); // You'll need to install this: npm install node-cron

// Store scheduled jobs
const scheduledJobs = new Map();

/**
 * Schedule a post for expiry
 * @param {string} postId - Post ID
 * @param {Date} expiresAt - Expiry date
 */
const schedulePostExpiry = (postId, expiresAt) => {
  const Post = mongoose.model('Post');
  
  // Calculate delay in milliseconds
  const now = new Date();
  const delay = expiresAt.getTime() - now.getTime();
  
  if (delay <= 0) {
    // Already expired, expire immediately
    expirePost(postId);
    return;
  }
  
  // Schedule the expiry
  const timeoutId = setTimeout(async () => {
    await expirePost(postId);
    scheduledJobs.delete(postId);
  }, delay);
  
  // Store the timeout ID so we can cancel if needed
  scheduledJobs.set(postId.toString(), timeoutId);
  
  console.log(`Scheduled post ${postId} to expire in ${Math.round(delay / 1000 / 60)} minutes`);
};

/**
 * Expire a post (soft delete)
 * @param {string} postId - Post ID
 */
const expirePost = async (postId) => {
  try {
    const Post = mongoose.model('Post');
    
    const post = await Post.findById(postId);
    if (!post) {
      console.log(`Post ${postId} not found for expiry`);
      return;
    }
    
    // Mark as expired
    post.isExpired = true;
    post.expiryNotified = true;
    
    // Optionally: Delete media from Cloudinary
    if (post.media && post.media.length > 0) {
      const cloudinary = require('../utils/cloudinary');
      
      for (const media of post.media) {
        if (media.publicId) {
          try {
            await cloudinary.uploader.destroy(media.publicId, {
              resource_type: media.mediaType === 'video' ? 'video' : 'image'
            });
          } catch (err) {
            console.error(`Failed to delete media ${media.publicId}:`, err);
          }
        }
      }
    }
    
    await post.save();
    
    console.log(`Post ${postId} has expired and been marked as deleted`);
    
    // You could also emit a socket event to notify users
    const io = require('../socket').getIO();
    if (io) {
      io.emit('post:expired', { postId });
    }
    
  } catch (error) {
    console.error(`Error expiring post ${postId}:`, error);
  }
};

/**
 * Cancel scheduled expiry for a post
 * @param {string} postId - Post ID
 */
const cancelPostExpiry = (postId) => {
  const timeoutId = scheduledJobs.get(postId.toString());
  if (timeoutId) {
    clearTimeout(timeoutId);
    scheduledJobs.delete(postId.toString());
    console.log(`Cancelled expiry for post ${postId}`);
  }
};

/**
 * Initialize expiry service - run on server start
 * This will reschedule any pending expiries
 */
const initializeExpiryService = async () => {
  try {
    const Post = mongoose.model('Post');
    
    // Find all unexpired posts that have expiry dates in the future
    const now = new Date();
    const pendingPosts = await Post.find({
      isExpired: false,
      expiresAt: { $gt: now },
      media: { $exists: true, $ne: [] }
    });
    
    console.log(`Rescheduling ${pendingPosts.length} posts for expiry`);
    
    for (const post of pendingPosts) {
      schedulePostExpiry(post._id, post.expiresAt);
    }
    
    // Also check for posts that should have expired while server was down
    const expiredPosts = await Post.find({
      isExpired: false,
      expiresAt: { $lte: now },
      media: { $exists: true, $ne: [] }
    });
    
    console.log(`Found ${expiredPosts.length} posts that expired while server was down`);
    
    for (const post of expiredPosts) {
      await expirePost(post._id);
    }
    
    // Run a cron job every hour to check for any missed expiries
    cron.schedule('0 * * * *', async () => {
      console.log('Running hourly expiry check...');
      
      const now = new Date();
      const missedExpired = await Post.find({
        isExpired: false,
        expiresAt: { $lte: now },
        media: { $exists: true, $ne: [] }
      });
      
      for (const post of missedExpired) {
        await expirePost(post._id);
      }
    });
    
  } catch (error) {
    console.error('Error initializing expiry service:', error);
  }
};

module.exports = {
  schedulePostExpiry,
  cancelPostExpiry,
  expirePost,
  initializeExpiryService
};