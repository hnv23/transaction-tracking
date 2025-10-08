// contentTrigger.js
(() => {
  try {
    const u = new URL(location.href);
    const token = u.searchParams.get("token");
    const accountNumber = u.searchParams.get("stk"); // Lấy số tài khoản từ URL

    // Tối giản theo yêu cầu: token cứng
    if (token !== "999999999") return;

    // Kiểm tra có số tài khoản không
    if (!accountNumber) {
      console.error("Missing account number in URL");
      return;
    }

    // Gửi tín hiệu kích hoạt extension với số tài khoản
    chrome.runtime.sendMessage({
      action: "loginAndClickACB",
      accountNumber: accountNumber,
    });
    console.log("Trigger message sent with account:", accountNumber);
  } catch (err) {
    console.error("ContentTrigger error:", err);
  }
})();
