// api/webhook.js
// ════════════════════════════════════════════════════════
// BOTCORE FACEBOOK — Messenger DM + Reply Comment
// ════════════════════════════════════════════════════════

import { getAIReply } from '../lib/gemini.js';

// ══════════════════════════════════════════════════════════
// DANH SÁCH SHOP
// ══════════════════════════════════════════════════════════
const SHOPS = {
  shop1: {
    pageToken:   process.env.PAGE_TOKEN_SHOP1,
    verifyToken: process.env.VERIFY_TOKEN_SHOP1,
    name:        'Shop cung cấp chatbot',

    // Prompt cho Messenger DM
      prompt: `Bạn là Sand, tư vấn viên của SandBot — dịch vụ chatbot AI cho shop Việt.
Dịch vụ: tự động trả lời Messenger và comment Facebook 24/7 bằng AI.
Setup trong 24 giờ, không cần khách biết kỹ thuật.
Giá: 299k/tháng - gói cơ bản. Hiện tại shop mới nên chỉ có 1 gói này nhưng sau này sẽ có thêm nhiều gói khác với nhiều tính năng nâng cao hơn. Trải nghiệm thử 2 tuần MIỄN PHÍ.

NHIỆM VỤ:
1. Hỏi khách đang kinh doanh lĩnh vực gì và đang gặp vấn đề gì với tin nhắn
2. Giới thiệu giải pháp phù hợp với lĩnh vực đó (shop thời trang, BĐS, F&B...)
3. Mời dùng thử 2 tuần free — không cần thẻ, không ràng buộc
4. Thu thập SĐT/Zalo để đội ngũ liên hệ setup

KHÔNG báo chi tiết kỹ thuật — chỉ nói "setup đơn giản, đội ngũ làm hết cho bạn".
PHONG CÁCH: Thân thiện, tự tin, thật ngắn gọn, hỏi 1 câu mỗi lượt, 1-2 emoji thôi.`,

    // Prompt riêng cho reply comment — ngắn gọn như người thật comment
    commentPrompt: `Bạn là nhân viên của Shop cung cấp chatbot, đang reply comment trên Facebook.
Quy tắc BẮT BUỘC:
- Chỉ được viết 1-2 câu ngắn, tự nhiên như người thật comment
- KHÔNG dùng bullet points, KHÔNG liệt kê dài dòng
- Có thể tiết lộ giá cụ thể trong comment — ưu tiên mời nhắn tin để biết giá
- Nếu hỏi giá/mẫu/model/hoặc thông tin khác → trả lời chung + mời nhắn tin: "Bạn nhắn tin cho shop để được tư vấn chi tiết nhé! 💌"
- Nếu khen/tích cực → cảm ơn thân thiện
- Nếu chê/tiêu cực → xin lỗi lịch sự + mời nhắn tin giải quyết
- Dùng tối đa 1 emoji
- Viết như bạn bè comment, KHÔNG như robot`,
  },

  // shop2: { ... }
};

// ══════════════════════════════════════════════════════════
// RATE LIMITING
// ══════════════════════════════════════════════════════════
const rateLimitMap = new Map();
const RATE_LIMIT   = 10;
const RATE_WINDOW  = 60 * 1000;

function isRateLimited(id) {
  const now  = Date.now();
  const logs = (rateLimitMap.get(id) || []).filter(t => now - t < RATE_WINDOW);
  if (logs.length >= RATE_LIMIT) return true;
  rateLimitMap.set(id, [...logs, now]);
  return false;
}

// ══════════════════════════════════════════════════════════
// CHẶN TRÙNG LẶP
// ══════════════════════════════════════════════════════════
const processedIds = new Set();

function isDuplicate(id) {
  if (!id) return false;
  if (processedIds.has(id)) return true;
  processedIds.add(id);
  setTimeout(() => processedIds.delete(id), 5 * 60 * 1000);
  return false;
}

