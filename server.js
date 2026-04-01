import express from "express";
import Razorpay from "razorpay";
import cors from "cors";
import crypto from "crypto";
import admin from "firebase-admin";

// ================= INIT =================
const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(cors());

// ================= FIREBASE ADMIN =================
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});
const db = admin.firestore();

// ================= RAZORPAY =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================= GITHUB CONFIG =================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "harsh126thakur";
const GITHUB_REPO = process.env.GITHUB_REPO || "designtechvlsi";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_MEDIA_BASE_PATH =
  process.env.GITHUB_MEDIA_BASE_PATH || "question-library";

// ================= HELPERS =================
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
  } catch {}

  const body = {
    message,
    content: contentBase64,
    branch: GITHUB_BRANCH
  };

  if (sha) body.sha = sha;

  return githubRequest(url, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

// ================= DB HELPERS =================
async function getCourseFromDB(courseId) {
  const docSnap = await db.collection("courses").doc(courseId).get();
  return docSnap.exists ? docSnap.data() : null;
}

async function getCouponFromDB(code) {
  const docSnap = await db.collection("coupons").doc(code).get();
  return docSnap.exists ? docSnap.data() : null;
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("Secure Razorpay + GitHub Backend Running 🚀");
});

app.get("/ping", (req, res) => {
  res.json({ ok: true });
});

// ================= 🔐 SECURE CREATE ORDER =================
app.post("/create-order", async (req, res) => {
  try {
    const { courseId, couponCode } = req.body;

    if (!courseId) {
      return res.status(400).json({ error: "Course ID is required" });
    }

    const course = await getCourseFromDB(courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    let price = Number(course.price);

    if (!price || price <= 0) {
      return res.status(400).json({ error: "Invalid course price" });
    }

    // Apply coupon
    if (couponCode) {
      const coupon = await getCouponFromDB(couponCode);

      if (coupon && coupon.isActive) {
        const discount = Number(coupon.discount || 0);
        price = price - (price * discount / 100);
      }
    }

    if (price < 10) price = 10;

    const finalAmount = Math.round(price * 100);

    const order = await razorpay.orders.create({
      amount: finalAmount,
      currency: "INR",
      receipt: "receipt_" + Date.now()
    });

    res.json({
      id: order.id,
      amount: order.amount
    });

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

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      return res.json({ success: true });
    }

    return res.status(400).json({ success: false });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ================= GITHUB FOLDER =================
app.post("/api/github/create-folder", async (req, res) => {
  try {
    const { folderName } = req.body;
    const safeFolderName = sanitizeFolderName(folderName);

    const path = `${GITHUB_MEDIA_BASE_PATH}/${safeFolderName}/.gitkeep`;

    await createOrUpdateGithubFile(
      path,
      Buffer.from("").toString("base64"),
      "Create folder"
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ================= GITHUB IMAGE =================
app.post("/api/github/upload-image", async (req, res) => {
  try {
    const { folderName, fileName, fileBase64 } = req.body;

    const safeFolder = sanitizeFolderName(folderName);
    const safeFile = sanitizeFileName(fileName);

    const cleanBase64 = fileBase64.includes(",")
      ? fileBase64.split(",")[1]
      : fileBase64;

    const path = `${GITHUB_MEDIA_BASE_PATH}/${safeFolder}/${safeFile}`;

    await createOrUpdateGithubFile(path, cleanBase64, "Upload image");

    res.json({
      success: true,
      url: getRawFileUrl(path)
    });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});