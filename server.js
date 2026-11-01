const express = require("express");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = "https://alifalayan9.github.io/fb-automation/";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";

app.set("trust proxy", 1);

app.use(cors({
  origin: "https://alifalayan9.github.io",
  credentials: true
}));

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const CONFIG_ID = process.env.META_CONFIG_ID;

app.get("/", (req, res) => {
  res.json({
    app: "AZIM AUTOMATION",
    status: "Backend Running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AZIM Automation Backend is working"
  });
});

// Facebook Business Login
app.get("/auth/facebook", (req, res) => {
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI || !CONFIG_ID) {
    return res.status(500).send("Meta configuration missing");
  }

  const state = crypto.randomBytes(32).toString("hex");
  req.session.oauthState = state;

  req.session.save((error) => {
    if (error) {
      return res.status(500).send("Session error");
    }

    const params = new URLSearchParams({
      client_id: APP_ID,
      redirect_uri: REDIRECT_URI,
      config_id: CONFIG_ID,
      response_type: "code",
      state: state
    });

    res.redirect(
      `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`
    );
  });
});

// Facebook Login Callback
app.get("/auth/facebook/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send("Facebook Login was cancelled or denied.");
    }

    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send("Invalid OAuth state.");
    }

    delete req.session.oauthState;

    const tokenParams = new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      redirect_uri: REDIRECT_URI,
      code: code
    });

    const tokenResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${tokenParams}`
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Facebook token exchange failed");
      return res.status(400).send("Facebook token exchange failed.");
    }

    const pagesUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`
    );

    pagesUrl.searchParams.set(
      "fields",
      "id,name,access_token,tasks"
    );

    pagesUrl.searchParams.set(
      "access_token",
      tokenData.access_token
    );

    const pagesResponse = await fetch(pagesUrl);
    const pagesData = await pagesResponse.json();

    if (!pagesResponse.ok || pagesData.error) {
      console.error("Facebook Page sync failed");
      return res.status(400).send("Could not load Facebook Pages.");
    }

    req.session.pages = (pagesData.data || []).map(page => ({
      id: page.id,
      name: page.name,
      access_token: page.access_token,
      tasks: page.tasks || []
    }));

    req.session.facebookConnected = true;

    req.session.save((err) => {
      if (err) {
        return res.status(500).send("Could not save session.");
      }

      res.redirect(FRONTEND_URL + "?facebook=connected");
    });

  } catch (error) {
    console.error("Facebook callback error:", error.message);
    res.status(500).send("Facebook connection failed.");
  }
});

// Get connected Pages
app.get("/api/pages", (req, res) => {
  if (!req.session.facebookConnected) {
    return res.status(401).json({
      success: false,
      message: "Facebook connection required"
    });
  }

  const pages = req.session.pages || [];

  res.json({
    success: true,
    pages: pages.map(page => ({
      id: page.id,
      name: page.name,
      tasks: page.tasks
    }))
  });
});

// Disconnect Facebook
app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true,
      message: "Disconnected"
    });
  });
});

app.listen(PORT, () => {
  console.log(`AZIM API running on port ${PORT}`);
});
