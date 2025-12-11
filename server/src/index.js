const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { AccessToken } = require('livekit-server-sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

if (!apiKey || !apiSecret) {
    console.error('Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET in .env');
    process.exit(1);
}

// 🔹 make handler async and await toJwt()
app.post('/token', async (req, res) => {
    const { roomName, identity } = req.body;

    if (!roomName || !identity) {
        return res.status(400).json({ error: 'roomName and identity are required' });
    }

    try {
        const at = new AccessToken(apiKey, apiSecret, {
            identity,
            ttl: 60 * 60, // 1 hour
        });

        at.addGrant({
            roomJoin: true,
            room: roomName,
        });

        const token = await at.toJwt(); // 👈 important
        console.log('Generated token (first 40 chars):', token.slice(0, 40));
        res.json({ token });
    } catch (err) {
        console.error('Token generation error:', err);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`LiveKit token server running on http://localhost:${port}`);
});
