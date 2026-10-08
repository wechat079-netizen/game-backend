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

// Firebase Initialization 
const serviceAccount = require('./right-2c598-firebase-adminsdk-fbsvc-b86013f3a3.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://right-2c598-default-rtdb.firebaseio.com/"
});

const db = admin.database();

let forcedResults = {
    '30s': { choice: null, number: null },
    '60s': { choice: null, number: null }
};

// Game Timer Loop
function startGameLoop(gameType, interval) {
    setInterval(async () => {
        try {
            const nowSec = Math.floor(Date.now() / 1000);
            const currentRound = Math.floor(nowSec / interval);
            const timer = interval - (nowSec % interval);

            if (timer === 1) {
                await processRoundResult(gameType, currentRound);
            }
        } catch (e) {
            console.log("Loop Error:", e.message);
        }
    }, 1000);
}

// Round ပြီးဆုံးချိန် အဖြေတွက်ခြင်း (Bet ထိုးငွေအနည်းဆုံးဘက်ကို နိုင်စေရန်)
async function processRoundResult(gameType, roundNo) {
    let winningNumber = forcedResults[gameType].number;
    let forcedChoice = forcedResults[gameType].choice;

    const betsRef = db.ref(`bets/${gameType}/${roundNo}`);
    const snapshot = await betsRef.once('value');

    let betsData = [];
    if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
            betsData.push({
                key: childSnapshot.key,
                ...childSnapshot.val()
            });
        });
    }

    // Admin က Forced လုပ်ထားတာ မရှိဘူးဆိုရင် Bet ထိုးငွေအနည်းဆုံးဘက်ကို တွက်မည်
    if ((winningNumber === null || winningNumber === undefined) && (!forcedChoice)) {
        let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
        
        betsData.forEach(bet => {
            if (bet && bet.choice) {
                const c = bet.choice.toUpperCase();
                if (totals[c] !== undefined) {
                    totals[c] += (bet.amount || 0);
                }
            }
        });

        // Bet ထိုးငွေအနည်းဆုံး Choice ကို ရှာမည် (BIG နဲ့ SMALL ကို ဦးစားပေး နှိုင်းယှဉ်မည်)
        let chosenSize = totals.BIG <= totals.SMALL ? 'BIG' : 'SMALL';
        
        // အဲ့ဒီ Size နဲ့ ကိုက်ညီမယ့် Winning Number တစ်ခုကို ရွေးမည်
        if (chosenSize === 'BIG') {
            winningNumber = Math.floor(Math.random() * 5) + 5; // 5 ကနေ 9 ကြား (BIG)
        } else {
            winningNumber = Math.floor(Math.random() * 5); // 0 ကနေ 4 ကြား (SMALL)
        }
    } else if (winningNumber === null || winningNumber === undefined) {
        winningNumber = Math.floor(Math.random() * 10);
    }

    const violetNumbers = [1, 3, 7, 9, 0, 5];
    const greenNumbers = [2, 4, 6, 8, 0, 5];
    const sizeResult = winningNumber >= 5 ? 'BIG' : 'SMALL';

    if (betsData.length > 0) {
        betsData.forEach((betData) => {
            const betKey = betData.key;
            if (!betData || !betData.choice) return;

            const choice = betData.choice.toUpperCase();
            let isWin = false;

            if (choice === 'BIG' || choice === 'SMALL') {
                if (choice === sizeResult) isWin = true;
            } else if (choice === 'GREEN') {
                if (greenNumbers.includes(winningNumber)) isWin = true;
            } else if (choice === 'VIOLET') {
                if (violetNumbers.includes(winningNumber)) isWin = true;
            }

            if (forcedChoice && (forcedChoice === 'BIG' || forcedChoice === 'SMALL')) {
                if (choice === forcedChoice) isWin = true;
            }

            betsRef.child(betKey).update({
                status: isWin ? 'win' : 'lose',
                payout: isWin ? (betData.amount * 1.95) : -betData.amount,
                winningNumber: winningNumber
            });
        });
    }

    forcedResults[gameType] = { choice: null, number: null };
}

startGameLoop('30s', 30);
startGameLoop('60s', 60);

// Admin API Routes
app.get('/api/admin/get-data', async (req, res) => {
    try {
        const gameType = req.query.gameType || '30s';
        const interval = gameType === '30s' ? 30 : 60;
        const nowSec = Math.floor(Date.now() / 1000);
        const currentRound = Math.floor(nowSec / interval);
        const timer = interval - (nowSec % interval);

        let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
        let betsList = [];

        const snapshot = await db.ref(`bets/${gameType}/${currentRound}`).once('value');
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const b = child.val();
                if (b && b.choice) {
                    const c = b.choice.toUpperCase();
                    if (totals[c] !== undefined) totals[c] += (b.amount || 0);

                    betsList.push({
                        playerName: b.playerName || 'User',
                        choice: b.choice,
                        amount: b.amount || 0
                    });
                }
            });
        }

        res.json({
            round: currentRound,
            timer: timer,
            forced: "Auto",
            totals: totals,
            bets: betsList.reverse()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/set-result', (req, res) => {
    const { gameType, choice, number } = req.body;
    if (gameType && forcedResults[gameType]) {
        forcedResults[gameType] = { choice: choice || null, number: number !== undefined ? number : null };
        return res.json({ success: true, message: "အောင်မြင်ပါသည်။" });
    }
    res.status(400).json({ success: false, message: "အချက်အလက် မှားယွင်းနေပါသည်။" });
});

// Socket connection
io.on('connection', (socket) => {
    console.log('A user connected');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
