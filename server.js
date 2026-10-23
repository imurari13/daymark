require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random value at least 32 characters long.');
  process.exit(1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 10 : 50,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(express.static(path.join(__dirname, 'public')));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['employee', 'admin'], default: 'employee' },
  shift: {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '18:00' },
    breakMinutes: { type: Number, default: 60, min: 0, max: 300 }
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true, index: true },
  clockIn: { type: Date, default: null },
  clockOut: { type: Date, default: null },
  breakMinutes: { type: Number, default: 0 },
  status: { type: String, enum: ['present', 'late', 'incomplete'], default: 'present' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const punchRequestSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true },
  punchType: { type: String, enum: ['clockIn', 'clockOut'], required: true },
  requestedTime: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewNote: { type: String, default: '', maxlength: 500 }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const PunchRequest = mongoose.model('PunchRequest', punchRequestSchema);

let databasePromise;

async function ensureAdminUser() {
  const name = String(process.env.ADMIN_NAME || '').trim();
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');

  if (!name || !email || !password) {
    console.warn('Admin account not configured yet. Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env to enable sign-in.');
    return;
  }

  if (password.length < 12) {
    console.warn('ADMIN_PASSWORD should be at least 12 characters long.');
    return;
  }

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
    }
    console.log(`Admin account already exists: ${email}`);
    return;
  }

  await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
  console.log(`Created admin account: ${email}`);
}

function connectDatabase() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (mongoose.connection.readyState === 0) databasePromise = null;
  if (!databasePromise) {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/minimal_attendance';
    databasePromise = mongoose.connect(uri)
      .then(ensureAdminUser)
      .catch(err => {
        databasePromise = null;
        throw err;
      });
  }
  return databasePromise;
}

app.use(async (req, res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (err) {
    next(err);
  }
});

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function localMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type).value);
  return get('hour') * 60 + get('minute');
}
function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role, shift: user.shift, active: user.active };
}
function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
}
async function auth(req, res, next) {
  try {
    const token = req.cookies.attendance_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account unavailable.' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ error: 'Your session has expired. Please log in again.' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function dateParam(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function durationMinutes(record) {
  if (!record?.clockIn || !record?.clockOut) return 0;
  return Math.max(0, Math.floor((new Date(record.clockOut) - new Date(record.clockIn)) / 60000) - (record.breakMinutes || 0));
}
function shapeAttendance(a) {
  if (!a) return null;
  return { id: String(a._id), date: a.date, clockIn: a.clockIn, clockOut: a.clockOut, breakMinutes: a.breakMinutes, status: a.status, workingMinutes: durationMinutes(a) };
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password.' });
  res.cookie('attendance_token', signToken(user), { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000, path: '/' });
  res.json({ user: publicUser(user) });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('attendance_token', { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/attendance/today', auth, async (req, res) => {
  const date = localDate();
  const record = await Attendance.findOne({ employee: req.user._id, date });
  res.json({ date, timezone: TZ, shift: req.user.shift, attendance: shapeAttendance(record) });
});
app.post('/api/attendance/clock-in', auth, async (req, res) => {
  const date = localDate();
  const now = new Date();
  const existing = await Attendance.findOne({ employee: req.user._id, date });
  if (existing?.clockIn) return res.status(409).json({ error: 'You have already clocked in today.' });
  const shiftStart = Number(req.user.shift.start.slice(0, 2)) * 60 + Number(req.user.shift.start.slice(3, 5));
  const late = localMinutes(now) > shiftStart;
  try {
    const record = existing || new Attendance({ employee: req.user._id, date });
    record.clockIn = now;
    record.status = late ? 'late' : 'present';
    record.updatedAt = now;
    await record.save();
    res.json({ attendance: shapeAttendance(record) });
  } catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'Attendance already exists for today.' }); throw e; }
});
app.post('/api/attendance/clock-out', auth, async (req, res) => {
  const date = localDate();
  const record = await Attendance.findOne({ employee: req.user._id, date });
  if (!record?.clockIn) return res.status(400).json({ error: 'Clock in before clocking out.' });
  if (record.clockOut) return res.status(409).json({ error: 'You have already clocked out today.' });
  record.clockOut = new Date();
  record.breakMinutes = req.user.shift.breakMinutes || 0;
  record.updatedAt = new Date();
  await record.save();
  res.json({ attendance: shapeAttendance(record) });
});
app.get('/api/attendance', auth, async (req, res) => {
  const query = {};
  if (req.user.role !== 'admin') query.employee = req.user._id;
  if (req.query.from || req.query.to) {
    query.date = {};
    if (dateParam(req.query.from)) query.date.$gte = req.query.from;
    if (dateParam(req.query.to)) query.date.$lte = req.query.to;
  }
  const records = await Attendance.find(query).sort({ date: -1 }).limit(400).populate('employee', 'name email');
  res.json({ attendance: records.map(a => ({ ...shapeAttendance(a), employee: a.employee ? { id: String(a.employee._id), name: a.employee.name, email: a.employee.email } : null })) });
});

