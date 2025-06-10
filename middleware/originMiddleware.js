const allowOrigin = (req, res, next) => {
    const allowedOrigins = process.env.ALLOW_ON.split(',');
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        return next();
    }
    // Example: exclude /preview from CORS middleware
    if (req.path.startsWith('/preview')) return next();


    // Block anything not from your frontend
    return res.status(403).json({ error: 'Forbidden' });
}

module.exports = allowOrigin;