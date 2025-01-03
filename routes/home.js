const express = require("express");
const router = express.Router();
const { getAllLists } = require("../utils/query");
const { getMonthlyOverview, syncTransactions } = require("../utils/plaid");

router.get("/", async (req, res) => {
    if (!req.session.tokens) {
        return res.redirect('/auth/login');
    }

    try {
        // Check if user has any families
        if (!req.session.userinfo.families || req.session.userinfo.families.length === 0) {
            return res.render("home", {
                userinfo: req.session.userinfo,
                lists: [],
                monthlyincome: 0,
                monthlyexpense: 0,
                budget: 0,
                noFamily: true  // New flag to indicate no family exists
            });
        }

        const currentDate = new Date();
        const month = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        
        // Only sync and fetch transactions if bank account is linked
        let monthOverview = { income: 0, expenses: 0, budget: 0 };
        if (req.session.userinfo.families[0].plaidAccessToken) {
            await syncTransactions(req, res);
            monthOverview = await getMonthlyOverview(req.session.userinfo.families[0].familyid, month);
        }

        const lists = await getAllLists(req.session.userinfo.families[0].familyid);

        res.render("home", {
            userinfo: req.session.userinfo,
            lists: lists || [],
            monthlyincome: monthOverview.income || 0,
            monthlyexpense: monthOverview.expenses || 0,
            budget: monthOverview.budget || 0,
            noFamily: false
        });
    } catch (error) {
        console.error("Error fetching home page data:", error);
        res.status(500).send("Error loading home page");
    }
});

module.exports = router; 