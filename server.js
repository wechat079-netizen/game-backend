const express = require('express');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Public folder ထဲက HTML/CSS များကို Static အဖြစ် သတ်မှတ်ခြင်း
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Admin Setup (Environment Variable ရှိရင် ချိတ်မည်)
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized Successfully!");
    } catch (e) {
        console.log("Firebase Config Error:", e.message);
    }
}

// Memory Store for Game Control
let forcedResults = { '30s': null, '60s': null };

// API Routes
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/admin/set-result', (req, res) => {
    const { gameType, choice, number } = req.body;
    if (gameType) {
        forcedResults[gameType] = { choice, number };
        return res.json({ success: true, message: `${gameType} အတွက် ရလဒ် ပြင်ဆင်ပြီးပါပြီ!` });
    }
    return res.status(400).json({ success: false, message: "Game Type မှားယွင်းနေပါသည်။" });
});

// App Bet API
app.post('/api/place-bet', (req, res) => {
    res.json({ success: true, message: "Bet placed successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));