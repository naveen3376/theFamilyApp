const express = require('express');
const { plaidClient, getTransactions, syncTransactions, getMonthlyOverview, getTransactionsByMonth, updateExpenseCategory, getIncomeExpenseRules, processTransactions, processMonthlyData, getPreviousMonthTransactions, getLast12MonthsSavings, getAggregatedChartData, getChartData } = require('../utils/plaid');
const { updateFamily } = require('../utils/query');
const router = express.Router();

router.post('/link-bank', async (req, res) => {
    try {
        const linkTokenResponse = await plaidClient.linkTokenCreate({
            user: { client_user_id: req.session.userinfo.sub }, // Replace with the actual user ID
            client_name: 'Family Collaboration App',
            products: ['transactions'],
            country_codes: ['US'],
            language: 'en',
        });

        res.json({ link_token: linkTokenResponse.data.link_token });
    } catch (error) {
        console.error('Error creating link token:', error);
        res.status(500).send('Unable to generate link token');
    }
});
// Route to exchange public token for access token
router.post("/exchange-public-token", async (req, res) => {
  const { public_token } = req.body;
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });
    const { access_token, item_id } = response.data;
    req.session.plaidAccessToken = access_token; // Save access token for future API calls

    const updateParams = {
        TableName: "Families",
        Key: { familyid: req.session.userinfo.families[0].familyid },
        UpdateExpression: "set plaidAccessToken = :accessToken, plaidItemId = :itemId",
        ExpressionAttributeValues: {
            ":accessToken": access_token,
            ":itemId": item_id,
        },
    };

    await updateFamily(updateParams);
    req.session.userinfo.families[0].plaidAccessToken = access_token;
    req.session.userinfo.families[0].plaidItemId = item_id;
    console.log("Session data:", req.session);
    res.json({ success: true });
  } catch (error) {
    console.error("Error exchanging public token:", error);
    res.status(500).send("Failed to exchange token");
  }
});

// Route to fetch transactions
router.get('/transactions', async (req, res) => {
    const access_token = req.session.userinfo.families[0].plaidAccessToken; // Access token saved during the linking process
    console.log("Session data:", req.session);
    if (!access_token) {
        return res.status(400).send("No access token found. Link a bank account first.");
    }

    try {
        console.log("Fetching transactions...");
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

        const response = await plaidClient.transactionsGet({
            access_token,
            start_date: startOfMonth,
            end_date: endOfMonth,
        });

        const transactions = response.data.transactions;
        // Classify transactions
        const income = transactions.filter(txn => txn.amount > 0);
        const expenses = transactions.filter(txn => txn.amount < 0);
        console.log("classified transactions", income, expenses);
        res.json({
            success: true,
            income,
            expenses,
            totalIncome: income.reduce((sum, txn) => sum + txn.amount, 0),
            totalExpenses: expenses.reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
        });
    } catch (error) {
        console.error("Error fetching transactions:", error.response ? error.response.data : error);
        res.status(500).send("Failed to fetch transactions.");
    }
});

router.get('/show-transactions', async (req, res) => {
    try {
        const response = await getTransactions(req.session.userinfo.families[0].plaidAccessToken, plaidClient);
        console.log("response", response);
        const { income, expenses, totalIncome, totalExpenses } = response;

        res.render('transactions', { income, expenses, totalIncome, totalExpenses });
    } catch (error) {
        console.error("Error displaying transactions:", error);
        res.status(500).send("Failed to display transactions.");
    }
});



