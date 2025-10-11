console.log("ACB Content Script loaded");

// ========== FLOW STATE MANAGEMENT ==========
const ACBFlowState = {
  save(state) {
    sessionStorage.setItem("acb_flow_state", JSON.stringify(state));
  },

  load() {
    const stored = sessionStorage.getItem("acb_flow_state");
    return stored ? JSON.parse(stored) : null;
  },

  clear() {
    sessionStorage.removeItem("acb_flow_state");
  },

  checkAndExecute() {
    try {
      const state = this.load();
      if (!state) return;

      console.log("Found pending ACB flow state:", state);

      switch (state.action) {
        case "CLICK_ACCOUNT":
          waitForHomepageAndClickAccount(
            state.accountNumber,
            state.attemptCount || 0,
            state.date
          );
          break;
        case "FILTER_AND_SUBMIT":
          // Trang chi tiết đã load, cần filter và submit
          waitAndFilterByDate(state);
          break;
        case "GET_TRANSACTIONS":
          // Đã submit filter, giờ lấy transactions
          waitAndGetTransactions(state);
          break;
        default:
          console.error("Unknown action in state:", state.action);
          this.clear();
          break;
      }
    } catch (error) {
      console.error("Error in checkAndExecute:", error);
      this.clear();
    }
  },
};

// ========== PAGE DETECTION ==========
function detectCurrentPage() {
  const url = window.location.href;
  const bodyText = document.body?.textContent || "";
  // helper so khớp chính xác nội dung, gom khoảng trắng và chuẩn hóa Unicode
  const hasExactH4 = (text) =>
    Array.from(document.querySelectorAll("h4")).some(
      (h) => h.textContent.normalize("NFC").trim().replace(/\s+/g, " ") === text
    );

  if (document.querySelector('input[name="PassWord"]')) {
    return "LOGIN";
  }

  if (
    document.querySelector("#table, .table-style") &&
    document.querySelectorAll('a[href*="AccountNbr"]').length > 0 &&
    hasExactH4("Thông tin tài khoản")
  ) {
    return "ACCOUNT_LIST";
  }

  // Trang chi tiết có form filter ngày
  if (document.querySelector('input[name="FromDate"]')) {
    // Kiểm tra xem đã có bảng giao dịch chưa
    const hasTransactionTable = !!document.getElementById("table1");

    return hasTransactionTable
      ? "ACCOUNT_DETAIL_WITH_DATA"
      : "ACCOUNT_DETAIL_NO_DATA";
  }

  return "UNKNOWN";
}

// ========== MAIN FLOW HANDLER ==========
async function handleLoginAndGetTransactions(
  username,
  password,
  accountNumber,
  date
) {
  try {
    console.log(
      `Starting full flow: login -> click account ${accountNumber} -> filter -> get transactions, date: ${date}`
    );

    const currentPage = detectCurrentPage();
    console.log("Current page:", currentPage);

    switch (currentPage) {
      case "LOGIN":
        ACBFlowState.save({
          action: "CLICK_ACCOUNT",
          accountNumber: accountNumber,
          username: username,
          date: date,
          attemptCount: 0,
          startTime: Date.now(),
        });
        await performLogin(username, password);
        break;

      case "ACCOUNT_LIST":
        const clickResult = await clickAccountWithRetry(accountNumber);
        if (clickResult.success) {
          // Sau khi click account, cần filter theo ngày
          ACBFlowState.save({
            action: "FILTER_AND_SUBMIT",
            accountNumber: accountNumber,
            date: date,
            startTime: Date.now(),
          });
        } else {
          console.error("Failed to click account, clearing state");
          ACBFlowState.clear();
          return clickResult;
        }
        break;

      case "ACCOUNT_DETAIL_NO_DATA":
        // Trang chi tiết đã load nhưng chưa có data, cần filter và submit
        await filterAndSubmitByDate(date);
        // Lưu state để lấy transactions sau khi reload
        ACBFlowState.save({
          action: "GET_TRANSACTIONS",
          accountNumber: accountNumber,
          date: date,
          startTime: Date.now(),
        });
        break;

      case "ACCOUNT_DETAIL_WITH_DATA":
        // Đã có data, lấy transactions
        const transactions = await extractTransactions();
        ACBFlowState.clear();
        return {
          success: true,
          transactions: transactions,
          message: `Đã lấy ${transactions.length} giao dịch`,
        };

      default:
        console.error("Unknown page state");
        ACBFlowState.clear();
        return {
          success: false,
          message: "Không xác định được trang hiện tại",
        };
    }
  } catch (error) {
    console.error("Error in handleLoginAndGetTransactions:", error);
    ACBFlowState.clear();
    return {
      success: false,
      message: error.message || "Có lỗi xảy ra trong quá trình xử lý",
    };
  }
}

