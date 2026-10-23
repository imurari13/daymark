require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['employee', 'admin'], default: 'employee' },
  shift: { start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' }, breakMinutes: { type: Number, default: 60 } },
  active: { type: Boolean, default: true }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);
(async () => {
  if (!process.env.MONGODB_URI || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_NAME) throw new Error('Set MONGODB_URI, ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  await mongoose.connect(process.env.MONGODB_URI);
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'admin';
    existing.name = process.env.ADMIN_NAME;
    existing.passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    existing.active = true;
    await existing.save();
    console.log(`Updated admin account: ${email}`);
  } else {
    await User.create({ name: process.env.ADMIN_NAME, email, passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), role: 'admin' });
    console.log(`Created admin account: ${email}`);
  }
  await mongoose.disconnect();
})().catch(async err => { console.error(err.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
