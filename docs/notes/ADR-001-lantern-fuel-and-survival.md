# ADR-001 — Nhiên liệu đèn và sống sót tới bình minh

**Trạng thái** — Đã áp dụng trong Ticket-03, Test Contract v1.2.

- Cờ `lit` chỉ phản ánh đèn đang sáng hay tắt. Nhiên liệu cho phép người chơi cân nhắc giữa mở thêm vùng an toàn và duy trì các đèn đã thắp.
- Đèn chuyển theo chuỗi `unlit` → `lit` với `fuel = 100` → `low_fuel` khi dưới 30 → `out` khi dầu về 0.
- `lit` vẫn là cờ trong snapshot. Trạng thái dầu thấp và cạn dầu được xác định từ `fuel_ticks` và `ever_lit`.
- `low_fuel` làm mất `safe_radius`. Châm dầu về mức từ 30 trở lên khôi phục vùng an toàn và đẩy Bóng Mực ra mép.
- Đèn ở trạng thái `out` giữ `ever_lit = true` và cần 5 đom đóm để thắp lại, so với 10 đom đóm lần đầu.
- Mỗi bước mô phỏng dài 1/60 giây. Dùng số nguyên `fuel_ticks` với 60 tick dầu cho một đơn vị và 6.000 tick khi đầy để tránh sai số tích lũy.
- Đèn sáng giảm 1 tick dầu mỗi bước. Mỗi Bóng Mực đang hút làm giảm thêm 5 tick dầu.
- Bỏ thắng sớm `all_lit`. Kết quả `dawn_survived` đòi hỏi Mây còn lửa và giữ ít nhất `ceil(0.6 × tổng số đèn)` đèn sáng tới bình minh.
- Dầu còn lại và số Ngọn Lửa quyết định thưởng cuối đêm, qua đó khuyến khích duy trì đèn tới hạn.
