// Constants cho các ngân hàng
const BANKS = {
  tpbank: {
    name: "TPBank",
    domain: "ebank.tpb.vn",
    loginUrl: "https://ebank.tpb.vn/retail/vX/",
  },
  acb: {
    name: "ACB",
    domain: "online.acb.com.vn",
    loginUrl: "https://online.acb.com.vn/",
  },
  vpbank: {
    name: "VPBank",
    domain: "neo.vpbank.com.vn",
    loginUrl: "https://neo.vpbank.com.vn/",
  },
  techcombank: {
    name: "Techcombank",
    domain: "onlinebanking.techcombank.com.vn",
    loginUrl: "https://onlinebanking.techcombank.com.vn/",
  },
};

// Utility: Tạo UUID đơn giản cho tài khoản
function generateAccountId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// Utility: Load dữ liệu từ storage
async function loadBankData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["banks"], (result) => {
      resolve(result.banks || {});
    });
  });
}

// Utility: Lưu dữ liệu vào storage
async function saveBankData(data) {
  return chrome.storage.local.set({ banks: data });
}

// ==================== GLOBAL DATE SETTINGS ====================

// Lưu trữ date settings chung
let globalDateSettings = {
  fromDate: null,
  toDate: null,
};

// Load date settings từ storage
async function loadDateSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["dateSettings"], (result) => {
      const settings = result.dateSettings || {};
      globalDateSettings.fromDate = settings.fromDate || getDefaultFromDate();
      globalDateSettings.toDate = settings.toDate || getDefaultToDate();
      resolve(globalDateSettings);
    });
  });
}

// Lưu date settings vào storage
async function saveDateSettings(fromDate, toDate) {
  globalDateSettings.fromDate = fromDate;
  globalDateSettings.toDate = toDate;
  await chrome.storage.local.set({
    dateSettings: { fromDate, toDate },
  });
}

// Helper: Lấy ngày mặc định (hôm nay)
function getDefaultToDate() {
  const today = new Date();
  return today.toISOString().split("T")[0]; // YYYY-MM-DD
}

// Helper: Lấy ngày mặc định (7 ngày trước)
function getDefaultFromDate() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return sevenDaysAgo.toISOString().split("T")[0]; // YYYY-MM-DD
}

// Helper: Convert date từ YYYY-MM-DD sang YYYYMMDD (cho TPBank)
function formatDateForTPBank(dateString) {
  return dateString.replace(/-/g, "");
}

