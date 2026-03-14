// lib/gemini.js — AI engine dùng chung cho tất cả bot
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Lưu lịch sử hội thoại theo từng user (in-memory)
// Key: "botId_userId" → Value: { chat, lastActive }
const sessions = new Map();

// Tự dọn session sau 30 phút không hoạt động
const SESSION_TTL = 30 * 60 * 1000;

export async function getAIReply(userMessage, systemPrompt, userId = "default") {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: 500,  // Giới hạn độ dài trả lời
        temperature: 0.7,      // 0 = nghiêm túc, 1 = sáng tạo
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    });

    // Lấy hoặc tạo session hội thoại cho user này
    if (!sessions.has(userId)) {
      sessions.set(userId, {
        chat: model.startChat({ history: [] }),
        lastActive: Date.now(),
      });
    }

    const session = sessions.get(userId);
    session.lastActive = Date.now();

    // Gọi AI
    const result = await session.chat.sendMessage(userMessage);
    const reply = result.response.text();

    // Dọn session cũ (chạy ngầm, không block response)
    cleanOldSessions();

    return reply;

  } catch (error) {
    console.error("Gemini error:", error?.message || error);

    // Phân loại lỗi để trả về thông báo phù hợp
    if (error?.message?.includes("quota")) {
      return "Xin lỗi bạn, hệ thống đang quá tải. Vui lòng thử lại sau ít phút hoặc liên hệ hotline để được hỗ trợ nhé! 🙏";
    }
    if (error?.message?.includes("SAFETY")) {
      return "Xin lỗi, tôi không thể trả lời câu hỏi này. Bạn có câu hỏi nào khác không ạ?";
    }
    return "Xin lỗi bạn, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau hoặc liên hệ trực tiếp với chúng tôi nhé! 🙏";
  }
}

// Xóa session quá hạn để tránh tốn RAM
function cleanOldSessions() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastActive > SESSION_TTL) {
      sessions.delete(key);
    }
  }
}

// Reset hội thoại của 1 user (dùng khi cần bắt đầu lại)
export function resetSession(userId) {
  sessions.delete(userId);
}