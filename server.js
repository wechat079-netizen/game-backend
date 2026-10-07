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
                else if (c === "GREEN") winningNumber = [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)];
                else if (c === "VIOLET") winningNumber = [1, 3, 5, 7, 9][Math.floor(Math.random() * 5)];
                else winningNumber = Math.floor(Math.random() * 10);
            } else {
                winningNumber = Math.floor(Math.random() * 10);
            }

            // Only GREEN and VIOLET are supported; RED is intentionally excluded.
            resultColor = winningNumber % 2 === 0 ? "GREEN" : "VIOLET";

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
// Settle Bets Engine (နိုင်/ရှုံး စစ်ဆေးပြီး ငွေပေါင်းပေးခြင်း)
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

            let status = isWin ? 'Win' : 'Lose';

            if (admin.apps.length > 0 && bet.firebaseKey) {
                const db = admin.database();
                const betRef = db.ref(`userBetsHistory/${userId}/${bet.firebaseKey}`);

                // Mark the bet as settled. A Win/Pending bet is also allowed to
                // continue after a temporary failure between settlement and payout.
                const settleResult = await betRef.transaction((currentBet) => {
                    if (!currentBet) return;
                    const canResumePayout = isWin && currentBet.status === 'Win' && currentBet.payoutStatus === 'Pending';
                    if (currentBet.status !== 'Pending' && !canResumePayout) return;
                    if (canResumePayout) return currentBet;
                    return {
                        ...currentBet,
                        status,
                        settledAt: currentBet.settledAt || Date.now(),
                        payoutStatus: isWin ? 'Pending' : 'NotRequired'
                    };
                });

                if (!settleResult.committed) {
                    console.log(`[SKIP] Bet ${bet.firebaseKey} was already settled or removed.`);
                    continue;
                }

                if (isWin) {
                    const winMultiplier = (choice === String(winningNumber)) ? 9.0 : 1.95;
                    const winAmount = amount * winMultiplier;
                    const userRef = db.ref(`user/${userId}`);

                    // Money and the payout ledger are changed in ONE transaction.
                    // Therefore retries cannot credit the same bet twice.
                    const moneyResult = await userRef.transaction((currentUser) => {
                        const user = currentUser && typeof currentUser === 'object' ? { ...currentUser } : {};
                        const payouts = user.payouts && typeof user.payouts === 'object' ? { ...user.payouts } : {};
                        if (payouts[bet.firebaseKey]) return;

                        let val = parseFloat(user.money);
                        if (isNaN(val)) val = 0;
                        user.money = val + winAmount;
                        payouts[bet.firebaseKey] = {
                            amount: winAmount,
                            round: roundNumber,
                            paidAt: Date.now()
                        };
                        user.payouts = payouts;
                        return user;
                    });

                    if (!moneyResult.committed) {
                        // It was already credited by a previous retry, or the transaction failed.
                        const latest = await userRef.once('value');
                        const latestUser = latest.val() || {};
                        if (!latestUser.payouts || !latestUser.payouts[bet.firebaseKey]) {
                            throw new Error(`Could not credit payout for bet ${bet.firebaseKey}`);
                        }
                    }

                    await betRef.update({ payoutStatus: 'Paid', paidAmount: winAmount, paidAt: Date.now() });
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

app.get('/api/user/get-data', async (req, res) => {
    try {
        const gameType = req.query.gameType || '30s';
        const uid = req.query.uid;
        const interval = gameType === '30s' ? 30 : 60;
        
        const nowSec = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor(nowSec / interval);
        const timer = interval - (nowSec % interval);

        let myHistory = [];
        if (uid && admin.apps.length > 0) {
            const snapshot = await admin.database().ref(`userBetsHistory/${uid}`)
                .limitToLast(30)
                .once('value');
            
            if (snapshot.exists()) {
                snapshot.forEach((childSnap) => {
                    let val = childSnap.val();
                    if (val.gameType === gameType) {
                        myHistory.unshift(val);
                    }
                });
            }
        }

        res.json({
            round: currentRound,
            timer: timer,
            history: gameHistory[gameType] || [],
            myHistory: myHistory
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Place Bet Endpoint (Query နဲ့ Body နှစ်မျိုးစလုံးကို သေချာဖတ်ပေးရန်)
app.all('/api/place-bet', async (req, res) => {
    try {
        const uid = req.body.uid || req.query.uid;
        const choice = req.body.choice || req.query.choice;
        const amount = req.body.amount || req.query.amount;
        const gameType = req.body.gameType || req.query.gameType;
        const type = gameType || '30s';
        if (!['30s', '60s'].includes(type)) {
            return res.status(400).json({ success: false, message: "Game Type မမှန်ကန်ပါ!" });
        }

        console.log("=== PLACE BET CALLED ===");
        console.log("Incoming Data -> uid:", uid, "choice:", choice, "amount:", amount, "gameType:", type);

        if (!uid || !choice || !amount) {
            console.log("[ERROR] Missing parameters!");
            return res.status(400).json({ success: false, message: "အချက်အလက် မစုံလင်ပါ!" });
        }

        const betAmount = parseFloat(amount);
        if (isNaN(betAmount) || betAmount <= 0) {
            console.log("[ERROR] Invalid amount:", amount);
            return res.status(400).json({ success: false, message: "ထိုးငွေ ပမာဏ မမှန်ကန်ပါ!" });
        }

        if (admin.apps.length === 0) {
            return res.status(500).json({ success: false, message: "Firebase Admin ချိတ်ဆက်မှု မရှိသေးပါ!" });
        }

        const db = admin.database();
        const userMoneyRef = db.ref(`user/${uid}/money`);
        let remainingBalance = 0;
        let isSuccess = false;

        // Firebase Transaction ဖြင့် ငွေ ချက်ချင်းနုတ်ယူခြင်း
        // Always use the committed result, not a flag set inside the callback.
        // Firebase may execute a transaction callback more than once.
        const debitResult = await userMoneyRef.transaction((currentMoney) => {
            let val = parseFloat(currentMoney);
            if (isNaN(val)) val = 0;

            console.log("DB Current Money:", val, "Bet Amount:", betAmount);

            if (val < betAmount) return; // abort: insufficient balance
            return val - betAmount;
        });

        if (!debitResult.committed) {
            return res.status(400).json({ success: false, message: "လက်ကျန်ငွေ မလုံလောက်ပါ!" });
        }

        remainingBalance = parseFloat(debitResult.snapshot.val()) || 0;
        isSuccess = true;

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

        const newBetRef = db.ref(`userBetsHistory/${uid}`).push();
        betData.firebaseKey = newBetRef.key;
        try {
            await newBetRef.set(betData);
        } catch (historyError) {
            // Verify first: a timeout may happen after Firebase has already saved the record.
            // Refund only when the bet truly does not exist, preventing double refunds.
            const savedBet = await newBetRef.once('value');
            if (!savedBet.exists()) {
                await userMoneyRef.transaction((currentMoney) => {
                    let val = parseFloat(currentMoney);
                    if (isNaN(val)) val = 0;
                    return val + betAmount;
                });
            }
            throw new Error(`Bet record failed; money was refunded only when necessary. ${historyError.message}`);
        }

        if (!activeBets[type]) activeBets[type] = [];
        activeBets[type].push({ uid, ...betData });
        console.log(`[SUCCESS] User ${uid} bet ${betAmount} on ${choice}. Remaining balance: ${remainingBalance}`);

        return res.json({ 
            success: true, 
            message: "ထိုးကြေး အောင်မြင်စွာ တင်ပြီးပါပြီ!",
            balance: remainingBalance 
        });

    } catch (error) {
        console.error("Place Bet Error:", error);
        return res.status(500).json({ success: false, error: error.message });
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
    let forcedStr = "Auto ( အရမ်ချစ်တယ်)";
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

    if (!['30s', '60s'].includes(gameType)) {
        return res.status(400).json({ success: false, message: "Game Type မှားယွင်းနေပါသည်!" });
    }
    if ((normalizedChoice && !allowedChoices.includes(normalizedChoice)) || !validNumber) {
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
