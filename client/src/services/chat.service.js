
// Client / src / services / chat.service.js
import { api } from "./api.js";
export const sendMessage = async (message) => {
    const res = await api.post("/chat/message", { message });
    if (!res?.success || typeof res.data?.message !== "string") {
        throw new Error(res?.message || "Unexpected response from chat service.");
    }
    return res.data;
}