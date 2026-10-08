const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Initialization (သင့်ရဲ့ config အတိုင်း ထည့်ပါ)
// admin.initializeApp({ ... });

const db = admin.database();

let forcedResults = {
    '30s': { choice: null, number: null },
    '60s': { choice: null, number: null }
};

function startGameLoop(gameType, interval) {
    setInterval(async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor(nowSec / interval);
        const timer = interval - (nowSec % interval);

        if (timer === 1) {
            await processRoundResult(gameType, currentRound);
        }
    }, 1000);
}

// ရလဒ်နှင့် Win/Lose စစ်ဆေးခြင်း (ပုံပါ အရောင်/ဂဏန်း စည်းမျဉ်းအတိုင်း)
async function processRoundResult(gameType, roundNo) {
    try {
        let winningNumber = forcedResults[gameType].number;
        let forcedChoice = forcedResults[gameType].choice;

        // အကယ်၍ Admin က ဂဏန်းမသတ်မှတ်ထားရင် 0 ကနေ 9 ထိ Random ထုတ်မည်
        if (winningNumber === null || winningNumber === undefined) {
            winningNumber = Math.floor(Math.random() * 10);
        }

        // ဂဏန်းအလိုက် အရောင်နှင့် Big/Small သတ်မှတ်ချက်
        // ပုံပါအရ - 
        // 0 = Green/Violet, 1 = Violet, 2 = Green, 3 = Violet, 4 = Green
        // 5 = Violet/Green, 6 = Green, 7 = Violet, 8 = Green, 9 = Violet
        const violetNumbers = [1, 3, 7, 9, 0, 5];
        const greenNumbers = [2, 4, 6, 8, 0, 5];

        const isBig = winningNumber >= 5;
        const sizeResult = isBig ? 'BIG' : 'SMALL';

        const betsRef = db.ref(`bets/${gameType}/${roundNo}`);
        const snapshot = await betsRef.once('value');

        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                const betKey = childSnapshot.key;
                const betData = childSnapshot.val();
                const choice = betData.choice.toUpperCase();

                let isWin = false;

                if (choice === 'BIG' || choice === 'SMALL') {
                    if (choice === sizeResult) isWin = true;
                } else if (choice === 'GREEN') {
                    if (greenNumbers.includes(winningNumber)) isWin = true;
                } else if (choice === 'VIOLET') {
                    if (violetNumbers.includes(winningNumber)) isWin = true;
                }

                // အကယ်၍ Admin က Choice ကို အတင်းသတ်မှတ်ထားလျှင် Override လုပ်ရန်
                if (forcedChoice && (forcedChoice === 'BIG' || forcedChoice === 'SMALL')) {
                    if (choice === forcedChoice) isWin = true;
                }

                const status = isWin ? 'win' : 'lose';
                const payout = isWin ? betData.amount * 1.95 : -betData.amount;

                betsRef.child(betKey).update({
                    status: status,
                    payout: payout,
                    winningNumber: winningNumber
                });
            });
        }

        forcedResults[gameType] = { choice: null, number: null };
    } catch (e) {
        console.error("Error processing round result:", e);
    }
}

startGameLoop('30s', 30);
startGameLoop('60s', 60);

// Admin API
app.get('/api/admin/get-data', async (req, res) => {
    const gameType = req.query.gameType || '30s';
    const interval = gameType === '30s' ? 30 : 60;
    const nowSec = Math.floor(Date.now() / 1000);
    const currentRound = Math.floor(nowSec / interval);
    const timer = interval - (nowSec % interval);

    let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
    let betsList = [];

    try {
        const snapshot = await db.ref(`bets/${gameType}/${currentRound}`).once('value');
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const b = child.val();
                const c = b.choice.toUpperCase();
                if (totals[c] !== undefined) totals[c] += b.amount;

                betsList.push({
                    playerName: b.playerName || `User_${b.uid?.substring(0, 4)}`,
                    choice: b.choice,
                    amount: b.amount
                });
            });
        }
    } catch (e) {
        console.log(e);
    }

    res.json({
        round: currentRound,
        timer: timer,
        forced: "Auto",
        totals: totals,
        bets: betsList.reverse()
    });
});

app.post('/api/admin/set-result', (req, res) => {
    const { gameType, choice, number } = req.body;
    if (gameType && forcedResults[gameType]) {
        forcedResults[gameType] = { choice: choice || null, number: number !== undefined ? number : null };
        return res.json({ success: true, message: "ရလဒ် သတ်မှတ်ပြီးပါပြီ!" });
    }
    res.status(400).json({ success: false, message: "မှားယွင်းနေပါသည်!" });
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Server is running...');
});
