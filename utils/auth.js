// backend/utils/auth.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = "your-secret-key"; // Replace with a strong secret key

// Function to generate JWT token
const generateToken = (user) => {
    return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
};

// Function to verify JWT token
const verifyToken = (token) => {
    return jwt.verify(token, JWT_SECRET);
};

module.exports = { generateToken, verifyToken };
