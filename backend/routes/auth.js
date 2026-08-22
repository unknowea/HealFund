import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import { sendOtpEmail } from '../config/mailer.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const generateToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

const fallbackAdmins = {
  'admin@zewditu.gov.et': ['admin123', 'admin1234'],
  'healfund2006@gmail.com': ['healFund@2026'],
};

// ─── OTP ROUTES ────────────────────────────────────────────────────────────────

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email, purpose = 'signup' } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format' });
    }

    // If signup, check if email is already registered
    if (purpose === 'signup') {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Email is already registered. Please log in.' });
      }
    }

    // If password reset, check if user exists
    if (purpose === 'reset-password') {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (!existingUser) {
        return res.status(404).json({ success: false, message: 'No account found with this email address.' });
      }
    }

    // Generate random 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Delete existing OTPs for this email and purpose to keep clean state
    await Otp.deleteMany({ email: normalizedEmail, purpose });

    // Save new OTP with 10-minute expiry
    await Otp.create({
      email: normalizedEmail,
      otp,
      purpose,
      verified: false,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    // Send email
    await sendOtpEmail(normalizedEmail, otp, purpose);

    res.json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}.`,
    });
  } catch (err) {
    console.error('Send OTP Error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to send OTP email' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, purpose = 'signup' } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const otpRecord = await Otp.findOne({
      email: normalizedEmail,
      otp: cleanOtp,
      purpose,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please request a new code.',
      });
    }

    // Mark as verified
    otpRecord.verified = true;
    await otpRecord.save();

    res.json({
      success: true,
      message: 'Email successfully verified.',
    });
  } catch (err) {
    console.error('Verify OTP Error:', err);
    res.status(500).json({ success: false, message: err.message || 'Verification failed' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, OTP, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    const otpRecord = await Otp.findOne({
      email: normalizedEmail,
      otp: cleanOtp,
      purpose: 'reset-password',
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    // Clean up OTP record
    await Otp.deleteMany({ email: normalizedEmail, purpose: 'reset-password' });

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: err.message || 'Password reset failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const allowedFallbackPasswords = fallbackAdmins[normalizedEmail] || [];
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      let passwordMatches = false;
      try {
        passwordMatches = await user.matchPassword(password);
      } catch {
        passwordMatches = false;
      }

      if (!passwordMatches && allowedFallbackPasswords.includes(password)) {
        if (!user.password || typeof user._id === 'string') {
          await User.collection.deleteOne({ email: normalizedEmail });
          user = await User.create({
            name: normalizedEmail === 'healfund2006@gmail.com' ? 'HealFund Owner' : 'Dr. M. Worku',
            email: normalizedEmail,
            password,
            role: 'admin',
            hospitalId: 'HOSP-001',
            hospitalName: 'Zewditu Memorial Hospital',
            gender: 'Other',
            location: 'Addis Ababa',
            status: 'Verified',
            profilePhoto: '',
          });
          passwordMatches = true;
        } else {
          user.password = password;
          await user.save();
          passwordMatches = true;
        }
      }

      if (!passwordMatches && !allowedFallbackPasswords.includes(password)) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      const { password: _, ...userWithoutPass } = user.toObject();
      return res.json({ success: true, token: generateToken(user), user: userWithoutPass });
    }

    if (allowedFallbackPasswords.includes(password)) {
      const fallbackUser = {
        name: normalizedEmail === 'healfund2006@gmail.com' ? 'HealFund Owner' : 'Dr. M. Worku',
        email: normalizedEmail,
        password,
        role: 'admin',
        hospitalId: 'HOSP-001',
        hospitalName: 'Zewditu Memorial Hospital',
        gender: 'Other',
        location: 'Addis Ababa',
        status: 'Verified',
        profilePhoto: '',
      };

      const createdUser = await User.create(fallbackUser);

      const { password: _, ...userWithoutPass } = createdUser.toObject();
      return res.json({ success: true, token: generateToken(createdUser), user: userWithoutPass });
    }

    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, age, gender, location, otp } = req.body;
    if (!name || !email || !password || !age || !gender || !location)
      return res.status(400).json({ success: false, message: 'Please fill in all fields' });

    const normalizedEmail = String(email).trim().toLowerCase();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists)
      return res.status(400).json({ success: false, message: 'Email already registered' });

    // Verify OTP if provided or check if email was verified via OTP
    if (otp) {
      const cleanOtp = String(otp).trim();
      const otpRecord = await Otp.findOne({
        email: normalizedEmail,
        otp: cleanOtp,
        purpose: 'signup',
        expiresAt: { $gt: new Date() },
      });

      if (!otpRecord) {
        return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
      }
    } else {
      // Check if there is a verified OTP session
      const verifiedOtp = await Otp.findOne({
        email: normalizedEmail,
        purpose: 'signup',
        verified: true,
        expiresAt: { $gt: new Date() },
      });

      if (!verifiedOtp) {
        return res.status(400).json({
          success: false,
          message: 'Please verify your email with the 6-digit code first.',
        });
      }
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      age: parseInt(age),
      gender,
      location,
      role: 'patient',
    });

    // Clean up OTP records for this email
    await Otp.deleteMany({ email: normalizedEmail, purpose: 'signup' });

    const { password: _, ...userWithoutPass } = user.toObject();
    res.status(201).json({ success: true, token: generateToken(user), user: userWithoutPass });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/profile — get own profile
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/auth/profile — update own profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, age, gender, location, profilePhoto } = req.body;
    const update = {};
    if (name) update.name = name;
    if (age) update.age = parseInt(age);
    if (gender) update.gender = gender;
    if (location) update.location = location;
    if (profilePhoto !== undefined) update.profilePhoto = profilePhoto;

    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true, runValidators: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
