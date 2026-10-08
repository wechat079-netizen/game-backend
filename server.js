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
            databaseURL: "https://right-2c598-default-rtdb.firebaseio.com"
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
let userBetsHistory = {}; 

// -------------------------------------------------------------
// Auto Game Loop Engine (ထိုးကြေးအနည်းဆုံးဘက်ကို အနိုင်ပေးခြင်း Logic)
// -------------------------------------------------------------
function startGameEngine(gameType) {
    const intervalSec = gameType === '30s' ? 30 : 60;
    let lastProcessedRound = null;

    setInterval(async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor(nowSec / intervalSec);
        const timer = intervalSec - (nowSec % intervalSec);

        if (timer === 1 && lastProcessedRound !== currentRound) {
            lastProcessedRound = currentRound;

            let winningNumber, resultColor, resultBS;
            const forced = forcedResults[gameType];

            // 1. Admin မှ Control လုပ်ထားပါက Forced Result ယူမည်
            if (forced && (forced.number !== undefined && forced.number !== null && forced.number !== "")) {
                winningNumber = parseInt(forced.number);
            } else if (forced && forced.choice) {
                let c = forced.choice.toUpperCase();
                if (c === "BIG") winningNumber = 5 + Math.floor(Math.random() * 5);
                else if (c === "SMALL") winningNumber = Math.floor(Math.random() * 5);
                else winningNumber = Math.floor(Math.random() * 10);
            } else {
                // 2. Auto Logic: ရွေးချယ်စရာ အားလုံး (0 မှ 9 ထိ) ကို ထိုးငွေ စုစုပေါင်း တွက်မည်
                const currentBets = activeBets[gameType] || [];
                
                let totals = { 
                    '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, 
                    '5': 0, '6': 0, '7': 0, '8': 0, '9': 0,
                    'BIG': 0, 'SMALL': 0, 'GREEN': 0, 'VIOLET': 0 
                };

                currentBets.forEach(b => {
                    let choice = String(b.choice || '').trim().toUpperCase();
                    let amt = parseFloat(b.amount || 0);
                    if (totals[choice] !== undefined) {
                        totals[choice] += amt;
                    }
                });

                // ဂဏန်း 0 မှ 9 ထဲမှ ထိုးငွေ အနည်းဆုံး (Lowest Bet) ဖြစ်သည့် ဂဏန်းကို ရှာမည်
                let minBet = Infinity;
                let bestNumbers = [];

                for (let num = 0; num <= 9; num++) {
                    let betSum = totals[String(num)] || 0;
                    
                    // BIG / SMALL နှင့် အရောင် ထိုးထားမှုများကိုပါ သက်ဆိုင်ရာ ဂဏန်းများဆီသို့ ထည့်သွင်း စဉ်းစားမည်
                    if (num >= 5) {
                        betSum += (totals['BIG'] || 0);
                    } else {
                        betSum += (totals['SMALL'] || 0);
                    }

                    if (num === 0 || num === 2 || num === 4 || num === 6 || num === 8) {
                        betSum += (totals['GREEN'] || 0);
                    } else {
                        betSum += (totals['VIOLET'] || 0);
                    }

                    if (betSum < minBet) {
                        minBet = betSum;
                        bestNumbers = [num];
                    } else if (betSum === minBet) {
                        bestNumbers.push(num);
                    }
                }

                // ထိုးကြေးအနည်းဆုံး ဂဏန်းများထဲမှ ကျပန်း တစ်ခုယူမည်
                winningNumber = bestNumbers[Math.floor(Math.random() * bestNumbers.length)];
            }

            // အရောင်နှင့် Big/Small သတ်မှတ်ခြင်း (0, 2, 4, 6, 8 = GREEN / 1, 3, 5, 7, 9 = VIOLET)
            if (winningNumber === 0 || winningNumber === 2 || winningNumber === 4 || winningNumber === 6 || winningNumber === 8) {
                resultColor = "GREEN";
            } else {
                resultColor = "VIOLET";
            }

            resultBS = winningNumber >= 5 ? "BIG" : "SMALL";

            const historyItem = {
                round: currentRound,
                number: winningNumber,
                bs: resultBS,
                color: resultColor
            };
            
            if (!gameHistory[gameType]) gameHistory[gameType] = [];
            gameHistory[gameType].unshift(historyItem);
            if (gameHistory[gameType].length > 30) gameHistory[gameType].pop();

            await settleBetsEngine(gameType, currentRound, winningNumber, resultColor, resultBS);

            activeBets[gameType] = [];
            forcedResults[gameType] = null;
        }
    }, 1000);
}

// Game Loop များ စတင်ခြင်း
startGameEngine('30s');
startGameEngine('60s');

// -------------------------------------------------------------
// Settle Bets Engine
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

            if (choice === resultBS) {
                isWin = true; 
            } else if (choice === resultColor) {
                isWin = true; 
            } else if (choice === String(winningNumber)) {
                isWin = true; 
            }

            bet.status = isWin ? 'Win' : 'Lose';

            if (userBetsHistory[userId]) {
                let uBet = userBetsHistory[userId].find(b => b.round === roundNumber && b.gameType === gameType);
                if (uBet) uBet.status = bet.status;
            }

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
            return val - betAmount;
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
