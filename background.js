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

// Webhook URL n8n để gửi dữ liệu giao dịch ACB
async function postToN8N(
  payload,
  url = "https://n8n.hocduthu.com/webhook/acb"
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000); // timeout 30s

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok)
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);

    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: true, data: text };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function postToN8NCheckBillFacebook(
  payload,
  url = "https://n8n.hocduthu.com/webhook/update-transaction"
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000); // timeout 30s

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok)
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);

    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: true, data: text };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

function toIsoDate(input) {
  if (typeof input !== 'string') return null;

  const s = input.trim();
  const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (!m) return null;

  let [_, ddStr, mmStr, yyyyStr] = m;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);

  // Kiểm tra tháng
  if (mm < 1 || mm > 12) return null;

  // Số ngày tối đa theo tháng (có tính năm nhuận)
  const daysInMonth = (y, mth) => {
    if (mth === 2) {
      const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(mth) ? 30 : 31;
  };

  if (dd < 1 || dd > daysInMonth(yyyy, mm)) return null;

  const pad2 = n => String(n).padStart(2, '0');
  return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
}

function vndToInt(str) {
  if (typeof str !== "string") return null;

  // Chuẩn hóa & bỏ ký hiệu tiền tệ
  let s = str.replace(/\u00A0/g, " ") // bỏ NBSP
             .replace(/[₫đ]/gi, "")  // bỏ ký hiệu VND
             .trim();

  // Cắt bỏ phần thập phân nếu có dùng dấu phẩy
  // Ví dụ "1.234.232,50" -> lấy "1.234.232"
  s = s.split(",")[0];

  // Giữ lại chữ số và dấu '-' (nếu có)
  const digits = s.replace(/[^\d-]/g, "");

  if (!digits || /^-?$/.test(digits)) return null; // không có số hợp lệ

  // Chuyển sang Number (lưu ý: rất số lớn có thể vượt quá Number.MAX_SAFE_INTEGER)
  return digits;
}

// Lớp xử lý đăng nhập tự động VPBank
class VPBankAuto {
  constructor() {
    this.baseURL = "https://neo.vpbank.com.vn";
    this.authAPI = "/cb/odata/ns/authenticationservice";
    this.cookies = {};
    this.deviceId = null;
    this.xCsrfToken = null;
    this.tokenKey = null;
    this.AccountID = null;
  }

  // Tạo body multipart/mixed cho $batch
  buildBatchAccountsBody({ tokenKey = "", csrfToken = "", top, skip }) {
    // Tạo boundary ngẫu nhiên
    const boundaryAccounts =
      "batch_" + Math.random().toString(36).substring(2, 15);

    // HTTP request line - CHỈ relative path từ service root
    const httpRequestLine = `GET Accounts?$skip=${skip}&$top=${top}&$orderby=AccountGroup%20asc&$filter=ISSUMMARY%20eq%20%27true%27&$inlinecount=allpages HTTP/1.1`;

    console.log("HTTP Request Line:", httpRequestLine);

    // Inner headers - theo đúng format của ví dụ
    const innerHeaders = [
      "sap-cancel-on-close: true",
      "channelType: Web",
      tokenKey ? `TokenKey: ${tokenKey}` : "",
      "Pragma: no-cache",
      "Expires: -1",
      "Cache-Control: no-cache,no-store,must-revalidate",
      `X-Request-ID: ${Date.now()}${Math.floor(Math.random() * 1000)}`,
      "sap-contextid-accept: header",
      "Accept: application/json",
      csrfToken ? `x-csrf-token: ${csrfToken}` : "",
      "Accept-Language: vi",
      "DataServiceVersion: 2.0",
      "MaxDataServiceVersion: 2.0",
    ]
      .filter(Boolean)
      .join("\r\n");

    // Tạo body theo format chuẩn multipart/mixed
    const bodyAccounts =
      `--${boundaryAccounts}\r\n` +
      `Content-Type: application/http\r\n` +
      `Content-Transfer-Encoding: binary\r\n` +
      `\r\n` +
      `${httpRequestLine}\r\n` +
      `${innerHeaders}\r\n` +
      `\r\n` +
      `\r\n` +
      `--${boundaryAccounts}--\r\n`;

    return { boundaryAccounts, bodyAccounts };
  }

