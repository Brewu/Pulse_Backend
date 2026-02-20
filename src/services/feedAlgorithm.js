// services/feedAlgorithm.js
const Post = require('../models/Post');
const User = require('../models/User');

class FeedAlgorithm {
  constructor() {
    this.WEIGHTS = {
      RECENCY: 0.20,
      ENGAGEMENT: 0.25,
      RELATIONSHIP: 0.25,
      QUALITY: 0.15,
      RELEVANCE: 0.15
    };

    this.HALF_LIFE_HOURS = 24;
    this.TIME_DECAY_FACTOR = 0.5;
    this.MIN_SCORE = 0.1;
  }

  calculateRecencyScore(post) {
    const ageInHours = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
    const halfLives = ageInHours / this.HALF_LIFE_HOURS;
    return Math.exp(-halfLives * this.TIME_DECAY_FACTOR);
  }

  calculateEngagementScore(post) {
    const baseEngagement = (
      (post.likesCount || 0) * 1 +
      (post.commentsCount || 0) * 2
    );

    const normalizedEngagement = Math.log10(baseEngagement + 1) / 5;

    if (post.viewsCount > 0) {
      const engagementRate = baseEngagement / post.viewsCount;
      return (normalizedEngagement + engagementRate) / 2;
    }

    return normalizedEngagement;
  }

  calculateRelationshipScore(post, user) {
    if (!user || !post.author) return 0.1;

    const authorId = post.author._id?.toString() || post.author.toString();
    const userId = user._id.toString();

    if (authorId === userId) return 1;

    let score = 0.1;
    let factors = 0;

    if (user.following && Array.isArray(user.following)) {
      if (user.following.some(id => id.toString() === authorId)) {
        score += 0.6;
        factors++;

        if (post.author.followers && Array.isArray(post.author.followers)) {
          if (post.author.followers.some(id => id.toString() === userId)) {
            score += 0.2;
            factors++;
          }
        }
      }
    }

    if (post.author.rank) {
      const rankBonus = {
        'Rookie': 0,
        'Bronze': 0.05,
        'Silver': 0.1,
        'Gold': 0.15,
        'Platinum': 0.2,
        'Diamond': 0.25,
        'Master': 0.3,
        'Grandmaster': 0.35,
        'Legend': 0.4,
        'Mythic': 0.5
      };
      score += rankBonus[post.author.rank] || 0;
      factors++;
    }

    return factors > 0 ? score / factors : score;
  }

  calculateQualityScore(post) {
    let score = 0;
    let factors = 0;

    if (post.media && post.media.length > 0) {
      score += 0.3;
      factors++;
      
      if (post.media.length > 1) {
        score += 0.1;
        factors++;
      }
    }

    if (post.content) {
      const wordCount = post.content.split(/\s+/).length;
      if (wordCount > 100) score += 0.3;
      else if (wordCount > 50) score += 0.2;
      else if (wordCount > 20) score += 0.1;
      factors++;
    }

    if (post.tags && post.tags.length > 0) {
      score += Math.min(post.tags.length * 0.05, 0.2);
      factors++;
    }

    if (post.location && post.location.name) {
      score += 0.1;
      factors++;
    }

    if (post.linkPreview && post.linkPreview.url) {
      score += 0.15;
      factors++;
    }

    if (post.poll && post.poll.question) {
      score += 0.2;
      factors++;
    }

    if (post.hasContentWarning) {
      score += 0.1;
      factors++;
    }

    if (post.author && post.author.isVerified) {
      score += 0.15;
      factors++;
    }

    return factors > 0 ? score / factors : 0.1;
  }

  calculateRelevanceScore(post, user) {
    return 0.1; // Base relevance
  }

  calculatePostScore(post, user, context = {}) {
    const scores = {
      recency: this.calculateRecencyScore(post),
      engagement: this.calculateEngagementScore(post),
      relationship: this.calculateRelationshipScore(post, user),
      quality: this.calculateQualityScore(post),
      relevance: this.calculateRelevanceScore(post, user)
    };

    let totalScore = 0;
    for (const [factor, score] of Object.entries(scores)) {
      totalScore += score * this.WEIGHTS[factor.toUpperCase()];
    }

    totalScore = this.applyBoosts(totalScore, post, user, context);

    return Math.min(100, Math.max(0, totalScore * 100));
  }

  applyBoosts(score, post, user, context) {
    let boostedScore = score;

    const ageInHours = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageInHours < 1) {
      boostedScore *= 1.5;
    } else if (ageInHours < 6) {
      boostedScore *= 1.2;
    }

