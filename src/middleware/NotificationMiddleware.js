const NotificationService = require('../services/notificationService');

/**
 * Middleware to create notifications after user actions
 * Non-blocking - failures won't affect the main request
 */
class NotificationMiddleware {
  
  /**
   * Create notification after user follows another user
   */
  static async afterFollow(req, res, next) {
    // Skip if no notification needed
    if (!req.params.id || !req.user?._id) {
      return next();
    }

    const followedUserId = req.params.id;
    const followerId = req.user._id;

    // Don't notify if following yourself
    if (followedUserId.toString() === followerId.toString()) {
      return next();
    }

    try {
      await NotificationService.create({
        recipient: followedUserId,
        sender: followerId,
        type: 'new_follower',
        reference: {
          model: 'User',
          id: followerId
        },
        metadata: {
          action: 'follow',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('❌ afterFollow notification error:', {
        error: error.message,
        followerId,
        followedUserId
      });
      // Don't block the request on notification failure
    }
    
    next();
  }

  /**
   * Create notification after post like
   */
 static async afterPostLike(req, res, next) {
    try {
      // Check if post and user exist
      if (!req.post || !req.user) {
        return next();
      }

      const post = req.post;
      const likerId = req.user._id;

      // 🚫 DON'T NOTIFY IF LIKING YOUR OWN POST
      if (post.author.toString() === likerId.toString()) {
        console.log('🔔 Skipping self-like notification');
        return next();
      }

      // Create notification for post author
      await NotificationService.create({
        recipient: post.author,
        sender: likerId,
        type: 'post_like',
        reference: {
          model: 'Post',
          id: post._id
        },
        metadata: {
          postContent: post.content?.substring(0, 100),
          postId: post._id
        }
      });

      console.log(`🔔 Like notification sent to ${post.author}`);
      
    } catch (error) {
      console.error('❌ afterPostLike notification error:', error.message);
      // Don't block the request
    }
    
    next();
  }
  /**
   * Create notification after comment
   * Handles:
   * - Notify post author
   * - Notify mentioned users
   * - Future: Notify parent comment author (replies)
   */
   
  static async afterComment(req, res, next) {
    try {
      if (!req.post || !req.comment || !req.user) {
        return next();
      }

      const post = req.post;
      const comment = req.comment;
      const commenterId = req.user._id;

      // 🚫 DON'T NOTIFY IF COMMENTING ON YOUR OWN POST
      if (post.author.toString() !== commenterId.toString()) {
        await NotificationService.create({
          recipient: post.author,
          sender: commenterId,
          type: 'post_comment',
          reference: {
            model: 'Comment',
            id: comment._id
          },
          metadata: {
            postId: post._id,
            commentContent: comment.content?.substring(0, 100)
          }
        });
      }

      // Handle mentions (still notify if someone else is mentioned)
      const mentions = req.mentions || [];
      for (const mentionedUserId of mentions) {
        // 🚫 DON'T NOTIFY IF MENTIONING YOURSELF
        if (mentionedUserId.toString() !== commenterId.toString()) {
          await NotificationService.create({
            recipient: mentionedUserId,
            sender: commenterId,
            type: 'mention',
            reference: {
              model: 'Comment',
              id: comment._id
            },
            metadata: {
              postId: post._id
            }
          });
        }
      }
      
    } catch (error) {
      console.error('❌ afterComment notification error:', error.message);
    }
    
    next();
  }

  /**
   * Create notification after reply to a comment
   * Separate middleware for cleaner separation
   */
    static async afterReply(req, res, next) {
    try {
      if (!req.parentComment || !req.comment || !req.user) {
        return next();
      }

      const parentComment = req.parentComment;
      const reply = req.comment;
      const replierId = req.user._id;

      // 🚫 DON'T NOTIFY IF REPLYING TO YOUR OWN COMMENT
      if (parentComment.author.toString() !== replierId.toString()) {
        await NotificationService.create({
          recipient: parentComment.author,
          sender: replierId,
          type: 'comment_reply',
          reference: {
            model: 'Comment',
            id: reply._id
          },
          metadata: {
            postId: req.post?._id,
            parentCommentId: parentComment._id,
            replyContent: reply.content?.substring(0, 100)
          }
        });
      }
      
    } catch (error) {
      console.error('❌ afterReply notification error:', error.message);
    }
    
    next();
  }

  /**
   * Create notification after post mention
   * For @mentions in post content
   */
  static async afterPostMention(req, res, next) {
    if (!req.post || !req.user?._id || !req.mentions?.length) {
      return next();
    }

    const post = req.post;
    const authorId = req.user._id;
    const mentions = req.mentions || [];

    try {
      const mentionPromises = mentions
        .filter(mentionedUserId => 
          mentionedUserId.toString() !== authorId.toString()
        )
        .map(mentionedUserId => 
          NotificationService.create({
            recipient: mentionedUserId,
            sender: authorId,
            type: 'mention',
            reference: {
              model: 'Post',
              id: post._id
            },
            metadata: {
              postContent: post.content?.substring(0, 100),
              timestamp: new Date().toISOString()
            }
          })
        );

      await Promise.allSettled(mentionPromises);
    } catch (error) {
      console.error('❌ afterPostMention notification error:', error);
    }
    
    next();
  }
}

module.exports = NotificationMiddleware;