// ========== LOGIN HANDLER ==========
async function performLogin(username, password) {
  try {
    console.log("Performing login...");

    const captchaBlob = await getCaptchaBlob();
    const captchaText = await solveCaptcha(captchaBlob);

    document.querySelector('input[name="UserName"]').value = username;
    document.querySelector('input[name="PassWord"]').value = password;
    document.querySelector('input[name="SecurityCode"]').value = captchaText;

    findAndClickSubmitButton();
    console.log("Login form submitted, page will reload...");
  } catch (error) {
    console.error("Login failed:", error);
    ACBFlowState.clear();
    throw error;
  }
}

// ========== ACCOUNT CLICK HANDLER ==========
async function clickAccountWithRetry(accountNumber, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(
        `Attempting to click account ${accountNumber} (attempt ${
          i + 1
        }/${maxRetries})`
      );

      await waitForElement("#table, .table-style", 5000);

      const result = await clickAccountLink(accountNumber);
      if (result.success) {
        console.log("Account clicked successfully, page will reload...");
        return result;
      }
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  return {
    success: false,
    message: `Failed to click account after ${maxRetries} attempts`,
  };
}

async function clickAccountLink(accountNumber) {
  const normalizedAccountNumber = accountNumber.toString().replace(/\s+/g, "");
  const links = document.querySelectorAll("#table a, .table-style a, table a");

  for (const link of links) {
    const linkText = link.textContent.trim().replace(/\s+/g, "");
    if (linkText === normalizedAccountNumber) {
      console.log(`Found account link: ${link.href}`);
      link.click();
      return {
        success: true,
        message: `Clicked account ${accountNumber}`,
      };
    }
  }

  throw new Error(`Account ${accountNumber} not found in table`);
}

// ========== DATE FILTER AND SUBMIT ==========
async function filterAndSubmitByDate(date) {
  console.log("Filtering by date and submitting...");

  // Đợi form load
  await waitForElement('input[name="FromDate"]', 5000);

  // // Lấy ngày hiện tại và 1 ngày trước
  // const toDate = new Date();
  // const fromDate = new Date();
  // fromDate.setDate(fromDate.getDate() - 1);

  // // Format ngày dd/mm/yyyy
  // const formatDate = (date) => {
  //   const day = String(date.getDate()).padStart(2, "0");
  //   const month = String(date.getMonth() + 1).padStart(2, "0");
  //   const year = date.getFullYear();
  //   return `${day}/${month}/${year}`;
  // };

  // const fromDateStr = formatDate(fromDate);
  // const toDateStr = formatDate(toDate);

  // console.log(`Setting date range: ${fromDateStr} to ${toDateStr}`);


  let fromDateStr, toDateStr;

  if (date) {
    // Nếu có date từ URL, parse và sử dụng
    try {
      // Parse date format dd/mm/yyyy
      const parts = date.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // Month is 0-indexed
        const year = parseInt(parts[2]);
        
        const targetDate = new Date(year, month, day);

        const formatDate = (d) => {
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yyyy = d.getFullYear();
          return `${dd}/${mm}/${yyyy}`;
        };

        // Cả fromDate và toDate đều dùng cùng 1 giá trị
        fromDateStr = formatDate(targetDate);
        toDateStr = formatDate(targetDate);
        
        console.log(`Using date from URL: ${fromDateStr} to ${toDateStr}`);
      } else {
        throw new Error("Invalid date format");
      }
    } catch (error) {
      console.error("Error parsing date from URL:", error);
      // Fallback to default behavior
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 1);
      
      const formatDate = (d) => {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };
      
      fromDateStr = formatDate(fromDate);
      toDateStr = formatDate(toDate);
    }
  } else {
    // Nếu không có date, dùng logic cũ (ngày hiện tại và 1 ngày trước)
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 1);

    const formatDate = (d) => {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    fromDateStr = formatDate(fromDate);
    toDateStr = formatDate(toDate);
    console.log("Using default date range (today and yesterday)");
  }

  console.log(`Setting date range: ${fromDateStr} to ${toDateStr}`);

  // Điền ngày vào form
  const fromDateInput = document.querySelector('input[name="FromDate"]');
  const toDateInput = document.querySelector('input[name="ToDate"]');

  if (fromDateInput && toDateInput) {
    fromDateInput.value = fromDateStr;
    toDateInput.value = toDateStr;

    // Đợi một chút để đảm bảo giá trị đã được set
    await new Promise((r) => setTimeout(r, 500));

    // Tìm và click nút "Xem"
    const viewButton = Array.from(
      document.querySelectorAll('input[type="button"]')
    ).find((btn) => btn.value === "Xem");

    if (viewButton) {
      console.log("Clicking 'Xem' button...");
      viewButton.click();
      console.log("Form submitted, page will reload with transaction data...");
    } else {
      throw new Error("Could not find 'Xem' button");
    }
  } else {
    throw new Error("Could not find date input fields");
  }
}