app.post('/api/punch-requests', auth, async (req, res) => {
  const { date, punchType, requestedTime, reason } = req.body;
  if (!dateParam(date) || !['clockIn', 'clockOut'].includes(punchType) || !requestedTime || !String(reason || '').trim()) return res.status(400).json({ error: 'Date, punch type, requested time and reason are required.' });
  const parsed = new Date(requestedTime);
  if (Number.isNaN(parsed.getTime()) || parsed > new Date(Date.now() + 5 * 60000)) return res.status(400).json({ error: 'Please provide a valid requested time.' });
  const pending = await PunchRequest.findOne({ employee: req.user._id, date, punchType, status: 'pending' });
  if (pending) return res.status(409).json({ error: 'You already have a pending request for this punch.' });
  const request = await PunchRequest.create({ employee: req.user._id, date, punchType, requestedTime: parsed, reason: String(reason).trim() });
  res.status(201).json({ request });
});
app.get('/api/punch-requests', auth, async (req, res) => {
  const query = req.user.role === 'admin' ? {} : { employee: req.user._id };
  const requests = await PunchRequest.find(query).sort({ createdAt: -1 }).limit(300).populate('employee', 'name email').populate('reviewedBy', 'name');
  res.json({ requests });
});
app.patch('/api/punch-requests/:id/review', auth, adminOnly, async (req, res) => {
  const { decision, reviewNote = '' } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  const request = await PunchRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'This request has already been reviewed.' });
  if (decision === 'approved') {
    const record = await Attendance.findOne({ employee: request.employee, date: request.date }) || new Attendance({ employee: request.employee, date: request.date });
    if (request.punchType === 'clockIn') {
      if (record.clockIn && new Date(record.clockIn).getTime() !== new Date(request.requestedTime).getTime()) return res.status(409).json({ error: 'A different clock-in already exists. Resolve the record manually first.' });
      record.clockIn = request.requestedTime;
    } else {
      if (!record.clockIn) return res.status(409).json({ error: 'Approve or add the missing clock-in before clock-out.' });
      if (record.clockOut && new Date(record.clockOut).getTime() !== new Date(request.requestedTime).getTime()) return res.status(409).json({ error: 'A different clock-out already exists. Resolve the record manually first.' });
      if (new Date(request.requestedTime) < new Date(record.clockIn)) return res.status(400).json({ error: 'Clock-out cannot be earlier than clock-in.' });
      record.clockOut = request.requestedTime;
    }
    const employee = await User.findById(request.employee);
    const start = Number(employee.shift.start.slice(0, 2)) * 60 + Number(employee.shift.start.slice(3, 5));
    record.status = record.clockIn && localMinutes(new Date(record.clockIn)) > start ? 'late' : 'present';
    record.breakMinutes = employee.shift.breakMinutes || 0;
    record.updatedAt = new Date();
    await record.save();
  }
  request.status = decision;
  request.reviewedBy = req.user._id;
  request.reviewNote = String(reviewNote).slice(0, 500);
  await request.save();
  res.json({ request });
});

app.get('/api/admin/employees', auth, adminOnly, async (req, res) => {
  const users = await User.find({ role: 'employee' }).sort({ name: 1 });
  res.json({ employees: users.map(publicUser) });
});
app.post('/api/admin/employees', auth, adminOnly, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return res.status(400).json({ error: 'Name, valid email and password (at least 10 characters) are required.' });
  try {
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'employee' });
    res.status(201).json({ employee: publicUser(user) });
  } catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'An account with that email already exists.' }); throw e; }
});
app.patch('/api/admin/employees/:id/shift', auth, adminOnly, async (req, res) => {
  const { start, end, breakMinutes } = req.body;
  const validTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!validTime(start) || !validTime(end) || start === end || !Number.isInteger(Number(breakMinutes)) || Number(breakMinutes) < 0 || Number(breakMinutes) > 300) return res.status(400).json({ error: 'Provide valid shift start/end times and break minutes (0–300).' });
  const user = await User.findOne({ _id: req.params.id, role: 'employee' });
  if (!user) return res.status(404).json({ error: 'Employee not found.' });
  user.shift = { start, end, breakMinutes: Number(breakMinutes) };
  await user.save();
  res.json({ employee: publicUser(user) });
});
app.use('/api', (err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  connectDatabase()
    .then(() => app.listen(PORT, () => console.log(`Attendance app running at http://localhost:${PORT} (timezone: ${TZ})`)))
    .catch(err => {
      console.error('MongoDB connection failed:', err.message);
      process.exit(1);
    });
}

module.exports = { app, connectDatabase };
