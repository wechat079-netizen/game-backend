const express = require('express');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Firebase Admin Setup (Project: right-2c598)
// -------------------------------------------------------------
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://right-2c598-default-rtdb.firebaseio.com" // Project ID right-2c598 သို့ ပြောင်းလဲထားပါသည်
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
let userBetsHistory = {}; // UID အလိုက် မှတ်တမ်း
// -------------------------------------------------------------
// Auto Game Loop Engine (စက္ကန့်အလိုက် Result ထုတ်ပေးခြင်း)
// -------------------------------------------------------------
function startGameEngine(gameType) {
    const intervalSec = gameType === '30s' ? 30 : 60;
    let lastProcessedRound = null;

    setInterval(async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor(nowSec / intervalSec);
        const timer = intervalSec - (nowSec % intervalSec);

        // Timer 1 စက္ကန့် ရောက်ပါက ရလဒ် ထွက်ပြီး ငွေရှင်းပေးမည်
        if (timer === 1 && lastProcessedRound !== currentRound) {
            lastProcessedRound = currentRound;

            let winningNumber, resultColor, resultBS;
            const forced = forcedResults[gameType];

            // 1. Admin မှ Control လုပ်ထားပါက Forced Result ယူမည်
            if (forced && (forced.number !== undefined && forced.number !== null && forced.number !== "")) {
                winningNumber = parseInt(forced.number);
            } else if (forced && forced.choice) {
                // Admin က Choice (BIG/SMALL/GREEN/RED/VIOLET) ပေးထားပါက
                let c = forced.choice.toUpperCase();
                if (c === "BIG") winningNumber = 5 + Math.floor(Math.random() * 5); // 5 - 9
                else if (c === "SMALL") winningNumber = Math.floor(Math.random() * 5); // 0 - 4
                else if (c === "GREEN") winningNumber = [1, 3, 7, 9][Math.floor(Math.random() * 4)];
                else if (c === "RED") winningNumber = [2, 4, 6, 8][Math.floor(Math.random() * 4)];
                else if (c === "VIOLET") winningNumber = [0, 5][Math.floor(Math.random() * 2)];
                else winningNumber = Math.floor(Math.random() * 10);
            } else {
                // 2. Auto Random ရွေးချယ်ခြင်း
                winningNumber = Math.floor(Math.random() * 10);
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

            // Game History ထဲသို့ အသစ် ထည့်သွင်းခြင်း
            const historyItem = {
                round: currentRound,
                number: winningNumber,
                bs: resultBS,
                color: resultColor
            };
            
            if (!gameHistory[gameType]) gameHistory[gameType] = [];
            gameHistory[gameType].unshift(historyItem);
            if (gameHistory[gameType].length > 30) gameHistory[gameType].pop(); // နောက်ဆုံး ၃၀ ခု သိမ်းမည်

            // Bet ထိုးထားသူများကို နိုင်/ရှုံး စစ်ဆေးပြီး ငွေပေါင်းပေးခြင်း
            await settleBetsEngine(gameType, currentRound, winningNumber, resultColor, resultBS);

            // Round ပြီးသွားပါက Memory Clear ပြုလုပ်ခြင်း
            activeBets[gameType] = [];
            forcedResults[gameType] = null;
        }
    }, 1000);
}

// Game Loop များ စတင်ခြင်း
startGameEngine('30s');
startGameEngine('60s');

// -------------------------------------------------------------
// Settle Bets Engine (နိုင်သူများကို 1.95x / 9x ငွေပြန်ပေါင်းပေးမည့် Logic)
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

            // --- နိုင်/ရှုံး စစ်ဆေးသည့် Logic ---
            if (choice === resultBS) {
                isWin = true; // BIG or SMALL (1.95x)
            } else if (choice === resultColor) {
                isWin = true; // GREEN, VIOLET, RED (1.95x)
            } else if (choice === String(winningNumber)) {
                isWin = true; // ဂဏန်း အတိအကျ 0 - 9 (9x)
            }

            bet.status = isWin ? 'Win' : 'Lose';

            // User My History ထဲတွင် Status (Win / Lose) ပြောင်းပေးခြင်း
            if (userBetsHistory[userId]) {
                let uBet = userBetsHistory[userId].find(b => b.round === roundNumber && b.gameType === gameType);
                if (uBet) uBet.status = bet.status;
            }

            // --- နိုင်ပါက Firebase Realtime Database 'user/{uid}/money' ထဲသို့ ပေါင်းပေးခြင်း ---
            if (isWin) {
                let winMultiplier = (choice === String(winningNumber)) ? 9.0 : 1.95;
                let winAmount = amount * winMultiplier;

                if (admin.apps.length > 0) {
                    const userMoneyRef = admin.database().ref(`user/${userId}/money`);
                    await userMoneyRef.transaction((currentMoney) => {
                        let val = parseFloat(currentMoney);
                        if (isNaN(val)) val = 0;
                        return val + winAmount;
                    });
                    console.log(`[WIN SUCCESS] User ${userId} received +${winAmount} MMK`);
                } else {
                    console.log(`[ERROR] Firebase Admin Not Initialized! Could not credit ${userId}`);
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

// (A) User Data Request (Round, Timer, Game History & My History)
app.get('/api/user/get-data', (req, res) => {
    const gameType = req.query.gameType || '30s';
    const uid = req.query.uid;
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    let myHistory = [];
    if (uid && userBetsHistory[uid]) {
        myHistory = userBetsHistory[uid].filter(b => b.gameType === gameType).slice(0, 20);
    }

    res.json({
        round: currentRound,
        timer: timer,
        history: gameHistory[gameType] || [],
        myHistory: myHistory
    });
});

app.post('/api/place-bet', async (req, res) => {
    const { uid, choice, amount, gameType } = req.body;
    const type = gameType || '30s';

    if (!uid || !choice || !amount) {
        return res.status(400).json({ success: false, message: "အချက်အလက် မစုံလင်ပါ!" });
    }

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
        return res.status(400).json({ success: false, message: "ထိုးငွေ ပမာဏ မမှန်ကန်ပါ!" });
    }

    if (admin.apps.length > 0) {
        const userMoneyRef = admin.database().ref(`user/${uid}/money`);
        await userMoneyRef.transaction((currentMoney) => {
            let val = parseFloat(currentMoney);
            if (isNaN(val)) val = 0;
            return val - betAmount; // ငွေပေါင်းတဲ့နေရာမှာ + လုပ်သလို ဒီမှာ - လုပ်ပေးလိုက်ပါသည်
        });
        console.log(`[BET SUCCESS] User ${uid} deducted -${betAmount} MMK`);
    }

    const interval = type === '30s' ? 30 : 60;
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);

    const betData = {
        round: currentRound,
        choice: String(choice).trim().toUpperCase(),
        amount: betAmount,
        gameType: type,
        status: 'Pending',
        time: Date.now()
    };

    activeBets[type].push({ uid, ...betData });

    if (!userBetsHistory[uid]) userBetsHistory[uid] = [];
    userBetsHistory[uid].unshift(betData);

    return res.json({ success: true, message: "ထိုးကြေး အောင်မြင်စွာ တင်ပြီးပါပြီ!" });
});

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
        if (forced.number !== undefined && forced.number !== null && forced.number !== "") forcedStr = `ဂဏန်း (${forced.number})`;
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
