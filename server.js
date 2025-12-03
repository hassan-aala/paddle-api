require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(()=>console.log('Mongo connected'))
  .catch(err=>console.log(err));

// Models
const Slot = mongoose.model('Slot', new mongoose.Schema({
  date: String,               // YYYY-MM-DD
  hour: Number,               // 11 .. 25
  status: {type:String, enum:['FREE','HOLD','BOOKED'], default:'FREE'},
  booking: {type: mongoose.Schema.Types.ObjectId, ref:'Booking'}
}));
const Booking = mongoose.model('Booking', new mongoose.Schema({
  slotId: String,
  name: String,
  phone: String,
  token: String,
  status: {type:String, enum:['PENDING_TOKEN','PAID'], default:'PENDING_TOKEN'},
  date: String,
  hour: Number
}));



// ROUTES
// 1. Get slots for a day
app.get('/slots', async (req,res)=>{
  const {date} = req.query; // YYYY-MM-DD
  const slots = await Slot.find({date}).sort({hour:1});
  if (slots.length === 0){               // auto-create first time
    for (let h=11; h<=25; h++){
      await Slot.create({date, hour: h});
    }
    return res.json(await Slot.find({date}).sort({hour:1}));
  }
  res.json(slots);
});

// 2. Hold a slot (token path)
app.post('/hold', async (req,res)=>{
  const {slotId, name, phone} = req.body;
  const token = Math.random().toString(36).substr(2,6).toUpperCase();
  const slot = await Slot.findById(slotId);
  if (slot.status !== 'FREE') return res.status(400).json({msg:'Slot gone'});
  const booking = await Booking.create({slotId, name, phone, token, date: slot.date, hour: slot.hour});
  slot.status = 'HOLD'; slot.booking = booking._id; await slot.save();
  res.json({token, expiresAt: Date.now() + 10*60*1000});
});

// 3. JazzCash sandbox redirect (online path)
app.post('/pay', async (req,res)=>{
  const {slotId, name, phone} = req.body;
  const slot = await Slot.findById(slotId);
  if (slot.status !== 'FREE') return res.status(400).json({msg:'Slot gone'});
  const booking = await Booking.create({slotId, name, phone, date: slot.date, hour: slot.hour});
  slot.status = 'HOLD'; slot.booking = booking._id; await slot.save();

   /*  >>>  WRAP FROM HERE  <<<  */
  if (!process.env.JAZZ_STORE_ID || !process.env.JAZZ_PASSWORD) {
    return res.status(501).json({msg: 'Online payment not configured yet'});
  }

  // build JazzCash sandbox URL
  const price = 1200;
  const billRef = booking._id.toString();
  const jwt = require('jsonwebtoken');
  const credentials = `${process.env.JAZZ_STORE_ID}:${process.env.JAZZ_PASSWORD}`; // sandbox
  const returnUrl = `${process.env.FRONTEND}/success`;
  const url = `https://sandbox.jazzcash.com.pk/PayThroughAPI/?amount=${price}&bill_reference=${billRef}&return_url=${returnUrl}&credentials=${credentials}`;
  res.json({redirectUrl: url});
});

// 4. JazzCash webhook
app.post('/webhook/jazz', async (req,res)=>{
  if (req.body.pp_ResponseCode !== '000') return res.send('FAIL');
  const booking = await Booking.findByIdAndUpdate(req.body.pp_BillReference, {status:'PAID'});
  res.send('OK');
});

// 5. Admin mark token paid
app.post('/admin/paid', async (req,res)=>{
  if (req.headers.password !== process.env.ADMIN_PASS) return res.status(401).json({msg:'Nope'});
  const {token} = req.body;
  const booking = await Booking.findOneAndUpdate({token}, {status:'PAID'});
  if (!booking) return res.status(404).json({msg:'Token not found'});
  await Slot.findByIdAndUpdate(booking.slotId, {status:'BOOKED'});
  res.json({msg:'Marked paid'});
});

// 6. Admin unpaid list
app.get('/admin/unpaid', async (req,res)=>{
  if (req.headers.password !== process.env.ADMIN_PASS) return res.status(401).json({msg:'Nope'});
  const list = await Booking.find({status:'PENDING_TOKEN'});
  res.json(list);
});

// START
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log(`API on ${PORT}`));