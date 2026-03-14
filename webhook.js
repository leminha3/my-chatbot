// api/webhook.js
// ════════════════════════════════════════════════════════
// BOTCORE — 1 FILE NÀY CHẠY CHO TẤT CẢ SHOP
// Thêm shop mới: chỉ cần thêm vào SHOPS bên dưới + thêm token vào .env
// ════════════════════════════════════════════════════════

import { getAIReply } from '../lib/gemini.js';

// ══════════════════════════════════════════════════════════
//  DANH SÁCH SHOP — CHỈ CẦN CHỈNH SỬA PHẦN NÀY
//  Thêm shop mới = thêm 1 block { ... } vào đây
// ══════════════════════════════════════════════════════════
const SHOPS = {

  // ── SHOP 1 ──────────────────────────────────────────────
  shop1: {
    pageToken:   process.env.PAGE_TOKEN_SHOP1,
    verifyToken: process.env.VERIFY_TOKEN_SHOP1,
    prompt: `Bạn là Linh, tư vấn viên của Shop Thời Trang NaNa.
Chuyên quần áo nữ công sở và dự tiệc, size S-XL.
Giá từ 150k–800k. Freeship đơn trên 500k. Ship 2-3 ngày.
Nhiệm vụ: tư vấn sản phẩm phù hợp, hỗ trợ chốt đơn.
Hỏi khách: dáng người, dịp mặc, màu yêu thích, ngân sách.
Hotline: 0901 111 222. Giờ làm: 8h–22h hàng ngày.
Trả lời ngắn gọn, thân thiện, tiếng Việt tự nhiên.`
  },

  // ── SHOP 2 ──────────────────────────────────────────────
  shop2: {
    pageToken:   process.env.PAGE_TOKEN_SHOP2,
    verifyToken: process.env.VERIFY_TOKEN_SHOP2,
    prompt: `Bạn là Minh, tư vấn BĐS của Sunshine Realty.
Dự án: Vinhomes Grand Park, Masteri Centre Point, The Beverly.
Khu vực: TP.HCM và Bình Dương. Giá từ 1.8 tỷ.
Hỗ trợ vay 70% giá trị căn hộ, lãi suất ưu đãi 2 năm đầu.
Nhiệm vụ: hỏi nhu cầu, tư vấn dự án phù hợp,
thu thập tên + SĐT + nhu cầu, đặt lịch xem nhà.
KHÔNG báo giá chính xác — luôn mời khách liên hệ trực tiếp.
Hotline: 0909 123 456. Giờ làm: 8h–21h.`
  },

  // ── THÊM SHOP MỚI Ở ĐÂY ─────────────────────────────────
  // shop3: {
  //   pageToken:   process.env.PAGE_TOKEN_SHOP3,
  //   verifyToken: process.env.VERIFY_TOKEN_SHOP3,
  //   prompt: `Bạn là [tên AI], tư vấn của [tên shop].
  //   [Mô tả sản phẩm / dịch vụ, quy tắc, hotline...]`
  // },
};

// ══════════════════════════════════════════════════════════
// HANDLER CHÍNH
// Webhook URL của mỗi shop:
//   shop1 → https://your-app.vercel.app/api/webhook?shop=shop1
//   shop2 → https://your-app.vercel.app/api/webhook?shop=shop2
// ══════════════════════════════════════════════════════════
export default async function handler(req, res) {

  const shopId = req.query.shop;
  const shop   = SHOPS[shopId];

  if (!shop) {
    return res.status(404).json({ error: `Shop "${shopId}" không tồn tại` });
  }

  // ── GET: Facebook xác minh webhook ──
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === shop.verifyToken) {
      console.log(`✅ Webhook verified: ${shopId}`);
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // ── POST: Nhận tin nhắn ──
  if (req.method === "POST") {
    const body = req.body;
    if (body.object !== "page") return res.sendStatus(200);

    for (const entry of body.entry) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        if (event.message?.text) {
          const userMsg = event.message.text;
          try {
            const reply = await getAIReply(userMsg, shop.prompt, `${shopId}_${senderId}`);
            await sendToFacebook(senderId, reply, shop.pageToken);
          } catch (err) {
            console.error(`❌ [${shopId}]:`, err.message);
            await sendToFacebook(
              senderId,
              "Xin lỗi bạn, tôi đang bận. Vui lòng thử lại sau hoặc liên hệ hotline nhé! 🙏",
              shop.pageToken
            );
          }
        }

        if (event.postback?.payload) {
          await sendToFacebook(senderId, "Xin chào! Tôi có thể giúp gì cho bạn? 😊", shop.pageToken);
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(405);
}

// ══════════════════════════════════════════════════════════
// GỬI TIN NHẮN VỀ FACEBOOK
// ══════════════════════════════════════════════════════════
async function sendToFacebook(recipientId, text, pageToken) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${pageToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient:      { id: recipientId },
        message:        { text },
        messaging_type: "RESPONSE"
      })
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Facebook API error");
  }
}