// api/webhook.js
import { getAIReply } from '../lib/gemini.js';

const SHOPS = {
  shop1: {
    pageToken:   process.env.PAGE_TOKEN_SHOP1,
    verifyToken: process.env.VERIFY_TOKEN_SHOP1,
    name:        'Shop cung cấp chatbot',
    prompt: `Bạn là Minh junior, tư vấn viên của Shop cung cấp chatbot.
bạn là 1 chuyên gia công nghệ, bạn muốn bán chatbot cho các shop thời trang,
bạn sẽ tư vấn cho khách hàng về sản phẩm phù hợp với nhu cầu của họ.
Những con chatbot này sẽ giúp họ :trả lời tin nhắn tự động, tư vấn sản phẩm, 
hỗ trợ chốt đơn, thu thập thông tin khách hàng.
Nhiệm vụ: tư vấn sản phẩm phù hợp, hỗ trợ chốt đơn.
Hỏi khách: dáng người, dịp mặc, màu yêu thích, ngân sách.
Hotline: 0901 111 222. Giờ làm: 8h–22h hàng ngày.
Trả lời ngắn gọn, thân thiện, tiếng Việt tự nhiên.`
  },
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
};

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;

function isRateLimited(senderId) {
  const now  = Date.now();
  const logs = (rateLimitMap.get(senderId) || []).filter(t => now - t < RATE_WINDOW);
  if (logs.length >= RATE_LIMIT) return true;
  rateLimitMap.set(senderId, [...logs, now]);
  return false;
}

// Chặn tin nhắn trùng
const processedMids = new Set();

function isDuplicate(mid) {
  if (!mid) return false;
  if (processedMids.has(mid)) return true;
  processedMids.add(mid);
  setTimeout(() => processedMids.delete(mid), 5 * 60 * 1000);
  return false;
}

export default async function handler(req, res) {
  const shopId = req.query.shop;
  const shop   = SHOPS[shopId];

  if (!shop) {
    return res.status(404).json({ error: `Shop "${shopId}" không tồn tại` });
  }

  // GET: Facebook xác minh webhook
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === shop.verifyToken) {
      console.log(`✅ Webhook verified: ${shopId}`);
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // POST: Nhận và xử lý tin nhắn — XỬ LÝ XONG MỚI TRẢ 200
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object !== 'page') {
      return res.status(200).send('OK');
    }

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // Tin nhắn text
        if (event.message?.text) {
          const mid     = event.message.mid;
          const userMsg = event.message.text;

          if (isDuplicate(mid)) {
            console.log(`⚠️ Duplicate: ${mid}`);
            continue;
          }

          if (isRateLimited(senderId)) {
            console.log(`🚫 Rate limited: ${senderId}`);
            await sendToFacebook(senderId, 'Bạn nhắn quá nhanh! Chờ 1 phút rồi thử lại nhé 😅', shop.pageToken);
            continue;
          }

          console.log(`📩 [${shop.name}] ${senderId}: ${userMsg.slice(0, 50)}`);
          await sendTypingOn(senderId, shop.pageToken);

          try {
            const reply = await getAIReply(userMsg, shop.prompt, `${shopId}_${senderId}`);
            await sendToFacebook(senderId, reply, shop.pageToken);
            console.log(`✅ [${shop.name}] Replied to ${senderId}`);
          } catch (err) {
            console.error(`❌ [${shop.name}] Error:`, err.message);
            await sendToFacebook(senderId, 'Xin lỗi bạn, tôi đang bận. Vui lòng thử lại sau hoặc liên hệ hotline nhé! 🙏', shop.pageToken);
          }
        }

        // Postback
        if (event.postback?.payload) {
          await sendToFacebook(senderId, 'Xin chào! Tôi có thể giúp gì cho bạn? 😊', shop.pageToken);
        }
      }
    }

    // Trả 200 SAU KHI xử lý xong
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).send('Method Not Allowed');
}

async function sendToFacebook(recipientId, text, pageToken) {
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