// ========== TRANSACTION EXTRACTION ==========
async function extractTransactions() {
  console.log("Extracting transactions from detail page...");

  // Đợi bảng giao dịch xuất hiện
  await waitForElement("#table1", 10000);

  const transactions = [];
  const table = document.getElementById("table1");

  if (!table) {
    console.error("Table with id 'table1' not found");
    return transactions;
  }

  const rows = table.querySelectorAll("tr");
  console.log(`Found ${rows.length} rows in transaction table`);

  // Bỏ qua header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.querySelectorAll("td");

    // Kiểm tra xem đây có phải hàng dữ liệu chính (có 6 cột)
    if (cells.length === 6) {
      // Lấy ngày hiệu lực, ngày giao dịch, số GD
      const effectiveDate = cells[0]?.textContent?.trim() || "";
      const transactionDate = cells[1]?.textContent?.trim() || "";
      const transactionNumber = cells[2]?.textContent?.trim() || "";

      // Lấy số tiền (loại bỏ ký tự &nbsp; và khoảng trắng)
      const debitText = cells[3]?.textContent?.trim().replace(/\s+/g, "") || "";
      const creditText =
        cells[4]?.textContent?.trim().replace(/\s+/g, "") || "";
      const balanceText =
        cells[5]?.textContent?.trim().replace(/\s+/g, "") || "";

      // Lấy mô tả từ hàng tiếp theo (nếu có)
      let description = "";
      if (i + 1 < rows.length) {
        const nextRow = rows[i + 1];
        const nextCells = nextRow.querySelectorAll("td");

        // Hàng mô tả thường có class "acctSum" hoặc colspan
        if (nextCells.length > 0) {
          const descCell = nextRow.querySelector("td.acctSum");
          if (descCell) {
            description = descCell.textContent?.trim() || "";
            i++; // Skip hàng mô tả ở lần lặp tiếp theo
          }
        }
      }

      // Chỉ thêm giao dịch nếu có ngày hiệu lực và có tiền
      if (effectiveDate && (debitText || creditText)) {
        const transaction = {
          effectiveDate: effectiveDate,
          transactionDate: transactionDate,
          transactionNumber: transactionNumber,
          debit: debitText === "&nbsp;" || debitText === "" ? "" : debitText,
          credit:
            creditText === "&nbsp;" || creditText === "" ? "" : creditText,
          balance:
            balanceText === "&nbsp;" || balanceText === "" ? "" : balanceText,
          description: description,
        };

        transactions.push(transaction);
        // console.log(`Transaction ${transactions.length}:`, transaction);
      }
    }
  }

  console.log(`Successfully extracted ${transactions.length} transactions`);
  // console.table(transactions);
  return transactions;
}

// ========== HELPER FUNCTIONS ==========
async function getCaptchaBlob() {
  const captchaImg = document.querySelector('img[src*="Captcha.jpg"]');
  if (!captchaImg) throw new Error("Không tìm thấy ảnh captcha");

  const response = await fetch(captchaImg.src, {
    credentials: "include",
    cache: "no-cache",
  });

  return response.blob();
}

async function solveCaptcha(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const response = await chrome.runtime.sendMessage({
    action: "solveCaptchaACB",
    imageData: Array.from(uint8Array),
    mimeType: blob.type,
  });

  if (response?.success) {
    return response.text;
  }
  throw new Error(response?.message || "Không thể giải captcha");
}

