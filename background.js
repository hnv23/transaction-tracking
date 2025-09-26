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

// Lớp xử lý đăng nhập tự động VPBank
class VPBankAuto {
  constructor() {
    this.baseURL = "https://neo.vpbank.com.vn";
    this.authAPI = "/cb/odata/ns/authenticationservice";
    this.cookies = {};
    this.deviceId = null;
    this.xCsrfToken = null;
    this.tokenKey = null;
  }

  // Tạo body multipart/mixed cho $batch
  buildBatchBody({
    fromISO,
    toISO,
    top = 200,
    skip = 0,
    tokenKey = "",
    csrfToken = "",
  }) {
    // Tạo boundary ngẫu nhiên
    const boundary = "batch_" + Math.random().toString(36).substring(2, 15);

    // URL encoding theo ví dụ - CHỈ encode những ký tự cần thiết
    const filterParam = `Status%20eq%20%27COMPLETED%27%20and%20(Date%20ge%20datetime%27${fromISO}%27%20and%20Date%20le%20datetime%27${toISO}%27)`;
    const selectParam = `FromAccount%2fId%2cFromAccount%2fNickName%2cFromAccount%2fNumber%2cFromAccount%2fNumberMasked%2cFromAccount%2fCurrencyCode%2cToAccount%2fId%2cToAccount%2fNickName%2cToAccount%2fNumber%2cToAccount%2fNumberMasked%2cToAccount%2fCurrencyCode%2cTrackingID%2cFromAccountName%2cToAccountName%2cAmount%2cAmountCurrency%2cDate%2cId%2cRecId%2cCanDelete%2cCanEdit%2cStatus%2cStatusCode%2cTransferType%2cUserAssignedAmount%2cToAmount%2cTransferDestination%2cMemo%2cTransferFlowType%2cFrequencyDisplayName%2cOCBSTATUS`;
    const expandParam = `FromAccount%2cToAccount`;

    // HTTP request line - CHỈ relative path từ service root
    const httpRequestLine = `GET Transfers?$skip=${skip}&$top=${top}&$orderby=Date%20desc&$filter=${filterParam}&$expand=${expandParam}&$select=${selectParam}&$inlinecount=allpages HTTP/1.1`;

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

      // 2. Thực hiện đăng nhập
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

        // Lấy TokenKey và CSRF token từ response headers
        const headers = loginResult.response.headers;
        this.tokenKey = headers["tokenkey"] || headers["TokenKey"] || "";
        this.xCsrfToken = headers["x-csrf-token"] || "";

        console.log("TokenKey từ login:", this.tokenKey);
        console.log("CSRF Token từ login:", this.xCsrfToken);

        // Cập nhật cookies
        await this.getAllCookies();

        // 3. Tạo batch request cho giao dịch
        const fromDateObj = new Date(fromDate + "T00:00:00");
        const toDateObj = new Date(toDate + "T23:59:59");

        // Format theo OData datetime format
        const fromISO = fromDateObj.toISOString().slice(0, 19);
        const toISO = toDateObj.toISOString().slice(0, 19);

        const { boundary, body } = this.buildBatchBody({
          fromISO,
          toISO,
          top: 200,
          skip: 0,
          tokenKey: this.tokenKey,
          csrfToken: this.xCsrfToken,
        });

        // Transaction request với headers chính xác
        const transactionUrl = `${this.baseURL}/cb/odata/services/transferservice/$batch`;
        const transactionMessage = {
          action: "callApiTransaction",
          url: transactionUrl,
          method: "POST",
          headers: {
            "Content-Type": `multipart/mixed; boundary=${boundary}`,
            Accept: "multipart/mixed",
            Cookie: this.createCookieString(this.cookies),
            Referer: "https://neo.vpbank.com.vn/main.html",
            DataServiceVersion: "2.0",
            MaxDataServiceVersion: "2.0",
            TokenKey: this.tokenKey,
            "x-csrf-token": this.xCsrfToken,
            "device-id": this.deviceId,
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
          const jsonStart = responseText.indexOf('{"d":');
          // Tìm vị trí kết thúc của JSON (dấu } cuối cùng trước batch boundary)
          const jsonEnd = responseText.lastIndexOf("}}") + 2;

          if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error("Không tìm thấy JSON trong responseText");
          }

          // Trích xuất chuỗi JSON
          const jsonString = responseText.substring(jsonStart, jsonEnd);
          const result = JSON.parse(jsonString);

          return {
            success: true,
            message: "Đăng nhập và lấy dữ liệu giao dịch thành công",
            transactions: { count: result.d.__count, data: result.d.results },
          };
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
});
