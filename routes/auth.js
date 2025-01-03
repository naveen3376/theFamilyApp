const express = require('express');
const axios = require('axios');
const router = express.Router();
const { Issuer } = require("openid-client");
const { getFamilies } = require("../utils/query");


let client;

(async () => {
    try {
        const cognitoIssuer = await Issuer.discover(process.env.COGNITO_ISSUER);
        console.log("Cognito Issuer discovered:", cognitoIssuer.issuer);

        client = new cognitoIssuer.Client({
            client_id: process.env.COGNITO_CLIENT_ID,
            client_secret: process.env.COGNITO_CLIENT_SECRET,
            redirect_uris: [callbackURL],
            response_types: ['code'],
        });

        console.log("OIDC client configured.");
    } catch (error) {
        console.error("Error setting up OIDC client:", error);
    }
})();

const callbackURL = process.env.NODE_ENV === "production" 
  ? process.env.COGNITO_REDIRECT_URI 
  : process.env.COGNITO_REDIRECT_URI_DEV;

  const logoutURL = process.env.NODE_ENV === "production" 
  ? process.env.COGNITO_LOGOUT_REDIRECT_URI 
  : process.env.COGNITO_LOGOUT_REDIRECT_URI_DEV;

// Login route
router.get("/login", (req, res) => {
    if (!client) {
        return res.status(500).send("OIDC client not configured.");
    }

//    req.session.nonce = nonce;
//    req.session.state = state;
    const authorizationUrl = client.authorizationUrl({
        scope: 'email openid phone profile',
    });

    res.redirect(authorizationUrl);
});

// Callback route
router.get("/callback", async (req, res) => {
    const { code } = req.query;

    try {
        const tokenSet = await client.callback(callbackURL, { code });
        const userinfo = await client.userinfo(tokenSet.access_token);

        req.session.tokens = tokenSet; // Access, ID, and refresh tokens
        req.session.userinfo = userinfo; // User details like email, name, etc.

        console.log("Tokens:", tokenSet);
        console.log("User info:", userinfo);

        const families = await getFamilies(userinfo.sub);
        req.session.userinfo.families = families;
        console.log("Families:", families);

        res.redirect("/home");
    } catch (error) {
        console.error("Error in callback:", error);
        res.redirect("/auth/login");
    }
});

// Logout route
router.get("/logout", (req, res) => {
    req.session.destroy(() => {
        console.log("User logged out, session destroyed.");
        const logoutUrl = client.endSessionUrl({
            logout_uri: logoutURL,
        });
        console.log(logoutUrl);
        res.redirect(logoutUrl); // Redirect to Cognito logout
    });
});

module.exports = router;