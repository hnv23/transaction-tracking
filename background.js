// background.js (service worker)
const BANKS = [
  {
    id: "acb",
    name: "ACB",
    domain: "online.acb.com.vn",
    cookieNameHints: ["session", "auth", "JSESSIONID", "ASP.NET_SessionId"],
  },
  {
    id: "vpbank",
    name: "VPBank",
    domain: "neo.vpbank.com.vn",
    cookieNameHints: ["session", "auth", "JSESSIONID"],
  },
  {
    id: "tpbank",
    name: "TPBank",
    domain: "ebank.tpb.vn",
    cookieNameHints: ["session", "auth", "PHPSESSID"],
  },
  {
    id: "techcom",
    name: "Techcombank",
    domain: "onlinebanking.techcombank.com.vn",
    cookieNameHints: ["session", "auth", "JSESSIONID", "AUTH_SESSION_ID"],
  },
];

// helper: check cookies of a given domain
async function checkLoginByCookies(domain, hints = []) {
  // tìm tất cả cookies cho domain
  const url = `https://${domain}/`;
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: domain.replace(/^\.*/, "") }, (cookies) => {
      if (!cookies || cookies.length === 0) {
        resolve({ loggedIn: false, reason: "no_cookies" });
        return;
      }
      // filter cookies: chưa hết hạn (expirationDate undefined => session cookie)
      const now = Date.now() / 1000;
      const valid = cookies.filter((c) => {
        if (c.expirationDate && c.expirationDate < now) return false;
        return true;
      });
      if (valid.length === 0) {
        resolve({ loggedIn: false, reason: "cookies_expired" });
        return;
      }
      // nếu có cookie trùng hint name -> nhiều khả năng đang login
      const matchHint = valid.find((c) =>
        hints.some((h) => c.name.toLowerCase().includes(h.toLowerCase()))
      );
      if (matchHint) {
        resolve({ loggedIn: true, reason: `cookie_match:${matchHint.name}` });
        return;
      }
      // ngược lại: có cookie hợp lệ nhưng không trùng hint -> khả năng thấp hơn, vẫn báo true/unknown tùy policy
      resolve({
        loggedIn: true,
        reason: "cookies_present_unknown_names",
        cookiesFound: valid.map((c) => c.name),
      });
    });
  });
}

// xử lý message từ popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_ALL_BANKS") {
    (async () => {
      const results = {};
      for (const b of BANKS) {
        try {
          const r = await checkLoginByCookies(b.domain, b.cookieNameHints);
          results[b.id] = { name: b.name, domain: b.domain, ...r };
        } catch (e) {
          results[b.id] = {
            name: b.name,
            domain: b.domain,
            loggedIn: false,
            reason: "error",
            error: e.message,
          };
        }
      }
      sendResponse({ ok: true, results });
    })();
    return true; // will respond async
  }

  // Xử lý yêu cầu lấy thông tin trình duyệt
  if (msg.type === "GET_BROWSER_INFO") {
    // Lấy thông tin trình duyệt hiện tại
    const browserInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
    };

    sendResponse(browserInfo);
    return false; // respond synchronously
  }
});
