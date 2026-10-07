const express = require('express');
const http = require('http');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const DATA_FILE = './game_data.json';
const USERS_FILE = './users.json';

function loadGameData() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  }
  return { currentRound: 1, gameHistory: [] };
}

function saveGameData(round, history) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ currentRound: round, gameHistory: history }, null, 2)); } catch(e){}
}

function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
  }
  return { "player1": { username: "player1", balance: 100000 } };
}

function saveUsers(users) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch(e){}
}

let savedData = loadGameData();
let users = loadUsers();
let currentRound = savedData.currentRound;
let gameHistory = savedData.gameHistory;
let timeRemaining = 30;
let activeBets = [];
let lastGameResult = null;
let overrideResult = null; 

app.get('/api/user/:username', (req, res) => {
  const username = req.params.username;
  if (!users[username]) {
    users[username] = { username, balance: 10000 };
    saveUsers(users);
  }
  res.json({ success: true, user: users[username] });
});

app.get('/api/game-state', (req, res) => {
  let totalBigAmount = 0;
  let totalSmallAmount = 0;

  activeBets.forEach(bet => {
    const amt = Number(bet.amount) || 0;
    if (bet.choice === 'Big') totalBigAmount += amt;
    if (bet.choice === 'Small') totalSmallAmount += amt;
  });

  res.json({
    round: String(currentRound).padStart(8, '0'),
    timeRemaining: timeRemaining,
    history: gameHistory.slice(0, 10),
    lastResult: lastGameResult,
    totalBetsCount: activeBets.length,
    totalBigAmount: totalBigAmount,
    totalSmallAmount: totalSmallAmount
  });

  if (lastGameResult && lastGameResult.processed) {
    lastGameResult = null;
  } else if (lastGameResult) {
    lastGameResult.processed = true;
  }
});

app.post('/api/place-bet', (req, res) => {
  const { username, choice, amount } = req.body;

  if (timeRemaining <= 6) {
    return res.status(400).json({ success: false, message: "Bet Closed! (6 Seconds Remaining)" });
  }

  const betAmount = Number(amount);
  if (!username || !choice || isNaN(betAmount) || betAmount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid Bet Data!" });
  }

  if (!users[username]) {
    users[username] = { username, balance: 10000 };
  }

  if (users[username].balance < betAmount) {
    return res.status(400).json({ success: false, message: "Insufficient Balance!" });
  }

  users[username].balance -= betAmount;
  saveUsers(users);

  activeBets.push({ username, choice: String(choice), amount: betAmount });

  res.json({ 
    success: true, 
    message: "Bet Placed Successfully!",
    newBalance: users[username].balance 
  });
});

app.post('/api/admin/set-result', (req, res) => {
  const { winningBS, targetNumber } = req.body;

  if (targetNumber !== undefined && (targetNumber < 0 || targetNumber > 9)) {
    return res.status(400).json({ success: false, message: "Invalid Number! (Must be 0-9)" });
  }

  overrideResult = {
    winningBS: winningBS || null,
    targetNumber: targetNumber !== undefined ? Number(targetNumber) : null
  };

  res.json({
    success: true,
    message: `Next Round (${currentRound}) result overridden successfully!`,
    presetData: overrideResult
  });
});

