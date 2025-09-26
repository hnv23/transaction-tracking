// contentVpBank.js - Content script chạy trên trang VPBank

(function () {
  "use strict";

  // Kiểm tra xem có phải trang đăng nhập VPBank không
  if (window.location.hostname !== "neo.vpbank.com.vn") {
    return;
  }

  console.log("VPBank Auto Login Content Script loaded");

  // Helper function để đợi element xuất hiện
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations) => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }, timeout);
    });
  }

  // Lưu trữ các API calls gần đây để phân tích
  window._apiCallsLog = window._apiCallsLog || [];

  // Hàm gửi log từ content script về background script
  function sendLogToBackground(type, message, data) {
    chrome.runtime.sendMessage({
      action: "contentLog",
      logType: type,
      message: message,
      data: data,
      timestamp: new Date().toISOString(),
    });
    // Vẫn giữ log trong console trang web
    if (type === "error") {
      console.error(message, data);
    } else if (type === "warn") {
      console.warn(message, data);
    } else {
      console.log(message, data);
    }
  }

  async function callApi(
    url,
    method,
    headers,
    data,
    parseResponse,
    apiType = "general"
  ) {
    try {
      // Xây dựng fetch options
      const fetchOptions = {
        method: method,
        headers: headers,
        credentials: "include",
        mode: "cors",
      };

      if (data) {
        fetchOptions.body =
          typeof data === "string" ? data : JSON.stringify(data);
      }

      // Thực hiện request
      const response = await fetch(url, fetchOptions);

      // Đọc response text ngay lập tức
      const responseText = await response.text();

      sendLogToBackground("log", "Response status:", response.status);

      // Tạo response object với text data đã được đọc
      const responseObj = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url,
        ok: response.ok,

        // Trả về text đã được đọc thay vì function
        textContent: responseText,

        // Giữ lại methods để tương thích ngược
        json: async () => {
          try {
            return JSON.parse(responseText);
          } catch (e) {
            throw new Error(`Failed to parse JSON: ${e.message}`);
          }
        },

        text: async () => responseText, // Trả về text đã đọc

        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(responseText).buffer;
        },
      };

      return responseObj;
    } catch (error) {
      sendLogToBackground(
        "error",
        `API call error (${apiType}):`,
        error.message
      );

      return {
        error: error.message,
        status: 0,
        ok: false,
        headers: {},
        textContent: "",
        text: async () => "",
        json: async () => {
          throw new Error("No response data");
        },
      };
    }
  }

  // Hàm gọi API đăng nhập - wrapper cho callApi
  async function callApiLogin(url, method, headers, data, parseResponse) {
    return callApi(url, method, headers, data, parseResponse, "login");
  }

  // Hàm gọi API giao dịch - wrapper cho callApi
  // Cập nhật hàm callApiTransaction để debug lỗi
  async function callApiTransactionWithDebug(
    url,
    method,
    headers,
    data,
    parseResponse
  ) {
    sendLogToBackground("log", "Calling transaction API with debug...", {});

    const result = await callApi(
      url,
      method,
      headers,
      data,
      parseResponse,
      "transaction"
    );

    // Nếu có lỗi, debug chi tiết
    if (result && (!result.ok || result.status >= 400)) {
      sendLogToBackground("error", "Transaction API failed, debugging...", {});
      const debugInfo = await debugErrorResponse(result);
      sendLogToBackground("error", "Debug info:", debugInfo);

      // Attach debug info to result
      result.debugInfo = debugInfo;
    }

    return result;
  }

  async function debugErrorResponse(response) {
    try {
      console.log("=== DEBUGGING ERROR RESPONSE ===");
      console.log("Status:", response.status);
      console.log("StatusText:", response.statusText);
      console.log("OK:", response.ok);
      console.log("URL:", response.url);

      // Log tất cả headers
      console.log("=== RESPONSE HEADERS ===");
      Object.entries(response.headers).forEach(([key, value]) => {
        console.log(`${key}: ${value}`);
      });

      // Đọc response body
      const responseText = await response.text();
      console.log("=== RESPONSE BODY ===");
      console.log("Body length:", responseText.length);
      console.log("Content-Type:", response.headers["content-type"]);

      if (responseText) {
        console.log("Response body:");
        console.log(responseText);

        // Thử parse XML nếu content-type là application/xml
        if (response.headers["content-type"]?.includes("xml")) {
          try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(
              responseText,
              "application/xml"
            );
            const errorElement = xmlDoc.querySelector("error");
            if (errorElement) {
              const errorCode = errorElement.querySelector("code")?.textContent;
              const errorMessage =
                errorElement.querySelector("message")?.textContent;
              console.log("XML Error Code:", errorCode);
              console.log("XML Error Message:", errorMessage);
              return { errorCode, errorMessage, fullXML: responseText };
            }
          } catch (xmlError) {
            console.log("Failed to parse XML:", xmlError);
          }
        }
      }

      return {
        status: response.status,
        body: responseText,
        headers: response.headers,
      };
    } catch (error) {
      console.error("Error debugging response:", error);
      return null;
    }
  }

  function initialize() {
    //Initializing VPBank Auto Login...
    // Lắng nghe messages từ extension
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // 1. Xử lý yêu cầu lấy deviceId
      if (request.action === "getDeviceId") {
        let deviceId = localStorage.getItem("deviceId");
        if (!deviceId) {
          console.log("DeviceId không tìm thấy trong localStorage");
          deviceId = "A27E9A12-D9CA-4F60-9164-0CF97789707D";
          console.warn(
            "DeviceId chưa được tạo, sử dụng giá trị giả:",
            deviceId
          );
        } else {
          console.log("DeviceId lấy từ localStorage:", deviceId);
        }
        sendResponse({ deviceId: deviceId });
      }

      // 2. Xử lý yêu cầu gọi API đăng nhập
      if (request.action === "callApiLogin") {
        sendLogToBackground(
          "log",
          "Nhận yêu cầu gọi API đăng nhập từ background script:",
          request.url
        );

        callApiLogin(
          request.url,
          request.method,
          request.headers,
          request.data,
          request.parseResponse
        )
          .then((response) => {
            sendLogToBackground("log", "API response status:", response.status);
            sendResponse({ response: response });
          })
          .catch((error) => {
            sendLogToBackground("error", "API call error:", error.message);
            sendResponse({ error: error.message });
          });

        return true; // Giữ message channel mở cho async response
      }

      // 3. Xử lý yêu cầu gọi API lấy giao dịch
      if (request.action === "callApiTransaction") {
        callApiTransactionWithDebug(
          // Sử dụng hàm callApiTransaction riêng cho việc gọi API giao dịch
          request.url,
          request.method,
          request.headers,
          request.data,
          request.parseResponse
        )
          .then((response) => {
            sendLogToBackground(
              "log",
              "API transaction response status:",
              response.status
            );
            sendResponse({ response: response });
          })
          .catch((error) => {
            sendLogToBackground(
              "error",
              "API transaction call error:",
              error.message
            );
            sendResponse({ error: error.message });
          });

        return true; // Giữ message channel mở cho async response
      }

      return true; // Giữ connection mở cho async responses
    });
  }

  // Khởi chạy khi DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

  // Theo dõi thay đổi URL (SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log("URL changed, reinitializing...");
      setTimeout(initialize, 1000); // Đợi một chút để trang load
    }
  }).observe(document, { subtree: true, childList: true });
})();