  buildBatchBody({
    fromISO,
    toISO,
    tokenKey = "",
    csrfToken = "",
    AccountID = "",
  }) {
    // Tạo boundary ngẫu nhiên
    const boundary = "batch_" + Math.random().toString(36).substring(2, 15);

    const httpRequestLine = `GET DepositAccounts('${AccountID}')?$expand=DepositAccountTransactions&fromDate=${fromISO}&toDate=${toISO} HTTP/1.1`;

    console.log("HTTP Request Line:", httpRequestLine);

    // Inner headers - theo đúng format của ví dụ
    const innerHeaders = [
      "sap-cancel-on-close: true",
      "channelType: Web",
      tokenKey ? `TokenKey: ${tokenKey}` : "",
      "Pragma: no-cache",
      "Expires: -1",
      "Cache-Control: no-cache,no-store,must-revalidate",
      `X-Request-ID: ${Date.now()}${Math.floor(Math.random() * 1000)}`,
      "sap-contextid-accept: header",
      "Accept: application/json",
      csrfToken ? `x-csrf-token: ${csrfToken}` : "",
      "Accept-Language: vi",
      "DataServiceVersion: 2.0",
      "MaxDataServiceVersion: 2.0",
    ]
      .filter(Boolean)
      .join("\r\n");

    // Tạo body theo format chuẩn multipart/mixed
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/http\r\n` +
      `Content-Transfer-Encoding: binary\r\n` +
      `\r\n` +
      `${httpRequestLine}\r\n` +
      `${innerHeaders}\r\n` +
      `\r\n` +
      `\r\n` +
      `--${boundary}--\r\n`;

    return { boundary, body };
  }

  // Lấy tất cả cookies từ trang
  async getAllCookies(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Getting cookies, attempt ${attempt}/${retries}...`);

        const cookies = await chrome.cookies.getAll({
          domain: "neo.vpbank.com.vn",
        });

        this.cookies = {};
        cookies.forEach((cookie) => {
          this.cookies[cookie.name] = cookie.value;
        });

