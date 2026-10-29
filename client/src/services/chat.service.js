
// Client / src / services / chat.service.js
import { api } from "./api.js";
export const sendMessage = async (message) => {
    const res = await api.post("/chat/message", { message });
    return res.data;
}