// TPBank: Logic login (dựa trên code hiện có)
async function loginTPBank(account) {
  const { username, password, accountNumber } = account;
  // Lấy User-Agent từ background
  const browserInfo = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_BROWSER_INFO" }, resolve);
  });
  const userAgent =
    browserInfo?.userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const chromeVersion = userAgent.match(/Chrome\/(\d+)/)?.[1] || "140";

  const response = await fetch(
    "https://ebank.tpb.vn/gateway/api/auth/login/v3", // API đăng nhập TPBank
    {
      method: "POST",
      headers: {
        APP_VERSION: "2025.09.12", // phiên bản đănng nhập
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
        "Content-Type": "application/json",
        // DEVICE_ID: deviceId,
        DEVICE_NAME: "Chrome",
        Origin: "https://ebank.tpb.vn",
        PLATFORM_NAME: "WEB",
        PLATFORM_VERSION: chromeVersion,
        Referer: "https://ebank.tpb.vn/retail/vX/",
        SOURCE_APP: "HYDRO",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": userAgent,
        "sec-ch-ua": `"Not)A;Brand";v="99", "Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"windows"',
      },
      body: JSON.stringify({
        username,
        password,
        deviceId: "crCJMJckMoUzQcLw5Vew88SGnUAEdhTy1DViZezXmTaXj",
        transactionId: "",
      }),
    }
  );

  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  const data = await response.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in || 900 };
}

// TPBank: Logic fetch lịch sử giao dịch
async function fetchTPBankTransactions(account) {
  try {
    const { accessToken, accountNumber } = account;

    // Hiển thị thông báo đang xử lý
    showTransactionStatus("Đang tải dữ liệu giao dịch...", "loading");

    // Lấy date settings
    const dateSettings = await loadDateSettings();

    // Convert dates cho TPBank format (YYYYMMDD)
    const fromDate = formatDateForTPBank(dateSettings.fromDate);
    const toDate = formatDateForTPBank(dateSettings.toDate);

    // Lấy User-Agent từ background (giống như trong hàm loginTPBank)
    const browserInfo = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_BROWSER_INFO" }, resolve);
    });
    const userAgent =
      browserInfo?.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    const chromeVersion = userAgent.match(/Chrome\/(\d+)/)?.[1] || "140";

    const payload = {
      pageNumber: 1,
      pageSize: 10000,
      accountNo: accountNumber,
      currency: "VND",
      maxAcentrysrno: "",
      fromDate: fromDate,
      toDate: toDate,
      keyword: "",
    };

    console.log("Fetching TPBank transactions with payload:", payload);

    const response = await fetch(
      "https://ebank.tpb.vn/gateway/api/smart-search-presentation-service/v2/account-transactions/find",
      {
        method: "POST",
        headers: {
          APP_VERSION: "2025.09.12",
          Accept: "application/json, text/plain, */*",
          Authorization: `Bearer ${accessToken}`,
          device_id: "crCJMJckMoUzQcLw5Vew88SGnUAEdhTy1DViZezXmTaXj",
          "Accept-Language": "en-US,en;q=0.9",
          Connection: "keep-alive",
          "Content-Type": "application/json",
          DEVICE_NAME: "Chrome",
          Origin: "https://ebank.tpb.vn",
          PLATFORM_NAME: "WEB",
          PLATFORM_VERSION: chromeVersion,
          SOURCE_APP: "HYDRO",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "User-Agent": userAgent,
          "sec-ch-ua": `"Not)A;Brand";v="99", "Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}"`,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"windows"',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("TPBank API Error:", response.status, errorText);
      showTransactionStatus(`Lỗi kết nối API: ${response.status}`, "error");
      throw new Error(`Fetch transactions failed: ${response.status}`);
    }

    const data = await response.json();
    console.log("TPBank transactions data:", data);

    // Xử lý đẩy dữ liệu lên Google Sheets
    if (data && data.transactionInfos && data.transactionInfos.length > 0) {
      await exportToGoogleSheets(
        data,
        dateSettings.fromDate,
        dateSettings.toDate
      );
      showTransactionStatus(
        `Đã tải ${data.transactionInfos.length} giao dịch thành công!`,
        "success"
      );
    } else {
      showTransactionStatus(
        "Không có giao dịch nào trong khoảng thời gian này",
        "info"
      );
    }

    return data;
  } catch (error) {
    console.error("Error in fetchTPBankTransactions:", error);
    showTransactionStatus(`Lỗi: ${error.message}`, "error");
    throw error;
  }
}

// Placeholder cho các ngân hàng khác (bạn có thể implement tương tự)
async function loginACB(account) {
  /* Logic login ACB */ throw new Error("Not implemented");
}
async function fetchACBTransactions(account) {
  /* Logic fetch ACB */ throw new Error("Not implemented");
}
async function loginVPBank(account) {
  /* Logic login VPBank */ throw new Error("Not implemented");
}
async function fetchVPBankTransactions(account) {
  /* Logic fetch VPBank */ throw new Error("Not implemented");
}
async function loginTechcombank(account) {
  /* Logic login Techcombank */ throw new Error("Not implemented");
}
async function fetchTechcombankTransactions(account) {
  /* Logic fetch Techcombank */ throw new Error("Not implemented");
}

// ==================== XỬ LÝ TÀI KHOẢN ====================

// Thêm tài khoản mới
async function addAccount(bankId, username, password, accountNumber) {
  const data = await loadBankData();
  if (!data[bankId]) data[bankId] = [];
  const newAccount = {
    id: generateAccountId(),
    username,
    password,
    accountNumber,
    status: "offline",
    accessToken: null,
    tokenExpires: null,
    lastChecked: Date.now(),
  };
  data[bankId].push(newAccount);
  await saveBankData(data);
  renderUI(); // Re-render UI
}

// Xóa tài khoản (tùy chọn, thêm nếu cần)
async function removeAccount(bankId, accountId) {
  const data = await loadBankData();
  data[bankId] = data[bankId].filter((acc) => acc.id !== accountId);
  await saveBankData(data);
  renderUI();
}

// ==================== XỬ LÝ NÚT CHO TÀI KHOẢN ====================

// Nút mở tab đăng nhập
function openLoginTab(bankId) {
  chrome.tabs.create({ url: BANKS[bankId].loginUrl });
}

// Nút load (kiểm tra đăng nhập)
async function loadAccount(bankId, account) {
  try {
    let loginResult;
    if (bankId === "tpbank") loginResult = await loginTPBank(account);
    // Thêm cho các ngân hàng khác nếu implement

    // Cập nhật status và token
    account.status = "online";
    account.accessToken = loginResult.accessToken;
    account.tokenExpires = Date.now() + loginResult.expiresIn * 1000;
    account.lastChecked = Date.now();

    const data = await loadBankData();
    const bankAccounts = data[bankId];
    const index = bankAccounts.findIndex((acc) => acc.id === account.id);
    bankAccounts[index] = account;
    await saveBankData(data);
    renderUI(); // Re-render để hiển thị nút lấy lịch sử
  } catch (error) {
    account.status = "offline";
    account.accessToken = null;
    account.tokenExpires = null;
    const data = await loadBankData();
    const bankAccounts = data[bankId];
    const index = bankAccounts.findIndex((acc) => acc.id === account.id);
    bankAccounts[index] = account;
    await saveBankData(data);
    renderUI();
  }
}

// Hiển thị trạng thái giao dịch
function showTransactionStatus(message, type = "info") {
  // Xóa thông báo cũ nếu có
  const existingStatus = document.getElementById("transactionStatus");
  if (existingStatus) {
    existingStatus.remove();
  }

  // Tạo element mới
  const statusDiv = document.createElement("div");
  statusDiv.id = "transactionStatus";
  statusDiv.className = `tran-status ${type}`;

  // Tạo container riêng cho icon
  const iconContainer = document.createElement("span");
  iconContainer.className = "status-icon-container";
  statusDiv.appendChild(iconContainer);

  // Tạo icon phù hợp với loại thông báo
  const iconElement = document.createElement("i");
  switch (type) {
    case "error":
      iconElement.className = "fas fa-exclamation-circle";
      break;
    case "success":
      iconElement.className = "fas fa-check-circle";
      break;
    case "loading":
      // Biểu tượng tĩnh không có hiệu ứng quay
      iconElement.className = "fas fa-clock"; // or "fas fa-hourglass" or another static icon
      break;
    case "info":
    default:
      iconElement.className = "fas fa-info-circle";
  }

  // Thêm icon vào container
  iconContainer.appendChild(iconElement);

  // Thêm message text vào div chính (tách biệt với icon)
  const messageText = document.createElement("span");
  messageText.className = "status-message";
  messageText.textContent = message;
  statusDiv.appendChild(messageText);

  // Thêm vào đầu container
  const container = document.getElementById("bankCategories");
  container.insertAdjacentElement("beforebegin", statusDiv);

  // Tự động ẩn thông báo sau 10 giây nếu không phải loading
  if (type !== "loading") {
    setTimeout(() => {
      if (statusDiv && statusDiv.parentNode) {
        statusDiv.remove();
      }
    }, 10000);
  }
}

// Hàm xử lý đẩy dữ liệu lên Google Sheets
async function exportToGoogleSheets(data, fromDate, toDate) {
  try {
    // Hiển thị thông báo đang xử lý
    showTransactionStatus("Đang đẩy dữ liệu lên Google Sheets...", "loading");

    if (
      !data ||
      !data.transactionInfos ||
      !Array.isArray(data.transactionInfos)
    ) {
      throw new Error("Dữ liệu giao dịch không hợp lệ");
    }

    // Chuẩn bị dữ liệu cho Google Sheets
    const transactions = data.transactionInfos.map((transaction, index) => {
      let transactionType = "UNKNOWN";
      if (transaction.interbankTrans === "IBFT_O_VND") {
        transactionType = "OUT";
      } else if (transaction.interbankTrans === "IBFT_I_VND") {
        transactionType = "IN";
      }

      return {
        stt: index + 1,
        reference: transaction.reference,
        performDate: transaction.performDate,
        description: transaction.description,
        transactionType: transactionType,
        amount: transaction.amount,
      };
    });

    // Tạo tên sheet mới từ khoảng thời gian
    const sheetName = `${fromDate} - ${toDate}`;

    // Gọi Google Sheets API (thông qua API trung gian nếu cần)
    const sheetsApiUrl = "https://n8n.hocduthu.com/webhook/tpbank";

    // Kích thước batch (số giao dịch mỗi lần gửi)
    const BATCH_SIZE = 100;
    let successCount = 0;
    let totalBatches = Math.ceil(transactions.length / BATCH_SIZE);

    // Xử lý theo batch để tránh timeout và lỗi do kích thước request
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const currentBatch = transactions.slice(i, i + BATCH_SIZE);
      const currentBatchNumber = Math.floor(i / BATCH_SIZE) + 1;

      // Hiển thị trạng thái cho người dùng
      showTransactionStatus(
        `Đang xử lý batch ${currentBatchNumber}/${totalBatches} (${
          i + 1
        }-${Math.min(i + BATCH_SIZE, transactions.length)}/${
          transactions.length
        } giao dịch)...`,
        "loading"
      );

      // Xây dựng payload cho batch hiện tại
      const payload = {
        sheetName: sheetName,
        data: currentBatch,
        headers: [
          "STT",
          "Mã Giao Dịch",
          "Thời Gian",
          "Nội Dung",
          "Loại GD",
          "Số Tiền",
        ],
        isFirstBatch: i === 0, // Đánh dấu batch đầu tiên để tạo sheet và thêm header
        append: i > 0, // Các batch tiếp theo sẽ append dữ liệu
      };

      console.log(
        `Sending batch ${currentBatchNumber}/${totalBatches} to Google Sheets:`,
        {
          batchSize: currentBatch.length,
          totalProcessed: i + currentBatch.length,
        }
      );

      // Gọi API thực tế để đẩy dữ liệu lên Google Sheets
      const response = await fetch(sheetsApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Xử lý kết quả từ API
      const result = await response.json();

      // Kiểm tra kết quả từ API
      if (!result.success) {
        throw new Error(`API error: ${result.message || "Unknown error"}`);
      }

      if (result.success) {
        successCount += currentBatch.length;
      } else {
        throw new Error(
          `Lỗi khi xử lý batch ${currentBatchNumber}: ${
            result.message || "Không xác định"
          }`
        );
      }

      // Cập nhật trạng thái hiện tại sau mỗi batch
      if (i + BATCH_SIZE < transactions.length) {
        showTransactionStatus(
          `Đã xử lý ${successCount}/${
            transactions.length
          } giao dịch (${Math.round(
            (successCount / transactions.length) * 100
          )}%)...`,
          "info"
        );
      }
    }

    // Thông báo thành công khi hoàn tất
    showTransactionStatus(
      `Đã đẩy thành công ${successCount}/${transactions.length} giao dịch lên Google Sheets!`,
      "success"
    );

    return { success: true, message: "Xử lý dữ liệu hoàn tất" };
  } catch (error) {
    console.error("Google Sheets Export Error:", error);
    showTransactionStatus(
      `Lỗi khi đẩy dữ liệu lên Google Sheets: ${error.message}`,
      "error"
    );
    throw error;
  }
}

// Nút lấy lịch sử giao dịch
async function fetchTransactions(bankId, account) {
  try {
    if (bankId === "tpbank") {
      await fetchTPBankTransactions(account);
    }
    // Thêm cho các ngân hàng khác
    // Nếu thành công, giữ status online
  } catch (error) {
    console.error("Error fetching transactions:", error);

    // Hiển thị lỗi lên giao diện
    showTransactionStatus(`Lỗi khi tải giao dịch: ${error.message}`, "error");

    // Nếu thất bại, chuyển offline và ẩn nút
    account.status = "offline";
    account.accessToken = null;
    account.tokenExpires = null;
    const data = await loadBankData();
    const bankAccounts = data[bankId];
    const index = bankAccounts.findIndex((acc) => acc.id === account.id);
    bankAccounts[index] = account;
    await saveBankData(data);
    renderUI();
  }
}

// ==================== RENDER UI ====================

// Render toàn bộ UI
async function renderUI() {
  const data = await loadBankData();
  const container = document.getElementById("bankCategories");
  container.innerHTML = "";

  Object.keys(BANKS).forEach((bankId) => {
    const bank = BANKS[bankId];
    const accounts = data[bankId] || [];

    // Danh mục ngân hàng
    const bankSection = document.createElement("div");
    bankSection.className = "bank-category";
    bankSection.innerHTML = `<h4>${bank.name}</h4>`;

    // Nút thêm tài khoản
    const addBtn = document.createElement("button");
    addBtn.className = "add-account-btn";
    addBtn.innerHTML = '<i class="fas fa-plus"></i> Thêm mới';
    addBtn.addEventListener("click", () => showAddForm(bankId));
    bankSection.appendChild(addBtn);

    // Danh sách tài khoản
    accounts.forEach((account) => {
      const accDiv = document.createElement("div");
      accDiv.className = `account-item ${account.status}`;

      // Hiển thị số tài khoản
      const accNumberSpan = document.createElement("span");
      accNumberSpan.className = "account-number";
      accNumberSpan.textContent = `Tài khoản: ${account.accountNumber}`;
      accDiv.appendChild(accNumberSpan);

      // Hiển thị trạng thái bằng icon
      const statusIcon = document.createElement("i");
      if (account.status === "online") {
        statusIcon.className = "fas fa-circle status-icon online-icon";
        statusIcon.title = "Online";
      } else {
        statusIcon.className = "fas fa-circle status-icon offline-icon";
        statusIcon.title = "Offline";
      }
      accDiv.appendChild(statusIcon);

      // Tạo vùng chứa các nút
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";

      // Nút mở tab
      const openBtn = document.createElement("button");
      openBtn.className = "icon-button login-btn";
      openBtn.title = "Mở đăng nhập";
      openBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i>';
      openBtn.addEventListener("click", () => openLoginTab(bankId));
      buttonContainer.appendChild(openBtn);

      // Nút load
      const loadBtn = document.createElement("button");
      loadBtn.className = "icon-button load-btn";
      loadBtn.title = "Load";
      loadBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
      loadBtn.addEventListener("click", () => loadAccount(bankId, account));
      buttonContainer.appendChild(loadBtn);

      // Nút lấy lịch sử (chỉ nếu online)
      if (account.status === "online") {
        const fetchBtn = document.createElement("button");
        fetchBtn.className = "icon-button fetch-btn";
        fetchBtn.title = "Lấy lịch sử";
        fetchBtn.innerHTML = '<i class="fas fa-history"></i>';
        fetchBtn.addEventListener("click", () =>
          fetchTransactions(bankId, account)
        );
        buttonContainer.appendChild(fetchBtn);
      }

      // Nút xóa tài khoản
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "icon-button delete-btn";
      deleteBtn.title = "Xóa tài khoản";
      deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
      deleteBtn.addEventListener("click", () =>
        deleteAccount(bankId, account.id)
      );
      buttonContainer.appendChild(deleteBtn);

      accDiv.appendChild(buttonContainer);

      bankSection.appendChild(accDiv);
    });

    container.appendChild(bankSection);
  });
}

// Hiển thị form thêm tài khoản
function showAddForm(bankId) {
  // Ẩn form hiện tại nếu có
  const existingForm = document.querySelector(".add-form");
  if (existingForm) {
    existingForm.remove();
  }

  // Tìm bank category tương ứng
  const bankCategories = document.querySelectorAll(".bank-category");
  let targetBankCategory = null;

  bankCategories.forEach((category) => {
    const h4 = category.querySelector("h4");
    if (h4 && h4.textContent === BANKS[bankId].name) {
      targetBankCategory = category;
    }
  });

  if (!targetBankCategory) return;

  const formDiv = document.createElement("div");
  formDiv.className = "add-form";
  formDiv.setAttribute("data-bank-id", bankId);

  const usernameInput = document.createElement("input");
  usernameInput.placeholder = "Tài khoản";
  usernameInput.id = `username-${bankId}`;

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.placeholder = "Mật khẩu";
  passwordInput.id = `password-${bankId}`;

  const accountNumberInput = document.createElement("input");
  accountNumberInput.placeholder = "Số tài khoản";
  accountNumberInput.id = `accountNumber-${bankId}`;

  const submitBtn = document.createElement("button");
  submitBtn.className = "form-submit-btn";
  submitBtn.innerHTML = '<i class="fas fa-check"></i> Thêm';
  submitBtn.addEventListener("click", () => submitAdd(bankId));

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "form-cancel-btn";
  cancelBtn.innerHTML = '<i class="fas fa-times"></i> Hủy';
  cancelBtn.addEventListener("click", () => cancelAdd(bankId));

  formDiv.appendChild(usernameInput);
  formDiv.appendChild(passwordInput);
  formDiv.appendChild(accountNumberInput);
  formDiv.appendChild(submitBtn);
  formDiv.appendChild(cancelBtn);

  // Thêm form ngay sau bank category
  targetBankCategory.insertAdjacentElement("afterend", formDiv);
}

// Submit form thêm
async function submitAdd(bankId) {
  const username = document.getElementById(`username-${bankId}`).value;
  const password = document.getElementById(`password-${bankId}`).value;
  const accountNumber = document.getElementById(
    `accountNumber-${bankId}`
  ).value;
  if (username && password && accountNumber) {
    await addAccount(bankId, username, password, accountNumber);
    // Xóa form sau khi thêm thành công
    const form = document.querySelector(`.add-form[data-bank-id="${bankId}"]`);
    if (form) form.remove();
  }
}

// Hủy form
function cancelAdd(bankId) {
  const form = document.querySelector(`.add-form[data-bank-id="${bankId}"]`);
  if (form) {
    form.remove();
  }
}

// Xóa tài khoản
async function deleteAccount(bankId, accountId) {
  // Hiện dialog xác nhận
  // if (!confirm("Bạn có chắc chắn muốn xóa tài khoản này không?")) {
  //   return;
  // }

  try {
    // Load dữ liệu hiện tại
    const data = await loadBankData();

    // Kiểm tra tài khoản tồn tại
    if (!data[bankId] || !Array.isArray(data[bankId])) {
      throw new Error("Không tìm thấy tài khoản");
    }

    // Lọc bỏ tài khoản cần xóa
    data[bankId] = data[bankId].filter((account) => account.id !== accountId);

    // Lưu lại dữ liệu
    await saveBankData(data);

    // Render lại UI
    await renderUI();

    alert("Đã xóa tài khoản thành công!");
  } catch (error) {
    console.error("Lỗi khi xóa tài khoản:", error);
    alert("Đã xảy ra lỗi khi xóa tài khoản. Vui lòng thử lại.");
  }
}

// ==================== KHỞI TẠO ====================

// Load UI ban đầu
async function initializeApp() {
  // Load date settings và set cho inputs
  const dateSettings = await loadDateSettings();
  document.getElementById("fromDate").value = dateSettings.fromDate;
  document.getElementById("toDate").value = dateSettings.toDate;

  // Render UI
  await renderUI();
}

// Xử lý nút áp dụng dates
document.getElementById("applyDates").addEventListener("click", async () => {
  const fromDate = document.getElementById("fromDate").value;
  const toDate = document.getElementById("toDate").value;

  if (!fromDate || !toDate) {
    alert("Vui lòng chọn cả từ ngày và đến ngày!");
    return;
  }

  if (new Date(fromDate) > new Date(toDate)) {
    alert("Từ ngày không được lớn hơn đến ngày!");
    return;
  }

  await saveDateSettings(fromDate, toDate);
  alert("Đã cập nhật khoảng thời gian giao dịch!");
});

// Nút làm mới
document.getElementById("refresh").addEventListener("click", renderUI);

// Khởi tạo app
initializeApp();
