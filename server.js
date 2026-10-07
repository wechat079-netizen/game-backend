const express = require('express');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Admin Setup
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized!");
    } catch (e) {
        console.log("Firebase Error:", e.message);
    }
}

// Memory Store
let activeBets = { '30s': [], '60s': [] };
let forcedResults = { '30s': null, '60s': null };
let gameHistory = { '30s': [], '60s': [] };
let userBetsHistory = {}; // UID အလိုက် မှတ်တမ်းထားရှိရန်

// -------------------------------------------------------------
// 1. APP / USER ENDPOINTS
// -------------------------------------------------------------

// (A) User Data Request (Round, Timer & Game History သာ ပါဝင်မည် - Total မပါပါ)
app.get('/api/user/get-data', (req, res) => {
    const gameType = req.query.gameType || '30s';
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    res.json({
        round: currentRound,
        timer: timer,
        history: gameHistory[gameType] || []
    });
});

// (B) User My History Request (မိမိထိုးထားသည့် စာရင်း)
app.get('/api/user/my-history', (req, res) => {
    const uid = req.query.uid;
    const gameType = req.query.gameType || '30s';
    
    if (!uid) return res.status(400).json({ success: false, message: "UID လိုအပ်ပါသည်။" });
    
    const userHistory = (userBetsHistory[uid] || []).filter(b => b.gameType === gameType);
    res.json({ success: true, history: userHistory });
});

// (C) Place Bet Endpoint (ထိုးကြေး တင်ခြင်း)
app.post('/api/place-bet', (req, res) => {
    const { uid, choice, amount, gameType } = req.body;
    const type = gameType || '30s';

    if (!uid || !choice || !amount) {
        return res.status(400).json({ success: false, message: "အချက်အလက် မစုံလင်ပါ!" });
    }

    const interval = type === '30s' ? 30 : 60;
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);

    const betData = {
        round: currentRound,
        choice: choice.toUpperCase(),
        amount: parseFloat(amount),
        gameType: type,
        status: 'Pending',
        time: Date.now()
    };

    // Active Bet စာရင်းထဲထည့်ခြင်း
    activeBets[type].push({ uid, ...betData });

    // User My History ထဲထည့်ခြင်း
    if (!userBetsHistory[uid]) userBetsHistory[uid] = [];
    userBetsHistory[uid].unshift(betData);

    return res.json({ success: true, message: "ထိုးကြေး အောင်မြင်စွာ တင်ပြီးပါပြီ!" });
});


// -------------------------------------------------------------
// 2. ADMIN ENDPOINTS
// -------------------------------------------------------------

// Admin Get Data Endpoint (Totals, Round, Timer, Active Bets အကုန်ပါမည်)
app.get('/api/admin/get-data', (req, res) => {
    const gameType = req.query.gameType || '30s';
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    // Round ပြောင်းပါက Active Bets ရှင်းပေးခြင်း
    if (timer === interval) {
        activeBets[gameType] = [];
    }

    const bets = activeBets[gameType] || [];

    // Total Bets Calculation (BIG, SMALL, GREEN, VIOLET)
    let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
    bets.forEach(b => {
        const c = b.choice.toUpperCase();
        if (totals[c] !== undefined) {
            totals[c] += b.amount;
        }
    });

    const forced = forcedResults[gameType];
    let forcedStr = "Auto (မပြင်ထားပါ)";
    if (forced) {
        if (forced.choice) forcedStr = forced.choice;
        if (forced.number !== undefined) forcedStr = `ဂဏန်း (${forced.number})`;
    }

    res.json({
        round: currentRound,
        timer: timer,
        forced: forcedStr,
        totals: totals,
        bets: bets
    });
});

// Admin Set Result Endpoint
app.post('/api/admin/set-result', (req, res) => {
    const { gameType, choice, number } = req.body;
    if (gameType) {
        forcedResults[gameType] = { choice, number };
        return res.json({ success: true, message: `${gameType} အတွက် ရလဒ် သတ်မှတ်ပြီးပါပြီ!` });
    }
    return res.status(400).json({ success: false, message: "Game Type မှားယွင်းနေပါသည်!" });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
