const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    app: "AZIM AUTOMATION",
    status: "Backend Running",
    message: "Welcome to AZIM Automation API"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AZIM Automation Backend is working"
  });
});

app.get("/api/pages", (req, res) => {
  res.json({
    success: true,
    pages: [],
    message: "Facebook connection is not configured yet"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`AZIM API running on port ${PORT}`);
});
