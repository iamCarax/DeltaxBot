import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 variables (pueden ser undefined, NO rompen)
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

let cachedMessages = [];
let lastMessageId = null;

// ruta raíz OBLIGATORIA
app.get("/", (req, res) => {
  res.send("Servidor activo ✅");
});

// endpoint para PenguinMod
app.get("/messages", (req, res) => {
  res.json(cachedMessages);
});

// polling (solo si hay token y canal)
setInterval(async () => {
  if (!BOT_TOKEN || !CHANNEL_ID) return;

  try {
    let url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=5`;
    if (lastMessageId) url += `&after=${lastMessageId}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    const data = await r.json();
    if (!Array.isArray(data)) return;

    data.reverse().forEach(msg => {
      lastMessageId = msg.id;
      cachedMessages.push({
        author: msg.author.username,
        content: msg.content
      });
    });

    cachedMessages = cachedMessages.slice(-20);

  } catch (e) {
    console.error("Polling error:", e);
  }
}, 5000);

// escuchar puerto
app.listen(PORT, () => {
  console.log("Servidor escuchando en", PORT);
});
