// middlewares/auth.js
require('dotenv').config();

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.ACCESS_KEY) {
    return res.status(403).json({ message: 'Forbidden: Invalid or missing API key.' });
  }

  next();
}

module.exports = authMiddleware;
// This middleware checks for the presence of an API key in the request headers.
// If the API key is missing or invalid, it responds with a 403 Forbidden status.   