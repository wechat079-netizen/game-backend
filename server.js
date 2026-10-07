const express = require('express');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Render Environment Variable မှ Firebase Config ဖတ်ယူခြင်း
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://YOUR_FIREBASE_PROJECT_ID.firebaseio.com" // မိမိ Firebase URL ထည့်ပါ
});

const db = admin.database();

// Admin forced result memory
let forcedResults = { '30s': null, '60s': null };

// 1. Bet တင်သည့် API (Server မှ ငွေတိုက်ရိုက်နှုတ်မည်)
app.post('/api/place-bet', async (req, res) => {
    const { uid, choice, amount, gameType } = req.body;

    if (!uid || !choice || !amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "အချက်အလက် မှားယွင်းနေပါသည်!" });
    }

    const userRef = db.ref(`user/${uid}`);

    try {
        const result = await userRef.transaction((userData) => {
            if (userData) {
                let currentMoney = userData.money || 0;
                let currentVipMoney = userData.vipmoney || 0;

                if (currentMoney >= amount) {
                    userData.money = currentMoney - amount;
                    userData.vipmoney = currentVipMoney + amount;
                    return userData;
                }
            }
            return; 
        });

        if (!result.committed) {
            return res.status(400).json({ success: false, message: "လက်ကျန်ငွေ မလုံလောက်ပါ!" });
        }

        return res.json({ success: true, message: "ထိုးကြေး တင်ပြီးပါပြီ!" });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Admin Dashboard Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 3. Admin Forced Result Set API
app.post('/api/admin/set-result', (req, res) => {
    const { gameType, number } = req.body;
    if (number >= 0 && number <= 9) {
        forcedResults[gameType] = parseInt(number);
        return res.json({ success: true, message: `${gameType} အတွက် အနိုင်ဂဏန်း ${number} သတ်မှတ်ပြီးပါပြီ!` });
    }
    return res.status(400).json({ success: false, message: "မှားယွင်းသော ဂဏန်းဖြစ်ပါသည်!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
