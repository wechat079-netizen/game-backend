const express = require('express');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Firebase Admin Setup (ENV သို့မဟုတ် တိုက်ရိုက် ကြေညာခြင်း)
// -------------------------------------------------------------
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://mlb-challenge-myanmar-default-rtdb.firebaseio.com" // မိမိ Firebase DB URL စစ်ဆေးပါ
        });
        console.log("Firebase Admin Initialized Successfully!");
    } catch (e) {
        console.log("Firebase Init Error:", e.message);
    }
} else {
    console.log("WARNING: FIREBASE_CONFIG is missing in Environment Variables!");
}

// Memory Stores
let activeBets = { '30s': [], '60s': [] };
let forcedResults = { '30s': null, '60s': null };
let gameHistory = { '30s': [], '60s': [] };
let userBetsHistory = {}; // UID အလိုက် စာရင်း

// -------------------------------------------------------------
// Auto Game Loop & Win Settlement
// -------------------------------------------------------------
function startGameEngine(gameType) {
    const intervalSec = gameType === '30s' ? 30 : 60;
    let lastProcessedRound = null;

    setInterval(async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor(nowSec / intervalSec);
        const timer = intervalSec - (nowSec % intervalSec);

        // စက္ကန့် ကုန်ခါနီး (1 စက္ကန့်) တွင် Result ထုတ်ပြီး ငွေရှင်းပေးမည်
        if (timer === 1 && lastProcessedRound !== currentRound) {
            lastProcessedRound = currentRound;

            let winningNumber, resultColor, resultBS;
            const forced = forcedResults[gameType];

            // Admin မှ ကြိုတင် သတ်မှတ်ထားသော Result စစ်ဆေးခြင်း
            if (forced && forced.number !== undefined && forced.number !== null) {
                winningNumber = parseInt(forced.number);
            } else {
                winningNumber = Math.floor(Math.random() * 10); // 0 - 9 Random
            }

            // Color & BS တွက်ချက်ခြင်း Logic
            if (winningNumber === 0 || winningNumber === 5) {
                resultColor = "VIOLET";
            } else if (winningNumber % 2 === 0) {
                resultColor = "RED";
            } else {
                resultColor = "GREEN";
            }

            resultBS = winningNumber >= 5 ? "BIG" : "SMALL";

            // Game History ထဲ ထည့်သွင်းခြင်း
            const historyItem = {
                round: currentRound,
                number: winningNumber,
                bs: resultBS,
                color: resultColor
            };
            
            if (!gameHistory[gameType]) gameHistory[gameType] = [];
            gameHistory[gameType].unshift(historyItem);
            if (gameHistory[gameType].length > 20) gameHistory[gameType].pop();

            // Bet တင်ထားသူများကို နိုင်/ရှုံး စစ်ပြီး ငွေပေါင်းပေးခြင်း
            await settleBetsEngine(gameType, currentRound, winningNumber, resultColor, resultBS);

            // Round ပြီးသွားပါက Memory ရှင်းပေးခြင်း
            activeBets[gameType] = [];
            forcedResults[gameType] = null;
        }
    }, 1000);
}

// Game Loop စတင်ခြင်း
startGameEngine('30s');
startGameEngine('60s');

// -------------------------------------------------------------
// Settle Bets Function (နိုင်ပါက ငွေပေါင်းပေးမည့် Logic)
// -------------------------------------------------------------
async function settleBetsEngine(gameType, roundNumber, winningNumber, resultColor, resultBS) {
    try {
        const currentBets = activeBets[gameType] || [];
        if (currentBets.length === 0) return;

        console.log(`[Round ${roundNumber}] Processing ${currentBets.length} bets for ${gameType}...`);

        for (let bet of currentBets) {
            let userId = bet.uid;
            let amount = parseFloat(bet.amount || 0);
            let choice = String(bet.choice || '').trim().toUpperCase();
            let isWin = false;

            // --- နိုင်/ရှုံး စစ်ဆေးသည့် Logic (တိကျစွာ စစ်ပေးထားပါသည်) ---
            if (choice === resultBS) {
                isWin = true; // BIG or SMALL
            } else if (choice === resultColor) {
                isWin = true; // GREEN, VIOLET, RED
            } else if (choice === String(winningNumber)) {
                isWin = true; // 0 - 9 ဂဏန်း အတိအကျ
            }

            bet.status = isWin ? 'Win' : 'Lose';

            // User My History ထဲတွင် Status Update ပြုလုပ်ခြင်း
            if (userBetsHistory[userId]) {
                let uBet = userBetsHistory[userId].find(b => b.round === roundNumber && b.gameType === gameType);
                if (uBet) uBet.status = bet.status;
            }

            // --- နိုင်ပါက Firebase Realtime Database 'user/{uid}/money' ထဲသို့ ပေါင်းပေးခြင်း ---
            if (isWin) {
                let winMultiplier = 1.95; // BIG/SMALL/COLOR အတွက် 1.95x
                if (choice === String(winningNumber)) winMultiplier = 9.0; // ဂဏန်းအမှန် မှန်းနိုင်ပါက 9x

                let winAmount = amount * winMultiplier;

                if (admin.apps.length > 0) {
                    const userMoneyRef = admin.database().ref(`user/${userId}/money`);
                    await userMoneyRef.transaction((currentMoney) => {
                        let val = parseFloat(currentMoney);
                        if (isNaN(val)) val = 0;
                        return val + winAmount;
                    });
                    console.log(`[WIN SUCCESS] User ${userId} received ${winAmount} MMK`);
                } else {
                    console.log(`[ERROR] Firebase Admin Not Initialized! Cannot credit user ${userId}`);
                }
            }
        }
    } catch (error) {
        console.error("Settle Bets Error:", error);
    }
}

// -------------------------------------------------------------
// 1. APP / USER ENDPOINTS
// -------------------------------------------------------------

// (A) User Data Request
app.get('/api/user/get-data', (req, res) => {
    const gameType = req.query.gameType || '30s';
    const uid = req.query.uid;
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    let myHistory = [];
    if (uid && userBetsHistory[uid]) {
        myHistory = userBetsHistory[uid].filter(b => b.gameType === gameType).slice(0, 15);
    }

    res.json({
        round: currentRound,
        timer: timer,
        history: gameHistory[gameType] || [],
        myHistory: myHistory
    });
});

// (B) Place Bet Endpoint
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
        choice: String(choice).trim().toUpperCase(),
        amount: parseFloat(amount),
        gameType: type,
        status: 'Pending',
        time: Date.now()
    };

    activeBets[type].push({ uid, ...betData });

    if (!userBetsHistory[uid]) userBetsHistory[uid] = [];
    userBetsHistory[uid].unshift(betData);

    return res.json({ success: true, message: "ထိုးကြေး အောင်မြင်စွာ တင်ပြီးပါပြီ!" });
});

// -------------------------------------------------------------
// 2. ADMIN ENDPOINTS
// -------------------------------------------------------------

app.get('/api/admin/get-data', (req, res) => {
    const gameType = req.query.gameType || '30s';
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    const bets = activeBets[gameType] || [];

    let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0, RED: 0 };
    bets.forEach(b => {
        const c = b.choice.toUpperCase();
        if (totals[c] !== undefined) totals[c] += b.amount;
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
