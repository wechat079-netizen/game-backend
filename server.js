<!DOCTYPE html>
<html lang="my">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Game Admin Panel</title>

    <style>
        body {
            font-family: sans-serif;
            background: #f4f6f9;
            margin: 0;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        h2 {
            color: #333;
        }

        .login-box {
            text-align: center;
            margin-top: 100px;
        }

        .login-box input {
            padding: 10px;
            font-size: 16px;
            width: 250px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }

        .login-box button {
            padding: 10px 20px;
            font-size: 16px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            display: block;
            margin-left: auto;
            margin-right: auto;
        }

        .hidden {
            display: none !important;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }

        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: center;
            font-size: 14px;
        }

        th {
            background: #007bff;
            color: white;
        }

        .btn {
            padding: 6px 12px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
    </style>
</head>

<body>

    <!-- Login Section -->
    <div id="loginSection" class="login-box">
        <h3>🔐 Admin Login</h3>

        <p>Admin Password ထည့်ပါ</p>

        <input
            type="password"
            id="adminPasswordInput"
            placeholder="Password ထည့်ရန်..."
            autocomplete="current-password"
        >

        <button onclick="doLogin()">ဝင်မည်</button>
    </div>


    <!-- Admin Dashboard Section -->
    <div id="adminDashboard" class="container hidden">

        <h2>🎮 Game Admin Dashboard</h2>

        <p>
            Status:
            <span
                id="serverTimer"
                style="font-weight: bold; color: green;"
            >
                Loading...
            </span>
        </p>

        <hr>

        <h3>Active Bets (လက်ရှိထိုးကြေးများ)</h3>

        <div style="margin-bottom: 10px;">

            <button
                class="btn"
                onclick="switchGame('30s')"
            >
                30s Game
            </button>

            <button
                class="btn"
                onclick="switchGame('60s')"
                style="background: #17a2b8;"
            >
                60s Game
            </button>

            <span
                id="currentGameLabel"
                style="margin-left: 10px; font-weight: bold;"
            >
                Current: 30s
            </span>

        </div>


        <table>

            <thead>
                <tr>
                    <th>Round</th>
                    <th>Player Name</th>
                    <th>Choice</th>
                    <th>Amount</th>
                    <th>Status</th>
                </tr>
            </thead>

            <tbody id="betsTableBody">
                <tr>
                    <td colspan="5">
                        ဒေတာ ရယူနေသည်...
                    </td>
                </tr>
            </tbody>

        </table>

    </div>


    <script>

        let currentGameType = '30s';
        let refreshTimer;
        let currentAdminPwd = '';

        /*
         * ==========================================
         * ADMIN PASSWORD
         * ==========================================
         */

        const ADMIN_PASSWORD = 'Peter125199';


        /*
         * ==========================================
         * LOGIN
         * ==========================================
         */

        function doLogin() {

            const pwd =
                document
                .getElementById('adminPasswordInput')
                .value
                .trim();


            if (!pwd) {

                alert('Password ထည့်ပါခင်ဗျာ။');

                return;
            }


            /*
             * Password စစ်ခြင်း
             */

            if (pwd !== ADMIN_PASSWORD) {

                alert('Password မှားယွင်းနေပါသည်။');

                document
                    .getElementById('adminPasswordInput')
                    .value = '';

                document
                    .getElementById('adminPasswordInput')
                    .focus();

                return;
            }


            /*
             * Server API ကို ဆက်လက်စစ်ဆေးခြင်း
             */

            fetch(
                `/api/admin/get-data?gameType=${currentGameType}`,
                {
                    headers: {
                        'x-admin-token': pwd
                    }
                }
            )

            .then(res => {

                if (!res.ok) {

                    throw new Error(
                        'Server မှ Admin Password ကို လက်မခံပါ။'
                    );
                }

                return res.json();
            })

            .then(data => {

                /*
                 * Password သိမ်းထားခြင်း
                 */

                currentAdminPwd = pwd;


                /*
                 * Login Section ဖျောက်ခြင်း
                 */

                document
                    .getElementById('loginSection')
                    .classList
                    .add('hidden');


                /*
                 * Dashboard ပြခြင်း
                 */

                document
                    .getElementById('adminDashboard')
                    .classList
                    .remove('hidden');


                /*
                 * Data ပြခြင်း
                 */

                renderDashboard(data);


                /*
                 * ၂ စက္ကန့်တိုင်း Data ပြန်ယူခြင်း
                 */

                clearInterval(refreshTimer);

                refreshTimer = setInterval(() => {

                    fetchData();

                }, 2000);

            })

            .catch(err => {

                alert(err.message);

            });

        }


        /*
         * ==========================================
         * FETCH DATA
         * ==========================================
         */

        function fetchData() {

            if (!currentAdminPwd) {
                return;
            }


            fetch(
                `/api/admin/get-data?gameType=${currentGameType}`,
                {
                    headers: {
                        'x-admin-token': currentAdminPwd
                    }
                }
            )

            .then(r => {

                if (!r.ok) {

                    throw new Error(
                        'ဒေတာ ရယူ၍ မရပါ။'
                    );

                }

                return r.json();

            })

            .then(d => {

                renderDashboard(d);

            })

            .catch(e => {

                console.log(e);

            });

        }


        /*
         * ==========================================
         * RENDER DASHBOARD
         * ==========================================
         */

        function renderDashboard(data) {

            document
                .getElementById('serverTimer')
                .innerText =
                `Round: ${data.round} | Timer: ${data.timer}s | Forced: ${data.forced}`;


            let tbody =
                document.getElementById(
                    'betsTableBody'
                );


            tbody.innerHTML = '';


            /*
             * Bets မရှိလျှင်
             */

            if (
                !data.bets ||
                data.bets.length === 0
            ) {

                tbody.innerHTML = `
                    <tr>
                        <td colspan="5">
                            လက်ရှိ ထိုးကြေး မရှိသေးပါ။
                        </td>
                    </tr>
                `;

                return;
            }


            /*
             * Bets ပြခြင်း
             */

            data.bets.forEach(b => {

                let tr =
                    document.createElement('tr');


                tr.innerHTML = `
                    <td>${b.round}</td>
                    <td>${b.playerName}</td>
                    <td><b>${b.choice}</b></td>
                    <td>${b.amount}</td>
                    <td>${b.status}</td>
                `;


                tbody.appendChild(tr);

            });

        }


        /*
         * ==========================================
         * SWITCH GAME
         * ==========================================
         */

        function switchGame(type) {

            currentGameType = type;


            document
                .getElementById('currentGameLabel')
                .innerText =
                `Current: ${type}`;


            /*
             * Game ပြောင်းပြီးတာနဲ့
             * Data ချက်ချင်းပြန်ယူမည်
             */

            fetchData();

        }


        /*
         * ==========================================
         * ENTER KEY LOGIN
         * ==========================================
         */

        document
            .getElementById('adminPasswordInput')
            .addEventListener(
                'keydown',
                function(e) {

                    if (e.key === 'Enter') {

                        doLogin();

                    }

                }
            );

    </script>

</body>
</html>