        console.log(
          `Successfully retrieved ${cookies.length} cookies:`,
          Object.keys(this.cookies)
        );
        return this.cookies;
      } catch (error) {
        console.error(`Error getting cookies on attempt ${attempt}:`, error);
        if (attempt === retries) {
          console.error("All retry attempts failed for getting cookies");
          return {};
        }
        // Đợi 1 giây trước khi thử lại
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // Tạo cookie string từ object cookies
  createCookieString(cookies) {
    if (!cookies || typeof cookies !== "object") {
      return "";
    }

    return Object.entries(cookies)
      .filter(([name, value]) => name && value) // Lọc bỏ cookies rỗng
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  // Khởi tạo session và lấy cookies ban đầu
  async initializeSession() {
    try {
      console.log("Khởi tạo session...");

      // Tạo tab ẩn để lấy cookies ban đầu
      const tab = await chrome.tabs.create({
        url: this.baseURL,
        active: false,
      });

      // Đợi trang load xong
      await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });

      // Lấy cookies sau khi trang load
      await this.getAllCookies();

      // Lấy deviceId từ localStorage thông qua content script
      const deviceIdResult = await chrome.tabs.sendMessage(tab.id, {
        action: "getDeviceId",
      });

      // Đóng tab
      await chrome.tabs.remove(tab.id);

      if (!deviceIdResult || !deviceIdResult.deviceId) {
        throw new Error(
          "Không thể lấy deviceId từ localStorage. VPBank có thể chưa tạo deviceId."
        );
      }

      this.deviceId = deviceIdResult.deviceId;
      console.log("DeviceId lấy từ localStorage:", this.deviceId);
      console.log("Đã lấy cookies ban đầu:", this.cookies);

      return true;
    } catch (error) {
      console.error("Lỗi khởi tạo session:", error);
      return false;
    }
  }

  async callAPI(username, password, fromDate, toDate) {
    try {
      console.log("Bắt đầu quy trình đăng nhập và lấy lịch sử giao dịch...");

      // 1. Khởi tạo session
      const sessionInit = await this.initializeSession();
      if (!sessionInit) {
        throw new Error("Không thể khởi tạo session");
      }

      // =========================== 2. Thực hiện đăng nhập  ===========================
      const url = `${this.baseURL}${this.authAPI}/SecureUsers?action=init`;
      const payload = {
        Id: "",
        UserName: username,
        AppType: "Consumers",
        ChannelType: "Web",
        Password: password,
        UserLocale: { Country: "VN", Language: "vi" },
      };

      const tab = await chrome.tabs.create({
        url: this.baseURL,
        active: false,
      });

      await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });

      // Login request
      const loginMessage = {
        action: "callApiLogin",
        url: url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "device-id": this.deviceId,
          Referer: "https://neo.vpbank.com.vn/main.html",
          DataServiceVersion: "2.0",
          channelType: "Web",
        },
        data: payload,
      };

      const loginResult = await chrome.tabs.sendMessage(tab.id, loginMessage);

      if (
        loginResult &&
        loginResult.response &&
        loginResult.response.status === 201
      ) {
        console.log("Đăng nhập thành công");

        // Lấy TokenKey và CSRF token từ response headers của login
        const headers = loginResult.response.headers;
        this.tokenKey = headers["tokenkey"] || headers["TokenKey"] || "";
        this.xCsrfToken = headers["x-csrf-token"] || "";

        console.log("TokenKey từ login:", this.tokenKey);
        console.log("CSRF Token từ login:", this.xCsrfToken);

        // Cập nhật cookies sau khi đăng nhập
        await this.getAllCookies();

        // ============================= 2.5 Gọi API lấy danh sách tài khoản ================================
        const { boundaryAccounts, bodyAccounts } = this.buildBatchAccountsBody({
          skip: 0,
          top: 500,
          tokenKey: this.tokenKey,
          csrfToken: this.xCsrfToken,
        });

        const accountMessage = {
          action: "callApiAccount",
          url: "https://neo.vpbank.com.vn/cb/odata/services/accountservice/$batch",
          method: "POST",
          headers: {
            "Content-Type": `multipart/mixed;boundary=${boundaryAccounts}`,
            Accept: "multipart/mixed",
            Cookie: this.createCookieString(this.cookies),
            Referer: "https://neo.vpbank.com.vn/main.html",
            DataServiceVersion: "2.0",
            MaxDataServiceVersion: "2.0",
            TokenKey: this.tokenKey,
            "x-csrf-token": this.xCsrfToken,
            channelType: "Web",
            "sap-contextid-accept": "header",
            "sap-cancel-on-close": "true",
            "Accept-Language": "vi",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          data: bodyAccounts,
        };

        const accountResult = await chrome.tabs.sendMessage(
          tab.id,
          accountMessage
        );

        console.log("=== ACCOUNT RESPONSE ===");
        if (
          accountResult?.response?.status === 200 ||
          accountResult?.response?.status === 202
        ) {
          const responseText = accountResult.response.textContent || "";
          const jsonStart = responseText.indexOf('{"');
          // Tìm vị trí kết thúc của JSON (dấu } cuối cùng trước batch boundary)
          const jsonEnd = responseText.lastIndexOf("}}") + 2;

          if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error("Không tìm thấy JSON trong responseText");
          }

          // Trích xuất chuỗi JSON
          const jsonString = responseText.substring(jsonStart, jsonEnd);
          const accountData = JSON.parse(jsonString);

          if (accountData.error) {
            // nếu kết quả có lỗi từ server
            throw new Error(
              "Lấy danh sách tài khoản thất bại: " +
                accountData.error.message.value
            );
          } else {
            // Neu không lỗi, lấy AccountID từ tài khoản đầu tiên
            this.AccountID = accountData?.d?.results?.[0]?.Id || null;
          }
        } else {
          console.error("Account API call failed:", accountData);
        }

        // Cập nhật cookies sau khi gọi API tài khoản
        await this.getAllCookies();

        // ============================= 3. Tạo batch request cho giao dịch ================================
        const fromDateObj = new Date(fromDate + "T00:00:00");
        const toDateObj = new Date(toDate + "T23:59:59");

        // const fromISO = fromDateObj.toISOString().slice(0, 19);
        // const toISO = toDateObj.toISOString().slice(0, 19);

        // Format theo dd/MM/yyyy cho API mới (thay vì OData datetime format)
        const formatDateForAPI = (dateObj) => {
          const day = dateObj.getDate().toString().padStart(2, "0");
          const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
          const year = dateObj.getFullYear();
          return `${day}/${month}/${year}`;
        };

        const fromISO = encodeURIComponent(formatDateForAPI(fromDateObj));
        const toISO = encodeURIComponent(formatDateForAPI(toDateObj));

        const { boundary, body } = this.buildBatchBody({
          fromISO,
          toISO,
          tokenKey: this.tokenKey,
          csrfToken: this.xCsrfToken,
          AccountID: this.AccountID,
        });

        // Transaction request với headers chính xác
        const transactionUrl = `${this.baseURL}/cb/odata/services/accountservice/$batch`;
        const transactionMessage = {
          action: "callApiTransaction",
          url: transactionUrl,
          method: "POST",
          headers: {
            "Content-Type": `multipart/mixed;boundary=${boundary}`,
            Accept: "multipart/mixed",
            Cookie: this.createCookieString(this.cookies),
            Referer: "https://neo.vpbank.com.vn/main.html",
            DataServiceVersion: "2.0",
            MaxDataServiceVersion: "2.0",
            TokenKey: this.tokenKey,
            "x-csrf-token": this.xCsrfToken,
            channelType: "Web",
            "sap-contextid-accept": "header",
            "sap-cancel-on-close": "true",
            "Accept-Language": "vi",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          data: body,
        };

        console.log("=== TRANSACTION REQUEST ===");
        console.log("URL:", transactionUrl);

        const transactionResult = await chrome.tabs.sendMessage(
          tab.id,
          transactionMessage
        );

        await chrome.tabs.remove(tab.id);

        console.log("=== TRANSACTION RESPONSE ===");

        if (
          transactionResult?.response?.status === 200 ||
          transactionResult?.response?.status === 202
        ) {
          console.log("Lấy dữ liệu giao dịch thành công!");

          // Lấy response text từ property textContent
          const responseText = transactionResult.response.textContent || "";
          const jsonStart = responseText.indexOf('{"');
          // Tìm vị trí kết thúc của JSON (dấu } cuối cùng trước batch boundary)
          const jsonEnd = responseText.lastIndexOf("}}") + 2;

          if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error("Không tìm thấy JSON trong responseText");
          }

          // Trích xuất chuỗi JSON
          const jsonString = responseText.substring(jsonStart, jsonEnd);
          const result = JSON.parse(jsonString);
          const transactions =
            result?.d?.DepositAccountTransactions?.results || [];

          if (result.error) {
            // nếu kết quả có lỗi từ server
            return {
              success: false,
              message:
                "Lấy dữ liệu giao dịch thất bại: " + result.error.message.value,
            };
          } else {
            return {
              success: true,
              message: "Đăng nhập và lấy dữ liệu giao dịch thành công",
              transactions: transactions,
            };
          }
        } else {
          console.log(
            "Lấy dữ liệu giao dịch thất bại:",
            transactionResult?.response?.status
          );

          return {
            success: false,
            message: `Đăng nhập thành công nhưng không thể lấy dữ liệu giao dịch (Status: ${transactionResult?.response?.status})`,
          };
        }
      } else {
        await chrome.tabs.remove(tab.id);
        return { success: false, message: "Đăng nhập thất bại" };
      }
    } catch (error) {
      console.error("Lỗi trong callAPI:", error);
      return { success: false, message: error.message };
    }
  }
}

