// client/edureach-platform/src/services/api.js
// const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api"; 
const BASE_URL = `${import.meta.env.vite_API_BASE_URL || "http://localhost:5000"}/api`;


async function request(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const config = {
        headers: { "Content-Type": "application/json" },
        ...options,
    };
    const response = await fetch(url, config);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || data.error || "Request failed");
    }
    return data;
}
export const api = {
  post: (endpoint, body) =>
    request(endpoint, { method: "POST", body: JSON.stringify(body) }),
};