app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game Admin Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
    body { background-color: #1a1a24; color: #fff; padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 500px; background: #252636; padding: 25px; border-radius: 12px; }
    h2 { text-align: center; margin-bottom: 20px; color: #00d2d3; }
    .status-card { background: #1e1f2c; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #00d2d3; }
    .status-card p { margin-bottom: 8px; font-size: 15px; }
    .status-card span { font-weight: bold; color: #ff9f43; }
    .bet-stats { display: flex; gap: 10px; margin-bottom: 20px; }
    .bet-box { flex: 1; padding: 12px; border-radius: 8px; text-align: center; font-weight: bold; }
    .big-box { background: rgba(255, 71, 87, 0.15); border: 1px solid #ff4757; color: #ff4757; }
    .small-box { background: rgba(46, 213, 115, 0.15); border: 1px solid #2ed573; color: #2ed573; }
    .bet-box h4 { font-size: 14px; margin-bottom: 5px; opacity: 0.8; }
    .bet-box div { font-size: 20px; }
    .section-title { font-size: 16px; margin-bottom: 12px; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 5px; }
    .btn-group { display: flex; gap: 10px; margin-bottom: 20px; }
    .btn { flex: 1; padding: 12px; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; }
    .btn-big { background: #ff4757; color: white; }
    .btn-small { background: #2ed573; color: white; }
    .num-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }
    .btn-num { background: #34354a; color: #fff; border: 1px solid #444; padding: 10px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; }
    #alertMsg { padding: 10px; border-radius: 6px; display: none; text-align: center; font-weight: bold; }
    .alert-success { background: #2ed57322; color: #2ed573; border: 1px solid #2ed573; }
    .alert-error { background: #ff475722; color: #ff4757; border: 1px solid #ff4757; }
  </style>
</head>
<body>
<div class="container">
  <h2>🎮 Game Control Panel</h2>
  <div class="status-card">
    <p>လက်ရှိ Round: <span id="currentRound">00000000</span></p>
    <p>ကျန်ရှိချိန်: <span id="timeRemaining">00</span> စက္ကန့်</p>
    <p>ကြိုပြင်ထားသော Result: <span id="presetStatus" style="color: #00d2d3;">Auto (မပြင်ထားပါ)</span></p>
  </div>
  <div class="section-title">📊 လက်ရှိ Round ထိုးကြေး စာရင်း</div>
  <div class="bet-stats">
    <div class="bet-box big-box">
      <h4>BIG Total</h4>
      <div id="bigAmount">0 Ks</div>
    </div>
    <div class="bet-box small-box">
      <h4>SMALL Total</h4>
      <div id="smallAmount">0 Ks</div>
    </div>
  </div>
  <div class="section-title">၁။ Big / Small ကြိုတင်သတ်မှတ်မည်</div>
  <div class="btn-group">
    <button class="btn btn-big" onclick="setResult({ winningBS: 'Big' })">BIG နိုင်စေမည်</button>
    <button class="btn btn-small" onclick="setResult({ winningBS: 'Small' })">SMALL နိုင်စေမည်</button>
  </div>
  <div class="section-title">၂။ ဂဏန်း အတိအကျ (0 - 9) သတ်မှတ်မည်</div>
  <div class="num-grid">
    <button class="btn-num" onclick="setResult({ targetNumber: 0 })">0</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 1 })">1</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 2 })">2</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 3 })">3</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 4 })">4</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 5 })">5</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 6 })">6</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 7 })">7</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 8 })">8</button>
    <button class="btn-num" onclick="setResult({ targetNumber: 9 })">9</button>
  </div>
  <div id="alertMsg"></div>
</div>
<script>
  async function fetchGameState() {
    try {
      const res = await fetch('/api/game-state');
      const data = await res.json();
      document.getElementById('currentRound').innerText = data.round || '00000000';
      document.getElementById('timeRemaining').innerText = data.timeRemaining !== undefined ? data.timeRemaining : '0';
      document.getElementById('bigAmount').innerText = (data.totalBigAmount || 0).toLocaleString() + ' Ks';
      document.getElementById('smallAmount').innerText = (data.totalSmallAmount || 0).toLocaleString() + ' Ks';
    } catch (e) {}
  }
  async function setResult(payload) {
    try {
      const res = await fetch('/api/admin/set-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const alertBox = document.getElementById('alertMsg');
      alertBox.style.display = 'block';
      if (data.success) {
        alertBox.className = 'alert-success';
        alertBox.innerText = '✅ ပြင်ဆင်မှု အောင်မြင်ပါသည်!';
        let presetText = payload.targetNumber !== undefined ? 'Number (' + payload.targetNumber + ')' : payload.winningBS;
        document.getElementById('presetStatus').innerText = presetText;
      } else {
        alertBox.className = 'alert-error';
        alertBox.innerText = '❌ ' + data.message;
      }
      setTimeout(() => { alertBox.style.display = 'none'; }, 3000);
    } catch (e) { alert("API ချိတ်ဆက်မှု မအောင်မြင်ပါ!"); }
  }
  setInterval(fetchGameState, 1000);
  fetchGameState();
</script>
</body>
</html>
  `);
});

app.get('/', (req, res) => {
  res.send("Server Running Successfully!");
});

setInterval(() => {
  timeRemaining--;
  if (timeRemaining <= 0) {
    calculateResult();
    timeRemaining = 30;
    currentRound++;
    activeBets = [];
    saveGameData(currentRound, gameHistory);
  }
}, 1000);

function calculateResult() {
  let winningBS = 'Big';
  let randomNumber;

  if (overrideResult) {
    if (overrideResult.targetNumber !== null) {
      randomNumber = overrideResult.targetNumber;
      winningBS = randomNumber >= 5 ? 'Big' : 'Small';
    } else if (overrideResult.winningBS) {
      winningBS = overrideResult.winningBS;
      randomNumber = winningBS === 'Big' ? Math.floor(Math.random() * 5) + 5 : Math.floor(Math.random() * 5);
    }
    overrideResult = null;
  } else {
    let bigTotal = 0;
    let smallTotal = 0;
    activeBets.forEach(bet => {
      const amt = Number(bet.amount) || 0;
      if (bet.choice === 'Big') bigTotal += amt;
      if (bet.choice === 'Small') smallTotal += amt;
    });

    if (bigTotal > smallTotal) winningBS = 'Small';
    else if (smallTotal > bigTotal) winningBS = 'Big';
    else winningBS = Math.random() >= 0.5 ? 'Big' : 'Small';

    randomNumber = winningBS === 'Big' ? Math.floor(Math.random() * 5) + 5 : Math.floor(Math.random() * 5);
  }

  const color = (randomNumber % 2 === 0) ? 'Green' : 'Violet';
  const resultData = { round: String(currentRound).padStart(8, '0'), number: randomNumber, bs: winningBS, color: color };

  gameHistory.unshift(resultData);
  if (gameHistory.length > 20) gameHistory.pop();

  let totalWinReturn = 0;
  activeBets.forEach(bet => {
    let isWin = false;
    let rate = 1.95;
    if (bet.choice === winningBS || bet.choice === color) isWin = true;
    if (bet.choice === String(randomNumber)) { isWin = true; rate = 9; }
    if (isWin) {
      const winAmount = Math.floor(bet.amount * rate);
      totalWinReturn += winAmount;
      if (users[bet.username]) users[bet.username].balance += winAmount;
    }
  });

  saveUsers(users);
  lastGameResult = activeBets.length > 0 ? { round: resultData.round, win: totalWinReturn > 0, winAmount: totalWinReturn, processed: false } : null;
}

// Render ပေါ်တွင် Auto Port ယူနိုင်ရန် အလိုအလျောက် ပြင်ဆင်ပြီး ဖြစ်ပါသည်
server.listen(process.env.PORT || 3000, () => {
  console.log(`[SERVER RUNNING]`);
});
