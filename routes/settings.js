const express = require("express");
const router = express.Router();
const { getIncomeExpenseRules } = require("../utils/plaid");

router.get("/", async (req, res) => {
    if (!req.session.tokens) {
        return res.redirect('/auth/login');
    }

    try {
        const rules = await getIncomeExpenseRules(req.session.userinfo.families[0].familyid);

        res.render("settings", {
            userinfo: req.session.userinfo,
            rules: rules || { excludedMerchants: [], merchantCategory: {} }
        });
    } catch (error) {
        console.error("Error fetching settings data:", error);
        res.status(500).send("Error loading settings");
    }
});

module.exports = router; 