// Khởi tạo instance
const vpbankLogin = new VPBankAuto();

// xử lý message từ popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Xử lý yêu cầu lấy thông tin trình duyệt
  if (request.type === "GET_BROWSER_INFO") {
    // Lấy thông tin trình duyệt hiện tại
    const browserInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
    };

    sendResponse(browserInfo);
    return false; // respond synchronously
  }

  // 2. Xử lý nhận log từ content script
  if (request.action === "contentLog") {
    const { logType, message, data, timestamp } = request;

    // Hiển thị log trong console của extension
    if (logType === "error") {
      console.error(`[Content] ${timestamp} - ${message}`, data);
    } else if (logType === "warn") {
      console.warn(`[Content] ${timestamp} - ${message}`, data);
    } else {
      console.log(`[Content] ${timestamp} - ${message}`, data);
    }

    // Không cần phản hồi
    return;
  }

  // 3. Xử lý yêu cầu lấy giao dịch kết hợp đăng nhập VPBANK
  if (request.action === "transactionHistory") {
    const { username, password, fromDate, toDate } = request; // Lấy thông tin từ request

    vpbankLogin
      .callAPI(username, password, fromDate, toDate)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true; // Giữ message channel mở cho async response
  }

  // ==================== PHẦN XỬ LÝ ACB TRONG background.js ====================

  // 4. Xử lý yêu cầu login ACB từ popup
  if (request.action === "loginACB") {
    const { username, password } = request;

    console.log("Login ACB request from popup for username:", username);

    chrome.tabs.create(
      { url: "https://online.acb.com.vn/", active: false },
      (tab) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);

            console.log("ACB login tab loaded");

            setTimeout(() => {
              chrome.tabs.sendMessage(
                tab.id,
                {
                  action: "loginACB",
                  username,
                  password,
                },
                (response) => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "Content script error:",
                      chrome.runtime.lastError
                    );
                    sendResponse({
                      success: false,
                      message: chrome.runtime.lastError.message,
                    });
                    return;
                  }

                  sendResponse(response);

                  if (response && response.success) {
                    console.log(
                      "Login successful, keeping tab open for verification"
                    );
                  }
                }
              );
            }, 1500);
          }
        });
      }
    );

    return true;
  }

  // 5. Xử lý giải captcha ACB (gửi binary file)
  if (request.action === "solveCaptchaACB") {
    const { imageBase64, mimeType } = request;

    console.log("Solving ACB captcha, base64 length:", imageBase64.length);
    console.log("MIME type:", mimeType);

    // Gửi API giải captcha với JSON body chứa base64
    fetch("https://anticaptcha.top/api/captcha", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: "7df01113faa17644540cfc559bef5319",
        img: imageBase64,
        type: 59 // id loại captcha muốn giải theo anticaptcha.top
      }),
    })
      .then((response) => {
        console.log("Captcha API response status:", response.status);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        console.log("Captcha API response:", data);

        // Kiểm tra success flag trước
        if (!data.success) {
          throw new Error(data.message || "Captcha solving failed");
        }

        // Ưu tiên lấy từ trường 'captcha', sau đó các trường khác
        const captchaText =
          data.captcha || 
          data.text || 
          data.result || 
          data.code || 
          data[0]?.text;

        if (!captchaText) {
          throw new Error("Không tìm thấy captcha text trong response");
        }

        console.log("Captcha solved:", captchaText);

        sendResponse({
          success: true,
          text: captchaText,
        });
      })
      .catch((error) => {
        console.error("Captcha API error:", error);
        sendResponse({
          success: false,
          message: error.message,
        });
      });

    return true;
  }

  // 6. Xử lý login và tự động click account ACB (luồng hoàn chỉnh)
  if (request.action === "loginAndClickACB") {
    const { accountNumber, date } = request;

    console.log(`Starting ACB full flow for account: ${accountNumber}, date: ${date}`);

    // Lấy thông tin tài khoản từ localStorage trước
    chrome.storage.local.get(["banks"], (result) => {
      const banks = result.banks || {};
      const acbAccounts = banks.acb || [];

      console.log("Total ACB accounts in storage:", acbAccounts.length);

      const account = acbAccounts.find(
        (acc) => acc.accountNumber === accountNumber
      );

      if (!account) {
        console.error(`Account ${accountNumber} not found in storage`);
        console.log(
          "Available accounts:",
          acbAccounts.map((a) => a.accountNumber)
        );
        sendResponse({
          success: false,
          message: `Không tìm thấy thông tin tài khoản ${accountNumber} trong storage`,
        });
        return;
      }

      console.log(`Found account ${accountNumber} in storage`);
      console.log("Username:", account.username);

      const { username, password } = account;

      // Tạo hoặc focus tab ACB
      chrome.tabs.query({ url: "*://online.acb.com.vn/*" }, (tabs) => {
        let acbTab = tabs[0];

        if (acbTab) {
            // Clear ACBFlowState trước khi bắt đầu flow mới
            chrome.tabs.sendMessage(
              acbTab.id,
              { action: "clearACBFlowState" },
              (clearResponse) => {
                console.log(
                  "ACBFlowState cleared on existing tab:",
                  clearResponse
                );

                // Sau khi clear xong, bắt đầu flow mới
                chrome.tabs.sendMessage(
                  acbTab.id,
                  {
                    action: "loginAndClickAccountACB",
                    username: username,
                    password: password,
                    accountNumber: accountNumber,
                    date: date
                  },
                  (response) => {
                    console.log("ACB flow initiated:", response);
                    sendResponse(response);
                  }
                );
              }
            );
        } else {
          // Tạo tab mới
          chrome.tabs.create(
            {
              url: "https://online.acb.com.vn/",
              active: false,
            },
            (newTab) => {
              // Đợi tab load xong
              chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === newTab.id && info.status === "complete") {
                  chrome.tabs.onUpdated.removeListener(listener);

                  // Đợi thêm một chút để đảm bảo content script đã load
                  setTimeout(() => {
                    // Clear ACBFlowState trước khi bắt đầu flow mới
                    chrome.tabs.sendMessage(
                      newTab.id,
                      { action: "clearACBFlowState" },
                      (clearResponse) => {
                        console.log(
                          "ACBFlowState cleared on new tab:",
                          clearResponse
                        );

                        // Sau khi clear xong, bắt đầu flow mới
                        chrome.tabs.sendMessage(
                          newTab.id,
                          {
                            action: "loginAndClickAccountACB",
                            username: username,
                            password: password,
                            accountNumber: accountNumber,
                            date: date
                          },
                          (response) => {
                            console.log(
                              "ACB flow initiated on new tab:",
                              response
                            );
                            sendResponse(response);
                          }
                        );
                      }
                    );
                  }, 1000);
                }
              });
            }
          );
        }
      });
    });

    return true; // Keep channel open
  }

  // 7. Handler nhận kết quả transactions từ content script (mảng các giao dịch)
  if (request.action === "acbTransactionsExtracted") {
    const { accountNumber, transactions, fromDate, toDate, success, message } =
      request;

    console.log(`ACB transactions extracted for account ${accountNumber}:`, {
      success,
      count: transactions?.length || 0,
    });

    // Lưu transactions vào storage hoặc xử lý tiếp
    if (success && Array.isArray(transactions)) {
      const payload = {
        accountNumber,
        fromDate,
        toDate,
        transactions,
        success,
        message: message || null,
      };

      // Gửi webhook
      postToN8N(payload).then((r) => {
        console.log("Webhook POST -> n8n:", r);
        
        // Trả response về content script
        if (r.ok) {
          sendResponse({ 
            success: true, 
            message: "Data sent successfully to n8n" 
          });
        } else {
          sendResponse({ 
            success: false, 
            message: "Webhook failed: " + r.error 
          });
        }
      });
      
      return true; // QUAN TRỌNG: Giữ message channel mở cho async response
    } else {
      sendResponse({ 
        success: false, 
        message: message || "Invalid transactions data" 
      });
    }

    return false;
  }

  // 8. Handler đóng tab acb hiện tại
  if (request.action === "closeCurrentTab") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id, () => {
        console.log(`Closed tab ${sender.tab.id}`);
      });
    }
    return false;
  }


  // 9. Xử lý mở FB Hoạt động thanh toán để check Bill
  if (request.action === "CheckBillFb") {
  const { accountNumber, date } = request;

  console.log(`Starting CheckBillFb for account: ${accountNumber}, date: ${date}`);

  // parse date form dd/mm/yyyy to yyyy-mm-dd
  const dateParsed = toIsoDate(date);

  // Wrap trong async function để xử lý tốt hơn
  (async () => {
    try {
      const response = await fetch("https://n8n.hocduthu.com/webhook/transaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountNumber: accountNumber,
          date: dateParsed
        }),
      });

      console.log("CheckBillFb API response status:", response.status);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const groupedTransactions = await response.json();
      console.log("CheckBillFb API response:", groupedTransactions);

      if (!Array.isArray(groupedTransactions) || groupedTransactions.length === 0) {
        console.log("No transactions found");
        sendResponse({ success: true, message: "No transactions to process" });
        return;
      }

      // Find existing tab with billing hub URL
      const queryOptions = { url: "*://business.facebook.com/billing_hub/payment_activity*" };
      let tabs = await chrome.tabs.query(queryOptions);

      let billingTab;
      if (tabs.length > 0) {
        billingTab = tabs[0];
        console.log(`Found existing billing tab: ${billingTab.id}`);
      } else {
        // Create new tab if none exists
        billingTab = await chrome.tabs.create({
          url: "https://business.facebook.com/billing_hub/payment_activity",
          active: false
        });
        console.log(`Created new billing tab: ${billingTab.id}`);

        // Wait for the new tab to fully load
        await new Promise((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === billingTab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        // Đợi thêm để đảm bảo content script đã load
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Loop through each account group
      for (let i = 0; i < groupedTransactions.length; i++) {
        const group = groupedTransactions[i];
        const account_fb_id = group.account_fb_id;
        const records = group.records || [];

        console.log(`Processing account ${i + 1}/${groupedTransactions.length}: ${account_fb_id} with ${records.length} transactions`);

        if (!account_fb_id) {
          console.warn(`Skipping group without account_fb_id:`, group);
          continue;
        }

        if (records.length === 0) {
          console.warn(`Skipping account ${account_fb_id} with no records`);
          continue;
        }

        const newUrl = `https://business.facebook.com/billing_hub/payment_activity?asset_id=${account_fb_id}`;
        console.log(`Updating tab to: ${newUrl}`);

        try {
          // Update tab URL
          await chrome.tabs.update(billingTab.id, { url: newUrl });

          // Đợi tab load xong
          await new Promise((resolve) => {
            const listener = (tabId, info) => {
              if (tabId === billingTab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);

            // Timeout safety sau 15 giây
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
          });

          // Đợi thêm để page ổn định
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Kiểm tra tab còn tồn tại không
          const tabCheck = await chrome.tabs.get(billingTab.id).catch(() => null);
          if (!tabCheck) {
            throw new Error("Tab was closed");
          }

          // Xử lý tất cả transactions của account này
          console.log(`Processing ${records.length} transactions for account ${account_fb_id}`);
          
          for (let j = 0; j < records.length; j++) {
            const record = records[j];
            const ma_gd_fb = record.ma_gd_fb;

            if (!ma_gd_fb) {
              console.warn(`Skipping record without ma_gd_fb:`, record);
              continue;
            }

            console.log(`Processing transaction ${j + 1}/${records.length}: ${ma_gd_fb}`);

            try {
              // Send message to content script
              const messageResponse = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(
                  billingTab.id,
                  {
                    action: "fillAndSearchFacebook",
                    ma_gd_fb: ma_gd_fb
                  },
                  (response) => {
                    if (chrome.runtime.lastError) {
                      console.error("Content script error:", chrome.runtime.lastError);
                      reject(new Error(chrome.runtime.lastError.message));
                      return;
                    }
                    console.log("Fill and search response:", response);
                    resolve(response);
                  }
                );

                // Timeout safety sau 60 giây
                setTimeout(() => {
                  reject(new Error("Message timeout"));
                }, 60000);
              });

              // Gửi kết quả về n8n webhook nếu thành công
              if (messageResponse.success && messageResponse.results) {
                const payload = {
                  accountNumber,
                  account_fb_id: account_fb_id,
                  ma_gd_fb: messageResponse.results.ma_gd_fb,
                  status: messageResponse.results.status,
                  date: messageResponse.results.date,
                  amount: vndToInt(messageResponse.results.amount),
                  reference: messageResponse.results.reference,
                  message: messageResponse.results.message || null,
                  // Thêm thông tin từ record gốc
                  expected_amount: String(record.so_tien).trim().replace(/[.,].*$/, ""),
                  expected_date: record.ngay_hieu_luc
                };

                const webhookResult = await postToN8NCheckBillFacebook(payload);
                console.log(`Webhook POST for ma_gd_fb ${ma_gd_fb}:`, webhookResult);
              }

              // Đợi 2 giây trước khi xử lý transaction tiếp theo trong cùng account
              await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
              console.error(`Error processing transaction ${ma_gd_fb}:`, error);
              
              // Gửi thông tin lỗi về webhook
              const errorPayload = {
                accountNumber,
                account_fb_id: account_fb_id,
                ma_gd_fb: ma_gd_fb,
                status: "error",
                message: error.message,
                expected_amount: record.so_tien,
                expected_date: record.ngay_hieu_luc
              };
              
              await postToN8NCheckBillFacebook(errorPayload);

              // Đợi trước khi retry hoặc tiếp tục
              await new Promise(resolve => setTimeout(resolve, 2000));

              // Tiếp tục với transaction tiếp theo
              continue;
            }
          }

          console.log(`Completed processing account ${account_fb_id}`);
          
          // Đợi 2 giây trước khi chuyển sang account tiếp theo
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
          console.error(`Error processing account ${account_fb_id}:`, error);
          // Tiếp tục với account tiếp theo
          continue;
        }
      }

      console.log("Completed processing all accounts and transactions");
      sendResponse({ success: true, message: `Processed ${groupedTransactions.length} accounts successfully` });

    } catch (error) {
      console.error("CheckBillFb error:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }
  })();

  return true; // Keep the message channel open for async response
}

});
