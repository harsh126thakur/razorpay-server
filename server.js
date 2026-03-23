import express from "express";
import Razorpay from "razorpay";
import cors from "cors";
import crypto from "crypto";

const app = express();

// ================= MIDDLEWARE =================
app.use(express.json({ limit: "25mb" }));
app.use(cors());

// ================= RAZORPAY SETUP =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================= GITHUB CONFIG =================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "harsh126thakur";
const GITHUB_REPO = process.env.GITHUB_REPO || "designtechvlsi";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_MEDIA_BASE_PATH = process.env.GITHUB_MEDIA_BASE_PATH || "question-library";

function sanitizeFolderName(name = "") {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-");
}

function sanitizeFileName(name = "") {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getGithubApiUrl(path) {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
}

function getRawFileUrl(path) {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data.message || `GitHub API error: ${response.status}`);
  }

  return data;
}

async function createOrUpdateGithubFile(path, contentBase64, message) {
  const url = getGithubApiUrl(path);
  let sha = null;

  try {
    const existing = await githubRequest(url, { method: "GET" });
    sha = existing.sha || null;
  } catch (error) {
    const msg = String(error.message || "").toLowerCase();
    if (!msg.includes("not found")) {
      sha = null;
    }
  }

  const body = {
    message,
    content: contentBase64,
    branch: GITHUB_BRANCH
  };

  if (sha) {
    body.sha = sha;
  }

  return githubRequest(url, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

// ================= TEST ROUTE =================
app.get("/", (req, res) => {
  res.send("Razorpay Backend + GitHub Media API Running 🚀");
});

// ================= PING ROUTE =================
app.get("/ping", (req, res) => {
  res.json({ ok: true, message: "Server is live" });
});

// ================= DEBUG GITHUB ROUTE =================
app.get("/debug-github", (req, res) => {
  res.json({
    hasGithubToken: !!GITHUB_TOKEN,
    githubOwner: GITHUB_OWNER,
    githubRepo: GITHUB_REPO,
    githubBranch: GITHUB_BRANCH,
    githubMediaBasePath: GITHUB_MEDIA_BASE_PATH
  });
});

// ================= CREATE ORDER =================
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: "receipt_" + Date.now()
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error("CREATE ORDER ERROR:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// ================= VERIFY PAYMENT =================
app.post("/verify-payment", (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false });
    }
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

// ================= GITHUB CREATE FOLDER =================
app.post("/api/github/create-folder", async (req, res) => {
  try {
    if (!GITHUB_TOKEN) {
      return res.status(500).json({
        success: false,
        message: "GitHub token is missing in server environment"
      });
    }

    const { folderName } = req.body;
    const safeFolderName = sanitizeFolderName(folderName);

    if (!safeFolderName) {
      return res.status(400).json({
        success: false,
        message: "Valid folder name is required"
      });
    }

    const folderPath = `${GITHUB_MEDIA_BASE_PATH}/${safeFolderName}`;
    const keepFilePath = `${folderPath}/.gitkeep`;
    const emptyContentBase64 = Buffer.from("").toString("base64");

    await createOrUpdateGithubFile(
      keepFilePath,
      emptyContentBase64,
      `Create media folder ${safeFolderName}`
    );

    return res.json({
      success: true,
      message: "Folder created successfully",
      folderName: safeFolderName,
      githubPath: folderPath,
      keepFilePath,
      folderUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/tree/${GITHUB_BRANCH}/${folderPath}`
    });
  } catch (err) {
    console.error("CREATE FOLDER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create folder on GitHub",
      error: err.message
    });
  }
});

// ================= GITHUB UPLOAD IMAGE =================
app.post("/api/github/upload-image", async (req, res) => {
  try {
    if (!GITHUB_TOKEN) {
      return res.status(500).json({
        success: false,
        message: "GitHub token is missing in server environment"
      });
    }

    const { folderName, fileName, fileBase64 } = req.body;

    const safeFolderName = sanitizeFolderName(folderName);
    const safeFileName = sanitizeFileName(fileName);

    if (!safeFolderName || !safeFileName || !fileBase64) {
      return res.status(400).json({
        success: false,
        message: "folderName, fileName and fileBase64 are required"
      });
    }

    const cleanBase64 = String(fileBase64).includes(",")
      ? String(fileBase64).split(",")[1]
      : String(fileBase64);

    const filePath = `${GITHUB_MEDIA_BASE_PATH}/${safeFolderName}/${safeFileName}`;

    await createOrUpdateGithubFile(
      filePath,
      cleanBase64,
      `Upload media ${safeFileName} to ${safeFolderName}`
    );

    const rawUrl = getRawFileUrl(filePath);
    const githubFileUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${GITHUB_BRANCH}/${filePath}`;

    return res.json({
      success: true,
      message: "Image uploaded successfully",
      folderName: safeFolderName,
      fileName: safeFileName,
      githubPath: filePath,
      rawUrl,
      githubFileUrl
    });
  } catch (err) {
    console.error("UPLOAD IMAGE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to upload image to GitHub",
      error: err.message
    });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});