    if (post.popularityScore > 100) {
      boostedScore *= 1.3;
    }

    if (context.seenAuthors && !context.seenAuthors.includes(post.author?._id?.toString())) {
      boostedScore *= 1.1;
    }

    return boostedScore;
  }

  async generateFeed(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      excludeIds = [],
      seenAuthors = [],
      seenTags = []
    } = options;

    const skip = (page - 1) * limit;

    const user = await User.findById(userId)
      .select('following followers rank score')
      .lean();

    if (!user) {
      throw new Error('User not found');
    }

    const context = {
      seenAuthors: seenAuthors.map(id => id.toString()),
      seenTags
    };

    const candidates = await this.fetchCandidatePosts(user, limit * 3);

    const scoredPosts = await Promise.all(
      candidates.map(async (post) => {
        if (!post.author || typeof post.author === 'string') {
          post.author = await User.findById(post.author)
            .select('username profilePicture rank isVerified followers')
            .lean();
        }

        return {
          post,
          score: this.calculatePostScore(post, user, context)
        };
      })
    );

    const filteredPosts = scoredPosts.filter(item => item.score >= this.MIN_SCORE);
    const sortedPosts = filteredPosts.sort((a, b) => b.score - a.score);
    const diversePosts = this.applyDiversitySampling(sortedPosts, limit);
    const paginatedPosts = diversePosts.slice(skip, skip + limit);

    return {
      posts: paginatedPosts.map(item => item.post),
      scores: paginatedPosts.map(item => item.score),
      pagination: {
        page,
        limit,
        total: filteredPosts.length,
        hasMore: skip + limit < filteredPosts.length
      }
    };
  }

  async fetchCandidatePosts(user, limit) {
    const following = user.following || [];

    const posts = await Post.aggregate([
      {
        $match: {
          isHidden: false,
          $or: [
            { 
              author: { $in: following },
              visibility: { $in: ['public', 'followers'] }
            },
            { 
              visibility: 'public',
              author: { $nin: following }
            }
          ]
        }
      },
      {
        $addFields: {
          priority: {
            $switch: {
              branches: [
                { 
                  case: { $in: ['$author', following] }, 
                  then: 3 
                },
                { 
                  case: { $gt: ['$engagementScore', 50] }, 
                  then: 2 
                },
                { 
                  case: { $gt: ['$likesCount', 100] }, 
                  then: 1 
                }
              ],
              default: 0
            }
          }
        }
      },
      {
        $sort: {
          priority: -1,
          engagementScore: -1,
          createdAt: -1
        }
      },
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

    return posts;
  }

  applyDiversitySampling(scoredPosts, limit) {
    const result = [];
    const authorCounts = new Map();
    const tagCounts = new Map();

    for (const item of scoredPosts) {
      const post = item.post;
      const authorId = post.author?._id?.toString();

      const authorFrequency = authorCounts.get(authorId) || 0;
      if (authorFrequency >= 2) continue;

      let tagOverload = false;
      if (post.tags) {
        for (const tag of post.tags) {
          if ((tagCounts.get(tag) || 0) >= 3) {
            tagOverload = true;
            break;
          }
        }
      }
      if (tagOverload) continue;

      result.push(item);
      authorCounts.set(authorId, (authorFrequency || 0) + 1);
      
      if (post.tags) {
        for (const tag of post.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }

      if (result.length >= limit * 2) break;
    }

    return result;
  }

  async getTrendingPosts(limit = 20) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const posts = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: oneDayAgo },
          visibility: 'public',
          isHidden: false
        }
      },
      {
        $addFields: {
          trendingScore: {
            $add: [
              { $multiply: ['$likesCount', 1] },
              { $multiply: ['$commentsCount', 3] }
            ]
          }
        }
      },
      { $sort: { trendingScore: -1 } },
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

    return posts;
  }

  async getDiscoveryFeed(userId, limit = 20) {
    const user = await User.findById(userId).select('following');

    const posts = await Post.aggregate([
      {
        $match: {
          author: { $nin: user.following || [] },
          visibility: 'public',
          isHidden: false
        }
      },
      {
        $addFields: {
          discoveryScore: {
            $add: [
              { $multiply: ['$likesCount', 0.5] },
              { $multiply: ['$commentsCount', 1] },
              '$engagementScore'
            ]
          }
        }
      },
      { $sort: { discoveryScore: -1, createdAt: -1 } },
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

    return posts;
  }
}

module.exports = new FeedAlgorithm();