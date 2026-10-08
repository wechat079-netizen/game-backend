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
// Admin Auth Middleware (လုံခြုံရေးအတွက် Admin Token / Password စစ်ဆေးခြင်း)
// -------------------------------------------------------------
const adminAuth = (req, res, next) => {
    const adminToken = req.headers['x-admin-token'] || req.query.token;
    // သင်အလိုရှိသော Admin Password / Token ကို ဤနေရာတွင် သတ်မှတ်နိုင်ပါသည်။ (ဥပမာ - "my_secret_admin_123")
    const SECRET_ADMIN_KEY = process.env.ADMIN_SECRET || "admin12345"; 

    if (adminToken === SECRET_ADMIN_KEY) {
        next();
    } else {
        res.status(403).json({ success: false, message: "ခွင့်ပြုချက် မရှိပါ (Unauthorized Access)!" });
    }
};

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

            if (forced && (forced.number !== undefined && forced.number !== null && forced.number !== "")) {
                winningNumber = parseInt(forced.number);
            } else if (forced && forced.choice) {
                let c = forced.choice.toUpperCase();
                if (c === "BIG") winningNumber = 5 + Math.floor(Math.random() * 5);
                else if (c === "SMALL") winningNumber = Math.floor(Math.random() * 5);
                else winningNumber = Math.floor(Math.random() * 10);
            } else {
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

                let minBet = Infinity;
                let bestNumbers = [];

                for (let num = 0; num <= 9; num++) {
                    let betSum = totals[String(num)] || 0;
                    
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

                winningNumber = bestNumbers[Math.floor(Math.random() * bestNumbers.length)];
            }

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

startGameEngine('30s');
startGameEngine('60s');

// -------------------------------------------------------------
// Settle Bets Engine
// -------------------------------------------------------------
async function settleBetsEngine(gameType, roundNumber, winningNumber, resultColor, resultBS) {
    try {
        const currentBets = activeBets[gameType] || [];
        if (currentBets.length === 0) return;

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

// 2. ADMIN ENDPOINTS (Admin Auth ဖြင့် ကာကွယ်ထားပြီး UID ကို နာမည် သို့မဟုတ် Mask ပြုလုပ်ခြင်း)
// -------------------------------------------------------------
app.get('/api/admin/get-data', adminAuth, async (req, res) => {
    const gameType = req.query.gameType || '30s';
    const interval = gameType === '30s' ? 30 : 60;
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    const bets = activeBets[gameType] || [];

    let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
    
    // UID အစား Player နာမည် (သို့မဟုတ် ဖုံးကွယ်ထားသော ID) ကို ပြသရန် စီစဉ်ခြင်း
    const sanitizedBets = await Promise.all(bets.map(async (b, index) => {
        const c = b.choice.toUpperCase();
        if (totals[c] !== undefined) totals[c] += b.amount;

        // Firebase မှ User ၏ နာမည် (သို့) Profile ကို ယူမည် (မရှိပါက Player 1, Player 2 ဟုပြမည်)
        let displayName = `Player ${index + 1}`;
        try {
            if (admin.apps.length > 0) {
                const userSnapshot = await admin.database().ref(`user/${b.uid}/name`).once('value');
                if (userSnapshot.exists()) {
                    displayName = userSnapshot.val();
                }
            }
        } catch (e) {
            displayName = `User_${b.uid.substring(0, 4)}`;
        }

        return {
            round: b.round,
            playerName: displayName, // UID ကို မပြတော့ဘဲ နာမည် သို့မဟုတ် Mask လုပ်ထားသော နာမည်ကိုသာ ပြမည်
            choice: b.choice,
            amount: b.amount,
            gameType: b.gameType,
            status: b.status,
            time: b.time
        };
    }));

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
        bets: sanitizedBets
    });
});

app.post('/api/admin/set-result', adminAuth, (req, res) => {
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
