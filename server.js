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

// Memory Store for Bets & Forced Results
let activeBets = { '30s': [], '60s': [] };
let forcedResults = { '30s': null, '60s': null };

// 1. App Bet Endpoint (App မှ ထိုးကြေး တင်သည့် API)
app.post('/api/place-bet', (req, res) => {
    const { uid, choice, amount, gameType } = req.body; // gameType: '30s' or '60s'
    const type = gameType || '30s';

    if (!uid || !choice || !amount) {
        return res.status(400).json({ success: false, message: "အချက်အလက် မစုံလင်ပါ!" });
    }

    // Save to active bets
    activeBets[type].push({
        uid: uid,
        choice: choice.toUpperCase(),
        amount: parseFloat(amount),
        time: Date.now()
    });

    return res.json({ success: true, message: "ထိုးကြေး တင်ပြီးပါပြီ!" });
});

// 2. Admin Get Data Endpoint (Round, Totals & Live Bets)
app.get('/api/admin/get-data', (req, res) => {
    const gameType = req.query.gameType || '30s';
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    // Timer Round ပြောင်းသွားလျှင် Active Bets များကို ရှင်းပေးခြင်း
    if (timer === interval) {
        activeBets[gameType] = [];
    }

    const bets = activeBets[gameType] || [];

    // Total Bets Calculation (BIG, SMALL, RED, GREEN, VIOLET)
    let totals = { BIG: 0, SMALL: 0, RED: 0, GREEN: 0, VIOLET: 0 };

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

// 3. Admin Set Result Endpoint
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
