// utils/expiryHelper.js
// Create this new file

/**
 * Get expiry duration in hours based on user rank
 * @param {string} rank - User's rank
 * @returns {number} - Expiry duration in hours
 */
const getExpiryDurationByRank = (rank) => {
    const rankExpiryMap = {
        'Rookie': 24,
        'Bronze': 24,
        'Silver': 24,
        'Gold': 24,
        'Platinum': 48,
        'Diamond': 48,
        'Master': 48,
        'Grandmaster': 48,
        'Legend': 48,
        'Mythic': 48
    };

    return rankExpiryMap[rank] || 24; // Default to 24 hours if rank not found
};

/**
 * Calculate expiry date based on user rank
 * @param {string} rank - User's rank
 * @returns {Date} - Expiry date
 */
const calculateExpiryDate = (rank) => {
    const hours = getExpiryDurationByRank(rank);
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + hours);
    return expiryDate;
};

/**
 * Check if a post has media
 * @param {Object} post - Post object
 * @returns {boolean} - Whether post has media
 */
const hasMedia = (post) => {
    return post.media && post.media.length > 0;
};
// Add this helper function near your other helpers
function weightedShuffle(posts) {
    // Group posts by day to maintain some chronological order
    const postsByDay = {};

    posts.forEach(post => {
        const day = new Date(post.createdAt).toDateString();
        if (!postsByDay[day]) {
            postsByDay[day] = [];
        }
        postsByDay[day].push(post);
    });

    // Shuffle within each day but keep days in order
    const result = [];
    const days = Object.keys(postsByDay).sort((a, b) =>
        new Date(b) - new Date(a)
    );

    days.forEach(day => {
        // Fisher-Yates shuffle for posts within the same day
        const dayPosts = [...postsByDay[day]];
        for (let i = dayPosts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dayPosts[i], dayPosts[j]] = [dayPosts[j], dayPosts[i]];
        }
        result.push(...dayPosts);
    });

    return result;
}

module.exports = {
    getExpiryDurationByRank,
    calculateExpiryDate,
    hasMedia
};