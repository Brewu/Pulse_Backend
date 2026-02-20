// scripts/migrate-views.js
const mongoose = require('mongoose');
const Post = require('../models/Post');

async function migrateViews() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Convert old views format to new format
    const posts = await Post.find({ views: { $type: 'number' } });
    
    for (const post of posts) {
      const oldViewsCount = post.views || 0;
      
      // Create placeholder views if we have count but no data
      if (oldViewsCount > 0 && (!post.views || post.views.length === 0)) {
        post.views = [];
        post.viewsCount = oldViewsCount;
        await post.save();
        console.log(`Migrated post ${post._id} with ${oldViewsCount} views`);
      }
    }
    
    console.log('Migration complete');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    mongoose.disconnect();
  }
}

migrateViews();