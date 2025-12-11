require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');   // <-- new

const app = express();
app.use(cors());
app.use(express.json());

// Mongo
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Mongo connected'))
  .catch(err => console.log(err));

// Models
const Slot = mongoose.model('Slot', new mongoose.Schema({
  date: String, hour: Number, status: { type: String, enum: ['FREE', 'HOLD', 'BOOKED'], default: 'FREE' }, booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }
}));
const Booking = mongoose.model('Booking', new mongoose.Schema({
  slotId: String, name: String, phone: String, token: String, status: { type: String, enum: ['PENDING_TOKEN', 'PAID'], default: 'PENDING_TOKEN'  }, date: String, hour: Number
}));

// JWT helper
const JWT_SECRET = process.env.JWT_SECRET || 'changeMe';

// ---------- public routes ----------
app.get('/slots', async (req, res) => {
  const { date } = req.query;
  const slots = await Slot.find({ date }).sort({ hour: 1 });
  if (slots.length === 0) {
    for (let h = 11; h <= 25; h++) await Slot.create({ date, hour: h });
    return res.json(await Slot.find({ date }).sort({ hour: 1 }));
  }
  res.json(slots);
});

app.post('/hold', async (req, res) => {
  const { slotId, name, phone } = req.body;
  const slot = await Slot.findById(slotId);
  if (slot.status !== 'FREE') return res.status(400).json({ msg: 'Slot gone' });
  const token = Math.random().toString(36).substr(2, 6).toUpperCase();
  const booking = await Booking.create({ slotId, name, phone, token, date: slot.date, hour: slot.hour });
  slot.status = 'HOLD'; slot.booking = booking._id; await slot.save();
  res.json({ token, expiresAt: Date.now() + 10 * 60 * 1000 });
});

app.post('/pay', async (req, res) => {
  const { slotId, name, phone } = req.body;
  const slot = await Slot.findById(slotId);
  if (slot.status !== 'FREE') return res.status(400).json({ msg: 'Slot gone' });
  const booking = await Booking.create({ slotId, name, phone, date: slot.date, hour: slot.hour });
  slot.status = 'HOLD'; slot.booking = booking._id; await slot.save();

  if (!process.env.JAZZ_STORE_ID || !process.env.JAZZ_PASSWORD)
    return res.status(501).json({ msg: 'Online payment not configured yet' });

  const price = 1200;
  const billRef = booking._id.toString();
  const returnUrl = `${process.env.FRONTEND}/success`;
  const credentials = `${process.env.JAZZ_STORE_ID}:${process.env.JAZZ_PASSWORD}`;
  const url = `https://sandbox.jazzcash.com.pk/PayThroughAPI/?amount=${price}&bill_reference=${billRef}&return_url=${returnUrl}&credentials=${credentials}`;
  res.json({ redirectUrl: url });
});

// ---------- protected admin routes ----------
function requireAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ msg: 'Token required' });
  }
}

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  // simple hard-coded check – move to env later
  if (username === 'desk' && password === 'court123') {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token });
  }
  res.status(401).json({ msg: 'Invalid credentials' });
});

app.get('/admin/unpaid', requireAdmin, async (req, res) => {
  const list = await Booking.find({ status: 'PENDING_TOKEN' });
  res.json(list);
});

app.post('/admin/paid', requireAdmin, async (req, res) => {
  const { token } = req.body;
  const booking = await Booking.findOneAndUpdate({ token }, { status: 'PAID' });
  if (!booking) return res.status(404).json({ msg: 'Token not found' });
  await Slot.findByIdAndUpdate(booking.slotId, { status: 'BOOKED' });
  res.json({ msg: 'Marked paid' });
});

app.get('/admin/all', requireAdmin, async (req, res) => {
  const list = await Booking.find().sort({ createdAt: -1 });
  res.json(list);
});

// ---------- start ----------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API on ${PORT}`));