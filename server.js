const express = require('express');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Firebase Admin Setup (Database URL ပါဝင်ပါသည်)
// -------------------------------------------------------------
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://mlb-challenge-myanmar-default-rtdb.firebaseio.com" // မိမိ Firebase DB URL ထည့်ပါ
        });
        console.log("Firebase Admin Initialized Successfully!");
    } catch (e) {
        console.log("Firebase Error:", e.message);
    }
}

// Memory Stores
let activeBets = { '30s': [], '60s': [] };
let forcedResults = { '30s': null, '60s': null };
let gameHistory = { '30s': [], '60s': [] };
let userBetsHistory = {}; // UID အလိုက် စာရင်း

// -------------------------------------------------------------
// Auto Game Loop & Win Settlement (စက္ကန့်အလိုက် Result ထွက်ပြီး ငွေရှင်းပေးခြင်း)
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

            // Admin မှ ကြိုတင် သတ်မှတ်ထားသော Result ရှိမရှိ စစ်ဆေးခြင်း
            if (forced && forced.number !== undefined && forced.number !== null) {
                winningNumber = parseInt(forced.number);
            } else {
                winningNumber = Math.floor(Math.random() * 10); // 0 - 9 Random
            }

            // Color & BS တွက်ချက်ခြင်း
            if (winningNumber === 0) resultColor = "VIOLET";
            else if (winningNumber === 5) resultColor = "VIOLET";
            else if (winningNumber % 2 === 0) resultColor = "RED";
            else resultColor = "GREEN";

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
            if (gameHistory[gameType].length > 20) gameHistory[gameType].pop(); // နောက်ဆုံး ၂၀ ခုပဲသိမ်းမည်

            // Bet တင်ထားသူများကို နိုင်/ရှုံး စစ်ပြီး ငွေပေါင်းပေးခြင်း
            await settleBetsEngine(gameType, currentRound, winningNumber, resultColor, resultBS);

            // Round ပြီးသွားပြီဖြစ်၍ Memory မီးစိမ်းရှင်းခြင်း
            activeBets[gameType] = [];
            forcedResults[gameType] = null;
        }
    }, 1000);
}

// Game Loop များကို စတင်ခြင်း
startGameEngine('30s');
startGameEngine('60s');

// -------------------------------------------------------------
// Settle Bets Function (နိုင်ရင် 1.95x အလိုအလျောက် ငွေပေါင်းပေးမည့် Logic)
// -------------------------------------------------------------
async function settleBetsEngine(gameType, roundNumber, winningNumber, resultColor, resultBS) {
    try {
        const currentBets = activeBets[gameType] || [];
        if (currentBets.length === 0) return;

        console.log(`[Round ${roundNumber}] Processing ${currentBets.length} bets...`);

        for (let bet of currentBets) {
            let userId = bet.uid;
            let amount = parseFloat(bet.amount || 0);
            let choice = String(bet.choice || '').toUpperCase();
            let isWin = false;

            // --- နိုင်/ရှုံး စစ်ဆေးခြင်း ---
            if (choice === resultBS.toUpperCase()) isWin = true;
            else if (choice === resultColor.toUpperCase()) isWin = true;
            else if (choice === String(winningNumber)) isWin = true;

            // Status ပြောင်းလဲခြင်း
            bet.status = isWin ? 'Win' : 'Lose';

            // User My History ထဲတွင် Update လုပ်ခြင်း
            if (userBetsHistory[userId]) {
                let uBet = userBetsHistory[userId].find(b => b.round === roundNumber && b.gameType === gameType);
                if (uBet) uBet.status = bet.status;
            }

            // --- နိုင်ပါက Firebase 'money' ထဲသို့ 1.95x ပြန်ပေါင်းပေးခြင်း ---
            if (isWin && admin.apps.length > 0) {
                let winAmount = amount * 1.95; // 100 ထိုးရင် 195 ကျပ် ပြန်ပေါင်းပေးမည်
                
                const userMoneyRef = admin.database().ref(`user/${userId}/money`);
                await userMoneyRef.transaction((currentMoney) => {
                    let val = parseFloat(currentMoney);
                    if (isNaN(val)) val = 0;
                    return val + winAmount;
                });

                console.log(`User ${userId} Won ${winAmount} MMK!`);
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
        myHistory = userBetsHistory[uid].filter(b => b.gameType === gameType).slice(0, 15);
    }

    res.json({
        round: currentRound,
        timer: timer,
        history: gameHistory[gameType] || [],
        myHistory: myHistory
    });
});

// (B) Place Bet Endpoint (ထိုးကြေး တင်ခြင်း)
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
        choice: String(choice).toUpperCase(),
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
