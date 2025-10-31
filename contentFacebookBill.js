// contentFacebookBill.js - Fixed & Improved for Continuous Search
(() => {
  console.log("Facebook Bill Content Script Loaded");

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // === UTILS ===
  const closeAnyOpenPopup = async () => {
    for (let i = 0; i < 5; i++) {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return true;

      const closeBtn = [...dialog.querySelectorAll('div[role="button"]')]
        .find(btn => ["Đóng", "Hủy", "Quay lại"].some(text => btn.textContent.includes(text)));
      if (closeBtn) {
        closeBtn.click();
        await wait(800);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(600);
      }
    }
    return true;
  };

  // === MAIN HANDLER ===
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== "fillAndSearchFacebook") return;

    const { ma_gd_fb } = request;
    console.log(`\n🚀 Bắt đầu xử lý: ${ma_gd_fb}`);

    (async () => {
      try {
        // await closeAnyOpenPopup();
        await wait(1000);

        // === STEP 1: Mở popup "Số tham chiếu" ===
        const openReferencePopup = async () => {
          for (let i = 0; i < 20; i++) {
            const btn = [...document.querySelectorAll('div[role="button"] span')]
              .find(el => el.textContent.includes("Số tham chiếu") && !el.textContent.includes("Kết quả"));
            if (btn && btn.offsetParent) {
              btn.click();
              console.log("✅ Đã click 'Số tham chiếu'");
              return true;
            }
            await wait(500);
          }
          throw new Error("Không tìm thấy nút 'Số tham chiếu'");
        };

        await openReferencePopup();
        await wait(1200);

        // === STEP 2: Đợi input field ===
        const inputField = await (async () => {
          for (let i = 0; i < 15; i++) {
            const el = document.querySelector('input[placeholder="Nhập số tham chiếu…"]');
            if (el && el.offsetParent) return el;
            await wait(500);
          }
          throw new Error("Không tìm thấy input field");
        })();

        // === STEP 3: Nhập số tham chiếu ===
        inputField.focus();
        inputField.value = '';
        inputField.select(); // Select all để đảm bảo xóa
        await wait(100);

        for (const char of ma_gd_fb) {
          inputField.value += char;
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(60);
        }
        inputField.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✅ Đã nhập: ${inputField.value}`);

        // === STEP 4: Click "Tìm kiếm" hoặc Enter ===
        let searchButton = Array.from(
        document.querySelectorAll('div[aria-busy="false"][role="button"] span.x8t9es0 div.x8t9es0')
        ).find(el => el.textContent.includes("Tìm kiếm") && !el.closest('[aria-disabled="true"]'));

        // Fallback: Tìm trong dialog
        if (!searchButton) {
        console.log("   Method 1 failed, trying method 2...");
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
            const buttons = dialog.querySelectorAll('div[role="button"]');
            for (const btn of buttons) {
            if (btn.textContent.includes("Tìm kiếm") && btn.getAttribute('aria-disabled') !== 'true') {
                searchButton = btn;
                break;
            }
            }
        }
        }

        // Fallback cuối: Dùng Enter
        if (!searchButton) {
        console.log("   Method 2 failed, using Enter key...");
        inputField.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
        }));
        console.log("Pressed Enter key");
        } else {
        console.log("Found 'Tìm kiếm' button");
        searchButton.click();
        console.log("Clicked 'Tìm kiếm' button");
        }

        await wait(2000);

        // === STEP 5: Đợi kết quả ===
        const result = await (async () => {
        for (let i = 0; i < 25; i++) {
            // 1. Kiểm tra "Không tìm thấy"
            // const noResult = [...document.querySelectorAll('span')]
            // .some(s => s.textContent.includes("Không tìm thấy giao dịch nào"));
            // if (noResult) {
            // console.log("Không tìm thấy giao dịch");
            // return { found: false };
            // }

            // 2. Kiểm tra heading "Kết quả cho ..."
            const heading = [...document.querySelectorAll('div[role="heading"][aria-level="4"]')]
            .find(h => h.textContent.startsWith("Kết quả cho") && h.offsetParent);
            if (heading) {
            // Tìm container chính xác: cha có class x1iyjqo2 và chứa các div.x78zum5.xdt5ytf
            const container = heading.closest('div.x1iyjqo2');
            if (container && container.querySelector('div.x78zum5.xdt5ytf')) {
                console.log("Tìm thấy kết quả:", heading.textContent);
                return { found: true, container };
            }
            }
            await wait(400); // Giảm từ 600 → 400ms
        }
        throw new Error("Timeout chờ kết quả");
        })();

        let extracted = { date: null, amount: null, reference: null };

        if (result.found) {
          const items = result.container.querySelectorAll('div.x78zum5.xdt5ytf');
          items.forEach(item => {
            const label = item.querySelector('span')?.textContent.trim();
            const value = item.querySelector('div[role="heading"]')?.textContent.trim();
            if (!label || !value) return;

            if (label.includes("Ngày")) extracted.date = value;
            if (label.includes("Số tiền")) extracted.amount = value;
            if (label.includes("Số tham chiếu")) extracted.reference = value;
          });
          console.log("✅ Dữ liệu:", extracted);
        }

        // === STEP 6: Nhấn "Quay lại" hoặc "Đóng" để tiếp tục ===
        console.log("\nStep 6: Tìm dialog 'Số tham chiếu' và nút 'Quay lại'...");

        const backBtn = await (async () => {
        for (let i = 0; i < 30; i++) {
            // TÌM TẤT CẢ dialog
            const allDialogs = document.querySelectorAll('div[role="dialog"]');
            console.log(`Tìm thấy ${allDialogs.length} dialog`);

            let targetDialog = null;

            // TÌM dialog có tiêu đề "Số tham chiếu"
            for (const dlg of allDialogs) {
            const title = dlg.querySelector('div[role="heading"]');
            if (title && title.textContent.includes("Số tham chiếu")) {
                targetDialog = dlg;
                console.log("TÌM THẤY DIALOG 'SỐ THAM CHIẾU'");
                break;
            }
            }

            if (!targetDialog) {
            console.log("Chưa thấy dialog 'Số tham chiếu'");
            await wait(400);
            continue;
            }

            // Trong dialog đúng → tìm nút "Quay lại"
            const buttons = targetDialog.querySelectorAll('div[role="button"][aria-busy="false"]');
            for (const btn of buttons) {
            const textDiv = btn.querySelector('div');
            if (textDiv && textDiv.textContent.trim() === "Quay lại" && textDiv.offsetParent) {
                console.log("TÌM THẤY NÚT 'QUAY LẠI'");
                return btn;
            }
            }

            console.log("Dialog đúng đã có, nhưng chưa thấy nút 'Quay lại'...");
            await wait(400);
        }
        return null;
        })();

        if (backBtn) {
        backBtn.click();
        console.log("ĐÃ CLICK 'QUAY LẠI'");
        await wait(100);
        } else {
        console.warn("Không tìm thấy → dùng ESC");
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(1000);
        }

        // === GỬI KẾT QUẢ ===
        sendResponse({
          success: true,
          results: {
            ma_gd_fb,
            status: result.found ? "found" : "no_results",
            date: extracted.date,
            amount: extracted.amount,
            reference: extracted.reference
          }
        });

      } catch (error) {
        console.error("❌ Lỗi:", error.message);
        try { await closeAnyOpenPopup(); } catch {}
        sendResponse({ success: false, message: error.message });
      }
    })();

    return true; // Keep channel open
  });
})();