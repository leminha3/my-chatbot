// api/webhook.js
// ════════════════════════════════════════════════════════
// BOTCORE — 1 FILE NÀY CHẠY CHO TẤT CẢ SHOP
// Thêm shop mới: chỉ cần thêm vào SHOPS bên dưới + thêm token vào .env
// ════════════════════════════════════════════════════════

import { getAIReply } from '../lib/gemini.js';

// ══════════════════════════════════════════════════════════
//  DANH SÁCH SHOP — CHỈ CẦN CHỈNH SỬA PHẦN NÀY
// ══════════════════════════════════════════════════════════
const SHOPS = {

  // ── SHOP 1 ──────────────────────────────────────────────
  shop1: {
    pageToken:   process.env.PAGE_TOKEN_SHOP1,
    verifyToken: process.env.VERIFY_TOKEN_SHOP1,
    name:        'Shop Thời Trang NaNa',
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
    name:        'Sunshine Realty',
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
  //   name:        'Tên Shop 3',
  //   prompt: `Bạn là [tên AI], tư vấn của [tên shop].
  //   [Mô tả sản phẩm / dịch vụ, quy tắc, hotline...]`
  // },
};

// ══════════════════════════════════════════════════════════
// RATE LIMITING — chặn spam (tối đa 10 tin/phút mỗi user)
// ══════════════════════════════════════════════════════════
const rateLimitMap = new Map();
const RATE_LIMIT   = 10;
const RATE_WINDOW  = 60 * 1000;

function isRateLimited(senderId) {
  const now  = Date.now();
  const logs = (rateLimitMap.get(senderId) || []).filter(t => now - t < RATE_WINDOW);
  if (logs.length >= RATE_LIMIT) return true;
  rateLimitMap.set(senderId, [...logs, now]);
  return false;
}

// ══════════════════════════════════════════════════════════
// CHẶN TIN NHẮN TRÙNG (Facebook đôi khi gửi webhook 2 lần)
// ══════════════════════════════════════════════════════════
const processedMids = new Set();

function isDuplicate(mid) {
  if (!mid) return false;
  if (processedMids.has(mid)) return true;
  processedMids.add(mid);
  setTimeout(() => processedMids.delete(mid), 5 * 60 * 1000);
  return false;
}

// ══════════════════════════════════════════════════════════
// HANDLER CHÍNH
// Webhook URL mỗi shop:
//   https://your-app.vercel.app/api/webhook?shop=shop1
//   https://your-app.vercel.app/api/webhook?shop=shop2
// ══════════════════════════════════════════════════════════
export default async function handler(req, res) {

  const shopId = req.query.shop;
  const shop   = SHOPS[shopId];

  if (!shop) {
    return res.status(404).json({ error: `Shop "${shopId}" không tồn tại` });
  }

  // ── GET: Facebook xác minh webhook ──────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === shop.verifyToken) {
      console.log(`✅ Webhook verified: ${shopId}`);
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // ── POST: Nhận tin nhắn ─────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(200);

    // Trả 200 ngay cho Facebook — tránh timeout & retry
    res.status(200).send('EVENT_RECEIVED');

    // Xử lý bất đồng bộ sau khi đã trả 200
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // ── Tin nhắn text ──
        if (event.message?.text) {
          const mid     = event.message.mid;
          const userMsg = event.message.text;

          if (isDuplicate(mid)) {
            console.log(`⚠️ Duplicate skipped: ${mid}`);
            continue;
          }

          if (isRateLimited(senderId)) {
            console.log(`🚫 Rate limited: ${senderId}`);
            await sendToFacebook(
              senderId,
              'Bạn nhắn quá nhanh rồi! Vui lòng chờ 1 phút rồi thử lại nhé 😅',
              shop.pageToken
            );
            continue;
          }

          console.log(`📩 [${shop.name}] ${senderId}: ${userMsg.slice(0, 50)}`);

          // Hiện "đang nhập..." trong khi AI xử lý
          await sendTypingOn(senderId, shop.pageToken);

          try {
            const reply = await getAIReply(
              userMsg,
              shop.prompt,
              `${shopId}_${senderId}`
            );
            await sendToFacebook(senderId, reply, shop.pageToken);
            console.log(`✅ [${shop.name}] Replied to ${senderId}`);
          } catch (err) {
            console.error(`❌ [${shop.name}] AI error:`, err.message);
            await sendToFacebook(
              senderId,
              'Xin lỗi bạn, tôi đang bận. Vui lòng thử lại sau hoặc liên hệ hotline nhé! 🙏',
              shop.pageToken
            );
          }
        }

        // ── Postback (click nút Get Started) ──
        if (event.postback?.payload) {
          console.log(`📲 [${shop.name}] Postback: ${event.postback.payload}`);
          await sendToFacebook(
            senderId,
            'Xin chào! Tôi có thể giúp gì cho bạn? 😊',
            shop.pageToken
          );
        }
      }
    }

    return;
  }

  return res.sendStatus(405);
}

// ══════════════════════════════════════════════════════════
// GỬI TIN NHẮN VỀ FACEBOOK
// ══════════════════════════════════════════════════════════
async function sendToFacebook(recipientId, text, pageToken) {
  // Facebook giới hạn tối đa 2000 ký tự/tin nhắn
  const safeText = text.length > 2000 ? text.slice(0, 1997) + '...' : text;

  const response = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${pageToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient:      { id: recipientId },
        message:        { text: safeText },
        messaging_type: 'RESPONSE'
      })
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Facebook API error');
  }
}

// ══════════════════════════════════════════════════════════
// HIỆN "ĐANG NHẬP..." KHI BOT ĐANG XỬ LÝ
// ══════════════════════════════════════════════════════════
async function sendTypingOn(recipientId, pageToken) {
  await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${pageToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient:     { id: recipientId },
        sender_action: 'typing_on'
      })
    }
  ).catch(() => {});
}