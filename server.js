// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3000", 10);
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const CHANNEL_ID = process.env.CHANNEL_ID || "";
const POLL_MS = parseInt(process.env.POLL_MS || "5000", 10);
const MESSAGES_LIMIT = parseInt(process.env.MESSAGES_LIMIT || "50", 10);

// simple in-memory cache (keeps up to 200 messages)
let cachedMessages = [];
let lastMessageId = null;
let isPolling = false;

function log(...args) { console.log(new Date().toISOString(), ...args); }

if (!BOT_TOKEN) {
  log("WARN: DISCORD_BOT_TOKEN not set. Set it in environment variables.");
}
if (!CHANNEL_ID) {
  log("WARN: CHANNEL_ID not set. Set it in environment variables.");
}

// Helper: call Discord API to get messages
async function fetchMessagesFromDiscord(limit = 10, afterId = null) {
  if (!BOT_TOKEN || !CHANNEL_ID) return [];
  try {
    let url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
    if (afterId) url += `&after=${afterId}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "User-Agent": "DiscordPollingServer/1.0"
      },
      timeout: 10000
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      log("Discord API error:", res.status, body);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data;
  } catch (err) {
    log("Error fetching from Discord:", err && err.message ? err.message : err);
    return [];
  }
}

// Polling loop: fetch new messages regularly
async function doPoll() {
  if (isPolling) return;
  if (!BOT_TOKEN || !CHANNEL_ID) return;
  isPolling = true;
  try {
    // On first run, we want the last N messages, so don't use after param
    const useAfter = lastMessageId ? lastMessageId : null;
    // If lastMessageId present, fetch newer messages only; otherwise fetch recent set
    const limit = lastMessageId ? 10 : Math.min(MESSAGES_LIMIT, 50);
    const msgs = await fetchMessagesFromDiscord(limit, useAfter);

    if (Array.isArray(msgs) && msgs.length > 0) {
      // Discord returns newest-first. Reverse to push oldest->newest into cache.
      msgs.reverse().forEach(m => {
        // Normalize message object
        const normalized = {
          id: m.id,
          author: (m.author && (m.author.username || m.author.name)) || "unknown",
          authorId: (m.author && m.author.id) || null,
          content: m.content || "",
          timestamp: m.timestamp || null
        };
        // Avoid duplicates
        if (!cachedMessages.find(x => x.id === normalized.id)) {
          cachedMessages.push(normalized);
        }
        lastMessageId = normalized.id;
      });
      // trim to last 200 messages
      if (cachedMessages.length > 200) {
        cachedMessages = cachedMessages.slice(-200);
      }
      log(`Poll: got ${msgs.length} message(s), cache=${cachedMessages.length}`);
    } else {
      // no new messages
      // log("Poll: no new messages");
    }
  } catch (err) {
    log("Poll error:", err);
  } finally {
    isPolling = false;
  }
}

// Start polling interval
setInterval(() => {
  doPoll().catch(e => log("Polling outer error:", e));
}, POLL_MS);
doPoll().catch(e => log("Initial poll error:", e));

// --- HTTP endpoints ---

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Server running" });
});

app.get("/debug", (req, res) => {
  res.json({
    lastMessageId,
    cachedCount: cachedMessages.length,
    pollMs: POLL_MS
  });
});

// GET messages. Optional query: ?sinceId=xxxx (returns messages with id > sinceId)
app.get("/messages", (req, res) => {
  const sinceId = req.query.sinceId;
  if (sinceId) {
    const newer = cachedMessages.filter(m => m.id > sinceId);
    return res.json(newer);
  }
  // return last MESSAGES_LIMIT messages
  const out = cachedMessages.slice(-MESSAGES_LIMIT);
  res.json(out);
});

// POST /send { content: "hola" }  -> sends a message to the channel
// NOTE: the bot must have Send Messages permission for this to work.
app.post("/send", async (req, res) => {
  const body = req.body || {};
  const content = body.content;
  if (!content || !BOT_TOKEN || !CHANNEL_ID) {
    return res.status(400).json({ error: "Missing content or server not configured" });
  }
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: "Discord API error", status: r.status, body: data });
    }
    // push to cache too
    cachedMessages.push({
      id: data.id,
      author: data.author?.username || "bot",
      authorId: data.author?.id || null,
      content: data.content || content,
      timestamp: data.timestamp || new Date().toISOString()
    });
    if (cachedMessages.length > 200) cachedMessages = cachedMessages.slice(-200);
    return res.json(data);
  } catch (err) {
    log("Error sending to Discord:", err);
    return res.status(500).json({ error: err.message || err });
  }
});

// Start HTTP server
app.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
