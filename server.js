
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const {
  Country,
  State
} = require("country-state-city");

const app = express();

const PORT = process.env.PORT || 3000;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ||
  "https://alifalayan9.github.io";

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "https://alifalayan9.github.io/fb-automation/";

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const CONFIG_ID = process.env.META_CONFIG_ID;

app.set("trust proxy", 1);

app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

const loginStates = new Map();
const sessions = new Map();

const uploadDir = "/tmp/azim-uploads";

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 1
  }
});

function graphUrl(endpoint) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`;
}

function getSession(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";

  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Facebook connection expired. Connect again."
    });
  }

  req.azimSession = session;
  next();
}

async function graphError(response) {
  const data = await response.json().catch(() => ({}));

  throw new Error(
    data?.error?.message ||
    `Meta API error (${response.status})`
  );
}

app.get("/", (req, res) => {
  res.json({
    app: "AZIM AUTOMATION",
    version: "3.0.0",
    status: "Backend Running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AZIM Automation Backend is working"
  });
});

// COUNTRY LIST
app.get("/api/countries", (req, res) => {
  try {
    const countries = Country.getAllCountries()
      .map(country => ({
        name: country.name,
        isoCode: country.isoCode
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      countries
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Country list unavailable."
    });
  }
});

// STATE / DIVISION / PROVINCE LIST
app.get("/api/regions/:countryCode", (req, res) => {
  try {
    const code = String(req.params.countryCode || "")
      .toUpperCase();

    if (!/^[A-Z]{2}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: "Invalid country code."
      });
    }

    const regions = State.getStatesOfCountry(code)
      .map(state => ({
        name: state.name,
        code: state.isoCode,
        countryCode: state.countryCode
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      regions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Region list unavailable."
    });
  }
});

// FACEBOOK LOGIN
app.get("/auth/facebook", (req, res) => {
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI || !CONFIG_ID) {
    return res.status(500).send("Meta configuration missing.");
  }

  const state = crypto.randomBytes(24).toString("hex");

  loginStates.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    config_id: CONFIG_ID,
    response_type: "code",
    state
  });

  res.redirect(
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`
  );
});

// FACEBOOK CALLBACK
app.get("/auth/facebook/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send("Facebook Login cancelled.");
    }

    const created = loginStates.get(state);

    if (
      !code ||
      !state ||
      !created ||
      Date.now() - created > 10 * 60 * 1000
    ) {
      return res.status(400).send("Invalid login state.");
    }

    loginStates.delete(state);

    const params = new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      redirect_uri: REDIRECT_URI,
      code: String(code)
    });

    const tokenResponse = await fetch(
      graphUrl(`oauth/access_token?${params}`)
    );

    if (!tokenResponse.ok) {
      await graphError(tokenResponse);
    }

    const tokenData = await tokenResponse.json();

    const pagesUrl = new URL(graphUrl("me/accounts"));

    pagesUrl.searchParams.set(
      "fields",
      "id,name,access_token,tasks"
    );

    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set(
      "access_token",
      tokenData.access_token
    );

    const pagesResponse = await fetch(pagesUrl);

    if (!pagesResponse.ok) {
      await graphError(pagesResponse);
    }

    const pagesData = await pagesResponse.json();

    const pages = (pagesData.data || []).map(page => ({
      id: page.id,
      name: page.name,
      access_token: page.access_token,
      tasks: page.tasks || []
    }));

    const sessionToken = crypto.randomBytes(32).toString("hex");

    sessions.set(sessionToken, {
      pages,
      createdAt: Date.now()
    });

    res.redirect(`${FRONTEND_URL}#connected=${sessionToken}`);

  } catch (error) {
    console.error("Facebook callback:", error.message);

    res.status(400).send(
      "Facebook connection failed: " + error.message
    );
  }
});

// REDEEM SESSION
app.post("/api/session/redeem", (req, res) => {
  const ticket = String(req.body?.ticket || "");
  const session = sessions.get(ticket);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Login ticket invalid."
    });
  }

  res.json({
    success: true,
    sessionToken: ticket
  });
});

// GET PAGES
app.get("/api/pages", getSession, (req, res) => {
  res.json({
    success: true,
    pages: req.azimSession.pages.map(page => ({
      id: page.id,
      name: page.name,
      tasks: page.tasks
    }))
  });
});

