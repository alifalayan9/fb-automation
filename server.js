
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Country, State } = require("country-state-city");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "https://alifalayan9.github.io";

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

const uploadDir = "/tmp/azim-uploads";
const clipDir = "/tmp/azim-clips";

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(clipDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 1
  }
});

const sessions = new Map();
const loginStates = new Map();
const clipJobs = new Map();

function graphUrl(endpoint) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`;
}

function getSession(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
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
  const error = new Error(
    data?.error?.message || `Meta API error (${response.status})`
  );
  error.status = response.status;
  throw error;
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error("FFmpeg is not available."));
    }

    const child = spawn(ffmpegPath, args);
    let errorText = "";

    child.stderr.on("data", data => {
      errorText += data.toString();
      if (errorText.length > 12000) {
        errorText = errorText.slice(-12000);
      }
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code === 0) {
        resolve(errorText);
      } else {
        reject(new Error(
          errorText.slice(-700) || "ভিডিও প্রসেস করা যায়নি।"
        ));
      }
    });
  });
}

// Backend status
app.get("/", (req, res) => {
  res.json({
    app: "AZIM AUTOMATION",
    status: "Backend Running",
    version: "4.0.0"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AZIM Automation Backend is working"
  });
});

// Country list
app.get("/api/countries", (req, res) => {
  const countries = Country.getAllCountries()
    .map(country => ({
      code: country.isoCode,
      name: country.name
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ success: true, countries });
});

// Region list
app.get("/api/regions/:countryCode", (req, res) => {
  const code = String(req.params.countryCode || "").toUpperCase();
  const country = Country.getCountryByCode(code);

  if (!country) {
    return res.status(404).json({
      success: false,
      message: "Country not found"
    });
  }

  const regions = State.getStatesOfCountry(code)
    .map(region => ({
      code: region.isoCode,
      name: region.name
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    success: true,
    country: {
      code: country.isoCode,
      name: country.name
    },
    regions
  });
});

// Split video into 30-second clips, maximum 30 clips
app.post("/api/clips/split", upload.single("video"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      success: false,
      message: "ভিডিও নির্বাচন করুন।"
    });
  }

  const jobId = crypto.randomBytes(16).toString("hex");
  const jobFolder = path.join(clipDir, jobId);

  try {
    fs.mkdirSync(jobFolder, { recursive: true });

    const probe = spawn(ffmpegPath, ["-i", file.path]);
    let metadata = "";

    probe.stderr.on("data", data => {
      metadata += data.toString();
    });

    await new Promise((resolve, reject) => {
      probe.on("close", resolve);
      probe.on("error", reject);
    });

    const match = metadata.match(
      /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/
    );

    if (!match) {
      throw new Error("ভিডিওর দৈর্ঘ্য নির্ধারণ করা যায়নি।");
    }

    const duration =
      Number(match[1]) * 3600 +
      Number(match[2]) * 60 +
      Number(match[3]);

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("ভিডিওটি সঠিক নয়।");
    }

    const count = Math.min(30, Math.ceil(duration / 30));
    const clips = [];

    for (let i = 0; i < count; i++) {
      const start = i * 30;
      const length = Math.min(30, duration - start);

      const filename =
        `clip-${String(i + 1).padStart(2, "0")}.mp4`;

      const output = path.join(jobFolder, filename);

      await runFFmpeg([
        "-ss", String(start),
        "-i", file.path,
        "-t", String(length),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", output
      ]);

      clips.push({
        number: i + 1,
        seconds: Math.round(length * 100) / 100,
        filename
      });
    }

    clipJobs.set(jobId, {
      folder: jobFolder,
      clips,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      jobId,
      clips,
      totalClips: clips.length,
      truncated: duration > 900
    });

  } catch (error) {
    await fs.promises.rm(jobFolder, {
      recursive: true,
      force: true
    }).catch(() => {});

    res.status(500).json({
      success: false,
      message: error.message || "ক্লিপ তৈরি করা যায়নি।"
    });

  } finally {
    await fs.promises.unlink(file.path).catch(() => {});
  }
});

// Download a clip
app.get("/api/clips/:jobId/:filename", (req, res) => {
  const job = clipJobs.get(req.params.jobId);
  const filename = req.params.filename;

  if (
    !job ||
    !/^clip-\d{2}\.mp4$/.test(filename) ||
    !job.clips.some(clip => clip.filename === filename)
  ) {
    return res.status(404).send("Clip not found");
  }

  res.download(path.join(job.folder, filename));
});

// Facebook login
app.get("/auth/facebook", (req, res) => {
  if (!APP_ID || !APP_SECRET || !REDIRECT_URI || !CONFIG_ID) {
    return res.status(500).send(
      "Meta configuration missing. Check Render environment variables."
    );
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

// Facebook callback
app.get("/auth/facebook/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(
        "Facebook Login was cancelled or denied."
      );
    }

    const created = loginStates.get(state);

    if (
      !code ||
      !state ||
      !created ||
      Date.now() - created > 10 * 60 * 1000
    ) {
      return res.status(400).send(
        "Login state invalid or expired. Connect again."
      );
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
    pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", tokenData.access_token);

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
      `Facebook connection failed: ${error.message}`
    );
  }
});

// Redeem login ticket
app.post("/api/session/redeem", (req, res) => {
  const ticket = String(req.body?.ticket || "");
  const session = sessions.get(ticket);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Login ticket invalid or expired."
    });
  }

  res.json({
    success: true,
    sessionToken: ticket
  });
});

// Connected Pages
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

// Publish video to Pages
app.post(
  "/api/publish",
  getSession,
  upload.single("video"),
  async (req, res) => {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "ভিডিও নির্বাচন করুন।"
      });
    }

    try {
      const {
        pageIds,
        type,
        title = "",
        description = "",
        scheduleAt = ""
      } = req.body;

      let ids;

      try {
        ids = JSON.parse(pageIds || "[]");
      } catch {
        ids = [];
      }

      if (!Array.isArray(ids) || ids.length === 0) {
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
          message: "One or more selected Pages are not connected."
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
          message: "Scheduled time must be 10 minutes to 6 months in the future."
        });
      }

      const buffer = await fs.promises.readFile(file.path);
      const results = [];

      for (const page of selected) {
        try {
          if (
            !page.tasks.includes("CREATE_CONTENT") &&
            !page.tasks.includes("MANAGE")
          ) {
            throw new Error(
              "This account does not have publishing access for this Page."
            );
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
              throw new Error(
                "Meta did not return a Reel upload session."
              );
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

            finishUrl.searchParams.set("video_id", start.video_id);
            finishUrl.searchParams.set("upload_phase", "finish");
            finishUrl.searchParams.set("video_state", "PUBLISHED");
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

      res.status(error.status || 500).json({
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

// Error handler
app.use((error, req, res, next) => {
  console.error(error.message);

  const tooLarge = error.code === "LIMIT_FILE_SIZE";

  res.status(tooLarge ? 413 : 500).json({
    success: false,
    message: tooLarge
      ? "ভিডিও 500 MB-এর বেশি হতে পারবে না।"
      : "Server error."
  });
});

app.listen(PORT, () => {
  console.log(`AZIM AUTOMATION API running on port ${PORT}`);
});