function findAndClickSubmitButton() {
  const selectors = [
    "a.acbone-submit-button",
    'a[onclick*="submitFormLogin"]',
    ".button-blue.acbone-submit-button",
  ];

  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button) {
      button.click();
      return true;
    }
  }
  return false;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver(() => {
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
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

async function waitForHomepageAndClickAccount(accountNumber, attemptCount = 0, date = null) {
  try {
    console.log(
      `Waiting for homepage to load and click account ${accountNumber}`
    );

    const maxWaitTime = 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const currentPage = detectCurrentPage();

      if (currentPage === "ACCOUNT_LIST") {
        console.log("Account list page detected, clicking account...");
        await new Promise((r) => setTimeout(r, 1500));

        const result = await clickAccountWithRetry(accountNumber);
        if (result.success) {
          ACBFlowState.save({
            action: "FILTER_AND_SUBMIT",
            accountNumber: accountNumber,
            date: date,
            startTime: Date.now(),
          });
        } else {
          console.error(
            "Failed to click account in waitForHomepageAndClickAccount"
          );
          ACBFlowState.clear();
        }
        return;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    console.error("Timeout waiting for account list page");
    ACBFlowState.clear();
  } catch (error) {
    console.error("Error in waitForHomepageAndClickAccount:", error);
    ACBFlowState.clear();
  }
}

async function waitAndFilterByDate(state) {
  try {
    console.log("Waiting for detail page to load for filtering...");

    const maxWaitTime = 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const currentPage = detectCurrentPage();
      console.log("Current page during waitAndFilterByDate:", currentPage);

      if (currentPage === "ACCOUNT_DETAIL_NO_DATA") {
        console.log("Detail page detected, filtering by date...");
        await new Promise((r) => setTimeout(r, 2000));

        await filterAndSubmitByDate(state.date);

        // Sau khi submit, lưu state để lấy transactions
        ACBFlowState.save({
          action: "GET_TRANSACTIONS",
          accountNumber: state.accountNumber,
          date: state.date,
          startTime: Date.now(),
        });
        return;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    console.error("Timeout waiting for detail page");
    ACBFlowState.clear();
  } catch (error) {
    console.error("Error in waitAndFilterByDate:", error);
    ACBFlowState.clear();
  }
}

async function waitAndGetTransactions(state) {
  try {
    console.log("Waiting for transaction data to load...");

    const maxWaitTime = 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const currentPage = detectCurrentPage();
      console.log("Current page during waitAndGetTransactions:", currentPage);

      if (currentPage === "ACCOUNT_DETAIL_WITH_DATA") {
        console.log("Transaction data detected, extracting...");
        await new Promise((r) => setTimeout(r, 2000));

        const transactions = await extractTransactions();
        // Lấy giá trị từ input FromDate và ToDate
        const fromDateInput = document.querySelector('input[name="FromDate"]');
        const toDateInput = document.querySelector('input[name="ToDate"]');

        const fromDate = fromDateInput
          ? fromDateInput.value
          : state.fromDate || "";
        const toDate = toDateInput ? toDateInput.value : state.toDate || "";

        // Gửi message về background
        chrome.runtime.sendMessage(
          {
            action: "acbTransactionsExtracted",
            fromDate: fromDate,
            toDate: toDate,
            accountNumber: state.accountNumber,
            transactions: transactions,
            success: true,
          },
          (response) => {
            console.log("Response from background:", response);
            
            // Đóng tab sau khi nhận response từ background
            if (response && response.success) {
              console.log("Closing current tab...");
              chrome.runtime.sendMessage({ action: "closeCurrentTab" });
            }
          }
        );

        ACBFlowState.clear();
        return;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    console.error("Timeout waiting for transaction data");
    chrome.runtime.sendMessage({
      action: "acbTransactionsExtracted",
      accountNumber: state.accountNumber,
      success: false,
      message: "Timeout waiting for transaction data",
    });
    ACBFlowState.clear();
  } catch (error) {
    console.error("Error in waitAndGetTransactions:", error);
    chrome.runtime.sendMessage({
      action: "acbTransactionsExtracted",
      accountNumber: state.accountNumber,
      success: false,
      message: error.message || "Error extracting transactions",
    });
    ACBFlowState.clear();
  }
}

// ========== INITIALIZATION ==========
window.addEventListener("load", () => {
  console.log("Page loaded, checking for pending ACB flow...");
  ACBFlowState.checkAndExecute();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "loginAndClickAccountACB") {
    const { username, password, accountNumber, date } = request;

    handleLoginAndGetTransactions(username, password, accountNumber, date)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          message: error.message,
        })
      );

    return true;
  }

  if (request.action === "clearACBFlowState") {
    try {
      ACBFlowState.clear();
      console.log("ACBFlowState cleared successfully");
      sendResponse({
        success: true,
        message: "ACBFlowState cleared",
      });
    } catch (error) {
      console.error("Error clearing ACBFlowState:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }
    return false;
  }
});

console.log("ACB Content Script ready with date filtering support");