// PUBLISH
app.post(
  "/api/publish",
  getSession,
  upload.single("video"),
  async (req, res) => {
    const file = req.file;

    try {
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Choose a video file."
        });
      }

      const {
        pageIds,
        type,
        title = "",
        description = "",
        scheduleAt = "",
        excludedCountries = "",
        excludedRegions = ""
      } = req.body;

      let ids;

      try {
        ids = JSON.parse(pageIds || "[]");
      } catch {
        ids = [];
      }

      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({
          success: false,
          message: "Select at least one Page."
        });
      }

      if (!["video", "reel"].includes(type)) {
        return res.status(400).json({
          success: false,
          message: "Choose Video or Reel."
        });
      }

      const selected = req.azimSession.pages.filter(
        page => ids.includes(page.id)
      );

      if (selected.length !== ids.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid selected Page."
        });
      }

      const schedule = scheduleAt
        ? Math.floor(new Date(scheduleAt).getTime() / 1000)
        : null;

      if (
        scheduleAt &&
        (
          !Number.isFinite(schedule) ||
          schedule < Math.floor(Date.now() / 1000) + 600 ||
          schedule > Math.floor(Date.now() / 1000) + 180 * 86400
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Schedule must be 10 minutes to 6 months ahead."
        });
      }

      // Read file once. Large uploads may require more server memory.
      const buffer = await fs.promises.readFile(file.path);
      const results = [];

      for (const page of selected) {
        try {
          if (
            !page.tasks.includes("CREATE_CONTENT") &&
            !page.tasks.includes("MANAGE")
          ) {
            throw new Error("Page publishing permission missing.");
          }

          let result;

          if (type === "video") {
            const form = new FormData();

            form.append(
              "source",
              new Blob([buffer], {
                type: file.mimetype || "video/mp4"
              }),
              file.originalname
            );

            form.append("access_token", page.access_token);
            form.append("title", title);
            form.append("description", description);

            if (schedule) {
              form.append("published", "false");
              form.append(
                "scheduled_publish_time",
                String(schedule)
              );
            } else {
              form.append("published", "true");
            }

            // Do not send unverified region names or IDs.
            // Audience restriction requires Meta-supported
            // targeting IDs and endpoint-specific validation.

            const response = await fetch(
              graphUrl(`${page.id}/videos`),
              {
                method: "POST",
                body: form
              }
            );

            if (!response.ok) {
              await graphError(response);
            }

            result = await response.json();

          } else {
            const startUrl = new URL(
              graphUrl(`${page.id}/video_reels`)
            );

            startUrl.searchParams.set("upload_phase", "start");
            startUrl.searchParams.set(
              "access_token",
              page.access_token
            );

            const startResponse = await fetch(startUrl, {
              method: "POST"
            });

            if (!startResponse.ok) {
              await graphError(startResponse);
            }

            const start = await startResponse.json();

            if (!start.video_id || !start.upload_url) {
              throw new Error("Reel upload session unavailable.");
            }

            const uploadResponse = await fetch(start.upload_url, {
              method: "POST",
              headers: {
                Authorization: `OAuth ${page.access_token}`,
                offset: "0",
                file_size: String(buffer.length),
                "Content-Type": "application/octet-stream"
              },
              body: buffer
            });

            if (!uploadResponse.ok) {
              await graphError(uploadResponse);
            }

            const finishUrl = new URL(
              graphUrl(`${page.id}/video_reels`)
            );

            finishUrl.searchParams.set(
              "video_id",
              start.video_id
            );

            finishUrl.searchParams.set("upload_phase", "finish");

            finishUrl.searchParams.set(
              "video_state",
              schedule ? "SCHEDULED" : "PUBLISHED"
            );

            finishUrl.searchParams.set(
              "access_token",
              page.access_token
            );

            if (title) {
              finishUrl.searchParams.set("title", title);
            }

            if (description) {
              finishUrl.searchParams.set(
                "description",
                description
              );
            }

            if (schedule) {
              finishUrl.searchParams.set(
                "scheduled_publish_time",
                String(schedule)
              );
            }

            const finishResponse = await fetch(finishUrl, {
              method: "POST"
            });

            if (!finishResponse.ok) {
              await graphError(finishResponse);
            }

            result = await finishResponse.json();
          }

          results.push({
            pageId: page.id,
            pageName: page.name,
            success: true,
            id: result.id || result.video_id || null
          });

        } catch (error) {
          results.push({
            pageId: page.id,
            pageName: page.name,
            success: false,
            error: error.message
          });
        }
      }

      res.json({
        success: results.some(item => item.success),
        results
      });

    } catch (error) {
      console.error("Publish error:", error.message);

      res.status(500).json({
        success: false,
        message: error.message
      });

    } finally {
      if (file?.path) {
        await fs.promises.unlink(file.path).catch(() => {});
      }
    }
  }
);

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(
    err.code === "LIMIT_FILE_SIZE" ? 413 : 500
  ).json({
    success: false,
    message:
      err.code === "LIMIT_FILE_SIZE"
        ? "Video is larger than 500 MB."
        : "Server error."
  });
});

app.listen(PORT, () => {
  console.log(`AZIM API running on port ${PORT}`);
});
