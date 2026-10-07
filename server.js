const express = require('express');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
                // Admin က BIG / SMALL / GREEN / VIOLET သာ သတ်မှတ်နိုင်ပါသည်
                let c = forced.choice.toUpperCase();
                if (c === "BIG") winningNumber = 5 + Math.floor(Math.random() * 5);
                else if (c === "SMALL") winningNumber = Math.floor(Math.random() * 5);
                else if (c === "GREEN") winningNumber = [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)];
                else if (c === "VIOLET") winningNumber = [1, 3, 5, 7, 9][Math.floor(Math.random() * 5)];
                else winningNumber = Math.floor(Math.random() * 10);
            } else {
                // 2. Auto Random ရွေးချယ်ခြင်း
                winningNumber = Math.floor(Math.random() * 10);
            }

            // Color & BS တွက်ချက်ခြင်း Logic
            // စုံဂဏန်း = GREEN၊ မဂဏန်း = VIOLET
            resultColor = winningNumber % 2 === 0 ? "GREEN" : "VIOLET";

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
                isWin = true; // GREEN or VIOLET (1.95x)
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

// (B) Place Bet Endpoint (ထိုးကြေးတင်ချိန်တွင် ငွေချက်ချင်းနုတ်မည်)
app.all('/api/place-bet', async (req, res) => {
    try {
        const uid = req.body.uid || req.query.uid;
        const choice = req.body.choice || req.query.choice;
        const rawAmount = req.body.amount || req.query.amount;
        const type = req.body.gameType || req.query.gameType || '30s';
        const allowedChoices = ['BIG', 'SMALL', 'GREEN', 'VIOLET'];
        const normalizedChoice = String(choice || '').trim().toUpperCase();
        const betAmount = Number(rawAmount);

        if (!uid || !allowedChoices.includes(normalizedChoice) && !/^\d$/.test(normalizedChoice)) {
            return res.status(400).json({ success: false, message: "ရွေးချယ်မှု မမှန်ကန်ပါ!" });
        }
        if (!['30s', '60s'].includes(type)) {
            return res.status(400).json({ success: false, message: "Game Type မမှန်ကန်ပါ!" });
        }
        if (!Number.isFinite(betAmount) || betAmount <= 0) {
            return res.status(400).json({ success: false, message: "ထိုးငွေ ပမာဏ မမှန်ကန်ပါ!" });
        }
        if (admin.apps.length === 0) {
            return res.status(500).json({ success: false, message: "Firebase Admin ချိတ်ဆက်မှု မရှိသေးပါ!" });
        }

        const db = admin.database();
        const moneyRef = db.ref(`user/${uid}/money`);
        const debitResult = await moneyRef.transaction((currentMoney) => {
            let balance = Number(currentMoney);
            if (!Number.isFinite(balance)) balance = 0;
            if (balance < betAmount) return; // လက်ကျန်မလုံလောက်ပါက transaction မလုပ်ပါ
            return balance - betAmount;
        });

        if (!debitResult.committed) {
            return res.status(400).json({ success: false, message: "လက်ကျန်ငွေ မလုံလောက်ပါ!" });
        }

        const interval = type === '30s' ? 30 : 60;
        const currentRound = Math.floor(Math.floor(Date.now() / 1000) / interval);
        const betData = {
            round: currentRound,
            choice: normalizedChoice,
            amount: betAmount,
            gameType: type,
            status: 'Pending',
            time: Date.now()
        };

        try {
            activeBets[type].push({ uid, ...betData });
            if (!userBetsHistory[uid]) userBetsHistory[uid] = [];
            userBetsHistory[uid].unshift(betData);
        } catch (saveError) {
            // Memory save မအောင်မြင်မှသာ နုတ်ထားသည့်ငွေကို ပြန်အမ်းမည်
            await moneyRef.transaction((currentMoney) => (Number(currentMoney) || 0) + betAmount);
            throw saveError;
        }

        const newBalance = Number(debitResult.snapshot.val()) || 0;
        console.log(`[BET SUCCESS] User ${uid} -${betAmount} MMK; balance=${newBalance}`);
        return res.json({ success: true, message: "ထိုးကြေးအောင်မြင်စွာတင်ပြီးပါပြီ!", balance: newBalance });
    } catch (error) {
        console.error("Place Bet Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
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

    let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
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
    const allowedChoices = ['BIG', 'SMALL', 'GREEN', 'VIOLET'];
    const normalizedChoice = choice ? String(choice).trim().toUpperCase() : '';
    const hasNumber = number !== undefined && number !== null && number !== '';
    const validNumber = !hasNumber || (Number.isInteger(Number(number)) && Number(number) >= 0 && Number(number) <= 9);
    if (!['30s', '60s'].includes(gameType) || (normalizedChoice && !allowedChoices.includes(normalizedChoice)) || !validNumber) {
        return res.status(400).json({ success: false, message: "BIG / SMALL / GREEN / VIOLET သာ အသုံးပြုနိုင်ပါသည်!" });
    }
    forcedResults[gameType] = { choice: normalizedChoice || null, number: hasNumber ? Number(number) : null };
    return res.json({ success: true, message: `${gameType} အတွက် ရလဒ် သတ်မှတ်ပြီးပါပြီ!` });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
