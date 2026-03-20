import express from "express";
import Razorpay from "razorpay";
import cors from "cors";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();

// ================= MIDDLEWARE =================
app.use(express.json({ limit: "10mb" }));
app.use(cors());

// ================= RAZORPAY SETUP =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================= GMAIL SETUP =================
const mailTransporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ================= TEST ROUTE =================
app.get("/", (req, res) => {
  res.send("Razorpay Backend Running 🚀");
});

// ================= DEBUG ROUTE =================
app.get("/debug-gmail", (req, res) => {
  const user = process.env.GMAIL_USER || "";
  const pass = process.env.GMAIL_APP_PASSWORD || "";

  res.json({
    hasUser: !!user,
    hasPass: !!pass,
    user,
    passLength: pass.length
  });
});

// ================= EMAIL TEST ROUTE =================
app.get("/test-email", async (req, res) => {
  try {
    await mailTransporter.verify();

    const info = await mailTransporter.sendMail({
      from: `"DesignTech VLSI" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: "Test Email from DesignTech VLSI",
      html: `
        <h2>Test Email Working ✅</h2>
        <p>This email confirms Gmail SMTP is configured correctly on Render.</p>
      `
    });

    res.json({
      success: true,
      message: "Test email sent successfully",
      messageId: info.messageId,
      response: info.response
    });
  } catch (err) {
    console.error("TEST EMAIL ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
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
      return res.status(400).json({ success: false, message: "Missing fields" });
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

// ================= SEND INVOICE EMAIL =================
app.post("/send-invoice", async (req, res) => {
  try {
    const {
      customerEmail,
      customerName,
      invoiceNumber,
      amount,
      courseName,
      paymentId
    } = req.body;

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: "Customer email is required"
      });
    }

    await mailTransporter.verify();

    const info = await mailTransporter.sendMail({
      from: `"DesignTech VLSI" <${process.env.GMAIL_USER}>`,
      to: customerEmail,
      subject: `Invoice ${invoiceNumber || ""} - DesignTech VLSI`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
          <h2>DesignTech VLSI Invoice</h2>
          <p>Dear ${customerName || "Student"},</p>
          <p>Thank you for your payment. Your invoice details are below:</p>

          <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;"><strong>Invoice Number</strong></td>
              <td style="border: 1px solid #ddd; padding: 8px;">${invoiceNumber || "-"}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;"><strong>Course</strong></td>
              <td style="border: 1px solid #ddd; padding: 8px;">${courseName || "-"}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;"><strong>Amount</strong></td>
              <td style="border: 1px solid #ddd; padding: 8px;">₹${amount || "-"}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;"><strong>Payment ID</strong></td>
              <td style="border: 1px solid #ddd; padding: 8px;">${paymentId || "-"}</td>
            </tr>
          </table>

          <p style="margin-top: 20px;">
            Regards,<br>
            <strong>DesignTech VLSI</strong><br>
            Email: ${process.env.GMAIL_USER}
          </p>
        </div>
      `
    });

    res.json({
      success: true,
      message: "Invoice email sent successfully",
      messageId: info.messageId,
      response: info.response
    });
  } catch (err) {
    console.error("SEND INVOICE ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send invoice email",
      error: err.message
    });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});