router.get('/overview', async (req, res) => {
    try {
        if (!req.session.userinfo?.families?.[0]?.plaidAccessToken) {
            return res.status(401).json({ error: 'Not authenticated or no bank linked' });
        }

        const requestedYear = parseInt(req.query.year) || new Date().getFullYear();
        const requestedMonth = parseInt(req.query.month) || new Date().getMonth() + 1;

        // Run these operations in parallel
        const [
            chartData,
            monthOverview,
            savingsHistory
        ] = await Promise.all([
            getChartData(req.session.userinfo.families[0].familyid,req.session.userinfo.families[0].plaidAccessToken, requestedYear, requestedMonth),
            getMonthlyOverview(
                req.session.userinfo.families[0].familyid,
                `${String(requestedYear)}-${String(requestedMonth).padStart(2, "0")}`
            ),
            getLast12MonthsSavings(req.session.userinfo.families[0].familyid)
        ]);

        const responseData = {
            monthlyincome: monthOverview.income || 0,
            monthlyexpense: monthOverview.expenses || 0,
            budget: monthOverview.budget || 0,
            incomes: chartData.currentMonthTransactions.filter(txn => txn.amount > 0),
            expenses: chartData.currentMonthTransactions.filter(txn => txn.amount < 0),
            chartData,
            savingsHistory
        };

        if (req.xhr || req.headers.accept?.includes('application/json') || 
            req.headers['x-requested-with'] === 'XMLHttpRequest') {
            return res.json(responseData);
        }

        res.render("budget", {
            title: "Budget Overview",
            ...responseData
        });
    } catch (error) {
        console.error("Error fetching overview:", error);
        res.status(500).json({ 
            error: 'Failed to fetch overview',
            message: error.message 
        });
    }
});

router.get('/expense-categories', async (req, res) => {
    const userId = req.session.userinfo.sub;
    try {
        const expenses = await getCategorizedExpenses(userId);
        res.json(expenses);
    } catch (error) {
        console.error("Error fetching expenses:", error);
        res.status(500).send("Failed to fetch expenses.");
    }
});

router.post('/expense/update', async (req, res) => {
    console.log("req.body", req.body);
    const { transactionId, merchant, applyToAll, operation, category, exclude, type } = req.body;
    try {
        await updateExpenseCategory(req.session.userinfo.families[0].familyid, transactionId, merchant, applyToAll, operation, category, exclude, type);
        req.session.CategoryExclusionUpdated = true;
        res.send("Expense updated successfully.");
    } catch (error) {
        console.error("Error updating expense:", error);
        res.status(500).send("Failed to update expense.");
    }
});

router.post('/set-budget', async (req, res) => {
    const { budget } = req.body;
    const userId = req.session.userinfo.sub;
    try {
        await setMonthlyBudget(userId, budget);
        res.send("Budget set successfully.");
    } catch (error) {
        console.error("Error setting budget:", error);
        res.status(500).send("Failed to set budget.");
    }
});

router.get('/daily-expenses', async (req, res) => {
    try {
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        // Get first day of current and previous month
        const currentMonthStart = new Date(currentYear, currentMonth, 1);
        const previousMonthStart = new Date(currentYear, currentMonth - 1, 1);
        
        // Get transactions for both months
        const currentMonthData = await getTransactions(
            req.session.userinfo.families[0].plaidAccessToken,
            plaidClient,
            req.session.userinfo.families[0].familyid,
            currentMonthStart,
            today
        );
        
        const previousMonthData = await getTransactions(
            req.session.userinfo.families[0].plaidAccessToken,
            plaidClient,
            req.session.userinfo.families[0].familyid,
            previousMonthStart,
            new Date(currentYear, currentMonth, 0)  // Last day of previous month
        );

        // Process data into daily cumulative totals
        const processMonthlyData = (transactions, startDate, endDate) => {
            const dailyTotals = {};
            let cumulative = 0;
            const dates = [];
            const cumulativeAmounts = [];
            
            // Initialize all dates with 0
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                dailyTotals[dateStr] = 0;
                dates.push(dateStr);
            }
            
            // Sum transactions by date
            transactions.expenses.forEach(txn => {
                const dateStr = txn.date.split('T')[0];
                if (dailyTotals[dateStr] !== undefined) {
                    dailyTotals[dateStr] += txn.amount;
                }
            });
            
            // Calculate cumulative amounts
            dates.forEach(date => {
                cumulative += dailyTotals[date];
                cumulativeAmounts.push(cumulative);
            });
            
            return { dates, cumulative: cumulativeAmounts };
        };

        res.json({
            currentMonth: processMonthlyData(currentMonthData, currentMonthStart, today),
            previousMonth: processMonthlyData(previousMonthData, previousMonthStart, new Date(currentYear, currentMonth, 0))
        });

    } catch (error) {
        console.error('Error fetching daily expenses:', error);
        res.status(500).json({ error: 'Failed to fetch daily expenses' });
    }
});

module.exports = router;
