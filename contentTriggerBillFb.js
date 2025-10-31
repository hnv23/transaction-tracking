// contentCheckBillFb.js
(() => {
  try {
    const u = new URL(location.href);
    const token = u.searchParams.get("token");
    const accountNumber = u.searchParams.get("stk");
    const dateParam = u.searchParams.get("date"); // Lấy date từ URL

    // Tối giản theo yêu cầu: token cứng
    if (token !== "999999999") return;

    // Kiểm tra có số tài khoản không
    if (!accountNumber) {
      console.error("Missing account number in URL");
      return;
    }
    

    // Gửi tín hiệu kích hoạt extension với số tài khoản và date
    chrome.runtime.sendMessage({
      action: "CheckBillFb",
      accountNumber: accountNumber,
      date: dateParam || null, // Truyền date, null nếu không có
    });
    console.log("Trigger message sent with account:", accountNumber, "date:", dateParam);
  } catch (err) {
    console.error("ContentTrigger error:", err);
  }
})();