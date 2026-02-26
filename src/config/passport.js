// config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user already exists
      let user = await User.findOne({ 
        $or: [
          { googleId: profile.id },
          { email: profile.emails[0].value }
        ]
      });

      if (user) {
        // If user exists but doesn't have googleId, update it
        if (!user.googleId) {
          user.googleId = profile.id;
          user.isGoogleUser = true;
          await user.save();
        }
        return done(null, user);
      }

      // Create new user
      const username = profile.emails[0].value.split('@')[0] + 
                      Math.floor(Math.random() * 1000);
      
      user = new User({
        googleId: profile.id,
        username: username,
        email: profile.emails[0].value,
        name: profile.displayName,
        profilePicture: profile.photos[0]?.value || 
                       `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName)}`,
        isGoogleUser: true,
        emailVerified: true,
        password: require('crypto').randomBytes(20).toString('hex') // Random password
      });

      await user.save();
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;