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

      // 1. Admin မှ Control လုပ်ထားပါက Forced Result ယူမည်
      if (forced && (forced.number !== undefined && forced.number !== null && forced.number !== "")) {
        winningNumber = parseInt(forced.number);
      } else if (forced && forced.choice) {
        let c = forced.choice.toUpperCase();
        if (c === "BIG") winningNumber = 5 + Math.floor(Math.random() * 5); // 5 - 9
        else if (c === "SMALL") winningNumber = Math.floor(Math.random() * 5); // 0 - 4
        else if (c === "GREEN") winningNumber = [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)]; 
        else if (c === "VIOLET") winningNumber = [1, 3, 5, 7, 9][Math.floor(Math.random() * 5)]; 
        else winningNumber = Math.floor(Math.random() * 10);
      } else {
        // 2. Auto Mode: Bet ထိုးငွေအနည်းဆုံးဘက်ကို နိုင်စေရန် တွက်ချက်ခြင်း
        const currentBets = activeBets[gameType] || [];
        let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };

        currentBets.forEach(bet => {
          if (bet && bet.choice) {
            let ch = bet.choice.toUpperCase();
            if (totals[ch] !== undefined) {
              totals[ch] += parseFloat(bet.amount || 0);
            }
          }
        });

        let chosenChoice = totals.BIG <= totals.SMALL ? "BIG" : "SMALL";

        if (chosenChoice === "BIG") {
          winningNumber = 5 + Math.floor(Math.random() * 5); // 5 ကနေ 9 ကြား
        } else {
          winningNumber = Math.floor(Math.random() * 5); // 0 ကနေ 4 ကြား
        }
      }

      // Color & BS တွက်ချက်ခြင်း
      if (winningNumber % 2 === 0) {
        resultColor = "GREEN";
      } else {
        resultColor = "VIOLET";
      }
      resultBS = winningNumber >= 5 ? "BIG" : "SMALL";

      // Game History ထဲသို့ အသစ် ထည့်သွင်းခြင်း
      const historyItem = { round: currentRound, number: winningNumber, bs: resultBS, color: resultColor };
      if (!gameHistory[gameType]) gameHistory[gameType] = [];
      gameHistory[gameType].unshift(historyItem);
      if (gameHistory[gameType].length > 30) gameHistory[gameType].pop();

      // Bet တင်ထားသူများကို ငွေရှင်းပေးခြင်း (တစ်ခုချင်းစီ သီးသန့် စစ်ဆေးမည်)
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
// Settle Bets Engine (Bet တစ်ခုချင်းစီကို သီးသန့် Win/Lose တွက်ပေးခြင်း)
// -------------------------------------------------------------
async function settleBetsEngine(gameType, roundNumber, winningNumber, resultColor, resultBS) {
  try {
    const currentBets = activeBets[gameType] || [];
    if (currentBets.length === 0) return;

    console.log(`[Round ${roundNumber}] Processing ${currentBets.length} bets for ${gameType}...`);
    
    for (let bet of currentBets) {
      let userId = bet.uid;
      let betIndex = bet.betIndex; // ဘယ်နှစ်ခုမြောက်ထိုးထားလဲဆိုတဲ့ အမှတ်အသား
      let amount = parseFloat(bet.amount || 0);
      let choice = String(bet.choice || '').trim().toUpperCase();
      let isWin = false;

      if (choice === resultBS) {
        isWin = true; // BIG or SMALL (1.95x)
      } else if (choice === resultColor) {
        isWin = true; // GREEN, VIOLET (1.95x)
      } else if (choice === String(winningNumber)) {
        isWin = true; // ဂဏန်း အတိအကျ 0 - 9 (9x)
      }

      bet.status = isWin ? 'Win' : 'Lose';

      // User ရဲ့ My History ထဲတွင် Round နှင့် Bet Index တူသည်ကို ရှာပြီး Status ပြောင်းပေးမည်
      if (userBetsHistory[userId]) {
        let uBet = userBetsHistory[userId].find(b => b.round === roundNumber && b.gameType === gameType && b.betIndex === betIndex);
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
          console.log(`[WIN SUCCESS] User ${userId} (Bet #${betIndex}) received +${winAmount} MMK`);
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
  
  res.json({ round: currentRound, timer: timer, history: gameHistory[gameType] || [], myHistory: myHistory });
});

app.post('/api/place-bet', async (req, res) => {
  const { uid, name, choice, amount, gameType } = req.body;
  const type = gameType || '30s';

  if (!uid || !choice || !amount) {
    return res.status(400).json({ success: false, message: "အချက်အလက် မစုံလင်ပါ!" });
  }
  
  const betAmount = parseFloat(amount);
  if (isNaN(betAmount) || betAmount <= 0) {
    return res.status(400).json({ success: false, message: "ထိုးငွေ ပမာဏ မမှန်ကန်ပါ!" });
  }

  let playerName = name;
  if (!playerName && admin.apps.length > 0) {
    try {
      const userSnap = await admin.database().ref(`user/${uid}/name`).once('value');
      if (userSnap.exists()) {
        playerName = userSnap.val();
      }
    } catch (e) {
      console.log("Fetch Name Error:", e.message);
    }
  }
  playerName = playerName || "User";

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

  // User တစ်ဦးချင်းစီအတွက် လက်ရှိ Round မှာ ဘယ်နှခုမြောက် Bet ထိုးတာလဲဆိုတာကို ရေတွက်ရန်
  if (!userBetsHistory[uid]) userBetsHistory[uid] = [];
  let existingRoundBetsCount = userBetsHistory[uid].filter(b => b.round === currentRound && b.gameType === type).length;
  let betIndex = existingRoundBetsCount + 1; // ဥပမာ - 1, 2, 3 အစရှိသဖြင့်
  
  const betData = { 
    round: currentRound, 
    betIndex: betIndex, // Bet တစ်ခုချင်းစီအတွက် အမှတ်စဉ် (1, 2, 3...)
    playerName: playerName, 
    choice: String(choice).trim().toUpperCase(), 
    amount: betAmount, 
    gameType: type, 
    status: 'Pending', 
    time: Date.now() 
  };
  
  activeBets[type].push({ uid, ...betData });
  userBetsHistory[uid].unshift(betData);

  return res.json({ success: true, message: `ထိုးကြေးအမှတ်စဉ် #${betIndex} အောင်မြင်စွာ တင်ပြီးပါပြီ!` });
});

// 2. ADMIN ENDPOINTS
app.get('/api/admin/get-data', (req, res) => {
  const gameType = req.query.gameType || '30s';
  const interval = gameType === '30s' ? 30 : 60;

  const nowSec = Math.floor(Date.now() / 1000);
  const currentRound = Math.floor(nowSec / interval);
  const timer = interval - (nowSec % interval);
  const bets = activeBets[gameType] || [];
  
  let totals = { BIG: 0, SMALL: 0, GREEN: 0, VIOLET: 0 };
  let formattedBets = [];

  bets.forEach(b => {
    const c = b.choice.toUpperCase();
    if (totals[c] !== undefined) totals[c] += b.amount;

    // Admin ဘက်မှာလည်း ဘယ်နှခုမြောက် Bet လဲဆိုတာ (ဥပမာ Name #1) ပေါ်အောင် ပြသမည်
    formattedBets.push({
      playerName: `${b.playerName} #${b.betIndex}`, 
      choice: b.choice,
      amount: b.amount,
      status: b.status,
      time: b.time
    });
  });

  const forced = forcedResults[gameType];
  let forcedStr = "Auto (မပြင်ထားပါ)";
  if (forced) {
    if (forced.choice) forcedStr = forced.choice;
    if (forced.number !== undefined && forced.number !== null && forced.number !== "") forcedStr = `ဂဏန်း (${forced.number})`;
  }

  res.json({ round: currentRound, timer: timer, forced: forcedStr, totals: totals, bets: formattedBets });
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
