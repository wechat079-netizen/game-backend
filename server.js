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

// Memory Stores (Active Bets အတွက်သာ ယာယီသုံးမည်)
let activeBets = { '30s': [], '60s': [] };
let forcedResults = { '30s': null, '60s': null };

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
        // 2. Auto Mode: BIG, SMALL, GREEN, VIOLET အားလုံးထဲမှ ငွေအနည်းဆုံးဘက်ကို နိုင်စေရန် တွက်ချက်ခြင်း
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

        // ငွေအနည်းဆုံးဘက်ကို ရှာခြင်း
        let minAmount = Math.min(totals.BIG, totals.SMALL, totals.GREEN, totals.VIOLET);
        let lowestChoices = [];

        if (totals.BIG === minAmount) lowestChoices.push("BIG");
        if (totals.SMALL === minAmount) lowestChoices.push("SMALL");
        if (totals.GREEN === minAmount) lowestChoices.push("GREEN");
        if (totals.VIOLET === minAmount) lowestChoices.push("VIOLET");

        // ငွေအနည်းဆုံးတူနေပါက ကျပန်း တစ်ခုရွေးမည်
        let chosenChoice = lowestChoices[Math.floor(Math.random() * lowestChoices.length)];

        // ရွေးချယ်ထားသော Choice အလိုက် Winning Number သတ်မှတ်ခြင်း
        if (chosenChoice === "BIG") {
          winningNumber = 5 + Math.floor(Math.random() * 5); // 5 - 9
        } else if (chosenChoice === "SMALL") {
          winningNumber = Math.floor(Math.random() * 5); // 0 - 4
        } else if (chosenChoice === "GREEN") {
          winningNumber = [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)]; // Even numbers
        } else if (chosenChoice === "VIOLET") {
          winningNumber = [1, 3, 5, 7, 9][Math.floor(Math.random() * 5)]; // Odd numbers
        } else {
          winningNumber = Math.floor(Math.random() * 10);
        }
      }

      // Color & BS တွက်ချက်ခြင်း
      if (winningNumber % 2 === 0) {
        resultColor = "GREEN";
      } else {
        resultColor = "VIOLET";
      }
      resultBS = winningNumber >= 5 ? "BIG" : "SMALL";

      // Game History ကို Firebase ထဲသို့ တိုက်ရိုက်သိမ်းဆည်းခြင်း (ပျောက်မသွားစေရန်)
      const historyItem = { round: currentRound, number: winningNumber, bs: resultBS, color: resultColor, time: Date.now() };
      if (admin.apps.length > 0) {
        try {
          await admin.database().ref(`gameHistory/${gameType}`).push(historyItem);
        } catch (e) {
          console.log("Save Game History to Firebase Error:", e.message);
        }
      }

      // Bet တင်ထားသူများကို ငွေရှင်းပေးခြင်း
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
// Settle Bets Engine
// -------------------------------------------------------------
async function settleBetsEngine(gameType, roundNumber, winningNumber, resultColor, resultBS) {
  try {
    const currentBets = activeBets[gameType] || [];
    if (currentBets.length === 0) return;

    console.log(`[Round ${roundNumber}] Processing ${currentBets.length} bets for ${gameType}...`);
    
    for (let bet of currentBets) {
      let userId = bet.uid;
      let betKey = bet.betKey; 
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

      if (admin.apps.length > 0 && userId && betKey) {
        try {
          await admin.database().ref(`userBetsHistory/${userId}/${betKey}`).update({ status: bet.status });
        } catch (e) {
          console.log("Update Bet Status Error:", e.message);
        }
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
app.get('/api/user/get-data', async (req, res) => {
  const gameType = req.query.gameType || '30s';
  const uid = req.query.uid;
  const interval = gameType === '30s' ? 30 : 60;

  const nowSec = Math.floor(Date.now() / 1000);
  const currentRound = Math.floor(nowSec / interval);
  const timer = interval - (nowSec % interval);
  
  let gameHistoryList = [];
  let myHistory = [];

  if (admin.apps.length > 0) {
    try {
      const ghSnap = await admin.database().ref(`gameHistory/${gameType}`).limitToLast(30).once('value');
      if (ghSnap.exists()) {
        const val = ghSnap.val();
        gameHistoryList = Object.values(val).reverse();
      }

      if (uid) {
        const ubSnap = await admin.database().ref(`userBetsHistory/${uid}`).limitToLast(20).once('value');
        if (ubSnap.exists()) {
          const val = ubSnap.val();
          myHistory = Object.values(val).filter(b => b.gameType === gameType).reverse();
        }
      }
    } catch (e) {
      console.log("Fetch History from Firebase Error:", e.message);
    }
  }
  
  res.json({ round: currentRound, timer: timer, history: gameHistoryList, myHistory: myHistory });
});

app.post('/api/place-bet', async (req, res) => {
  const { uid, name, choice, amount, gameType } = req.body;
  const type = gameType || '30s';

  if (!uid || !choice || !amount) {
    return res.status(400).json({ success: false, message: "အချက်အလက် မစုံလင်ပါ!" });
  }

  const interval = type === '30s' ? 30 : 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const currentRound = Math.floor(nowSec / interval);
  const timer = interval - (nowSec % interval);

  if (timer <= 6) {
    return res.status(400).json({ success: false, message: "အချိန်ကုန်သွားပါပြီ။ ဤ Round အတွက် ထိုးကြေးလက်မခံတော့ပါ။" });
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
  }

  let betKey = "";
  const betData = { 
    round: currentRound, 
    playerName: playerName, 
    choice: String(choice).trim().toUpperCase(), 
    amount: betAmount, 
    gameType: type, 
    status: 'Pending', 
    time: Date.now() 
  };

  if (admin.apps.length > 0) {
    try {
      const newRef = admin.database().ref(`userBetsHistory/${uid}`).push();
      betKey = newRef.key;
      await newRef.set(betData);
    } catch (e) {
      console.log("Save Bet to Firebase Error:", e.message);
    }
  }
  
  activeBets[type].push({ uid, betKey, ...betData });

  return res.json({ success: true, message: `ထိုးကြေး တင်သွင်းမှု အောင်မြင်စွာ ပြီးစီးပါပြီ!` });
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

  bets.forEach((b, index) => {
    const c = b.choice.toUpperCase();
    if (totals[c] !== undefined) totals[c] += b.amount;

    formattedBets.push({
      playerName: `${b.playerName} #${index + 1}`, 
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