// ══════════════════════════════════════════════════════════
// HANDLER CHÍNH
// Webhook URL: .../api/webhook?shop=shop1
// ══════════════════════════════════════════════════════════
export default async function handler(req, res) {
  const shopId = req.query.shop;
  const shop   = SHOPS[shopId];

  if (!shop) {
    return res.status(404).json({ error: `Shop "${shopId}" không tồn tại` });
  }

  // ── GET: Facebook xác minh webhook ──
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

  // ── POST: Nhận sự kiện từ Facebook ──
  if (req.method === 'POST') {
    const body = req.body;
    console.log('📦 Raw body:', JSON.stringify(body).slice(0, 200));
    if (body.object !== 'page') {
      return res.status(200).send('OK');
    }

    for (const entry of body.entry || []) {

      // ── 1. MESSENGER DM ────────────────────────────────
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        if (event.message?.text) {
          const mid     = event.message.mid;
          const userMsg = event.message.text;

          if (isDuplicate(mid)) continue;
          if (isRateLimited(senderId)) {
            await sendFBMessage(senderId, 'Bạn nhắn quá nhanh! Chờ 1 phút nhé 😅', shop.pageToken);
            continue;
          }

          console.log(`📩 DM [${shop.name}] ${senderId}: ${userMsg.slice(0, 50)}`);
          await sendTypingOn(senderId, shop.pageToken);

          try {
            const reply = await getAIReply(userMsg, shop.prompt, `${shopId}_dm_${senderId}`);
            await sendFBMessage(senderId, reply, shop.pageToken);
            console.log(`✅ DM replied: ${senderId}`);
          } catch (err) {
            console.error(`❌ DM error:`, err.message);
            await sendFBMessage(senderId, 'Xin lỗi bạn, vui lòng thử lại sau hoặc liên hệ hotline nhé! 🙏', shop.pageToken);
          }
        }

        // Nút Get Started
        if (event.postback?.payload) {
          await sendFBMessage(senderId, 'Xin chào! Mình có thể giúp gì cho bạn? 😊', shop.pageToken);
        }
      }

      // ── 2. COMMENT DƯỚI BÀI ĐĂNG ──────────────────────
      for (const change of entry.changes || []) {
        if (change.field !== 'feed') continue;

        const val  = change.value;
        const item = val.item;
        const verb = val.verb;

        // Chỉ xử lý comment mới, bỏ qua edit/delete/like/reaction
        if (item !== 'comment' || verb !== 'add') continue;

        const commentId   = val.comment_id;
        const commentText = val.message || '';
        const commenterId = val.from?.id;
        const pageId      = val.page_id;

        // Bỏ qua nếu thiếu thông tin
        if (!commentText.trim() || !commenterId || !commentId) continue;

        // Bỏ qua comment của chính page — tránh bot reply chính mình
        if (commenterId === pageId) continue;

        // Bỏ qua trùng lặp
        if (isDuplicate(commentId)) continue;

        // Bỏ qua rate limit
        if (isRateLimited(`comment_${commenterId}`)) continue;

        console.log(`💬 Comment [${shop.name}] ${commenterId}: ${commentText.slice(0, 50)}`);

        try {
          const reply = await getAIReply(
            commentText,
            shop.commentPrompt,
            `${shopId}_cmt_${commenterId}` // session riêng cho comment
          );
          await replyComment(commentId, reply, shop.pageToken);
          console.log(`✅ Comment replied: ${commentId}`);
        } catch (err) {
          console.error(`❌ Comment error:`, err.message);
        }
      }
    }

    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).send('Method Not Allowed');
}

// ══════════════════════════════════════════════════════════
// GỬI TIN NHẮN MESSENGER
// ══════════════════════════════════════════════════════════
async function sendFBMessage(recipientId, text, pageToken) {
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
// REPLY COMMENT
// ══════════════════════════════════════════════════════════
async function replyComment(commentId, text, pageToken) {
  // Comment tối đa 500 ký tự cho tự nhiên
  const safeText = text.length > 500 ? text.slice(0, 497) + '...' : text;
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${commentId}/comments?access_token=${pageToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: safeText })
    }
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Comment reply error');
  }
}

// ══════════════════════════════════════════════════════════
// TYPING INDICATOR
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
