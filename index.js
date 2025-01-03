const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
const app = express();
require('dotenv').config();

// Middleware   
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Set up views and static folder
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Import routes
const authRoutes = require('./routes/auth');
const shoppingListRoutes = require('./routes/shoppingList');
const budgetRoutes = require('./routes/budget');

// Use routes
app.use('/auth', authRoutes);
app.use('/shopping-list', shoppingListRoutes);
app.use('/budget', budgetRoutes);

const familyRoutes = require("./routes/family");
app.use("/families", familyRoutes);

const homeRouter = require("./routes/home");
app.use("/home", homeRouter);

const settingsRouter = require("./routes/settings");
app.use("/settings", settingsRouter);

// Home route
app.get('/', (req, res) => {
  if (req.session.tokens) {
    res.redirect('/shopping-list');
  } else {
    res.render('index', { session: req.session });
  }
});

// Start server
const port = 8080;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
