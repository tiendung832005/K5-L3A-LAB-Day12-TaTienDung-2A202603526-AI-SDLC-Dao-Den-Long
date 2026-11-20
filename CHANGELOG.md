# Changelog

## v1.3 — Ticket-04 (Phase 4)

- Launcher phục vụ game và lưu bảng xếp hạng cục bộ, với tùy chọn xuất 10 kết quả cao nhất.
- Thêm soak headless qua nhiều đêm và benchmark WebGL headful với cảnh Đêm 1 được chuẩn hóa.
- Thêm đổi phím, chỉ báo trực quan, giảm chuyển động và chữ lớn.

## v1.2 — Ticket-03 (Phase 3)

### Breaking changes từ v1.1

- Bỏ kết quả thắng sớm `all_lit`. Kết quả `dawn_survived` được xét khi hết giờ nếu Mây còn Ngọn Lửa và có ít nhất 60% đèn sáng, làm tròn số đèn cần thiết lên.
- Rút ngắn mỗi đêm 60 giây. Đêm 1 giảm từ 300 xuống 240 giây, Đêm 2 từ 330 xuống 270 giây và Đêm 3 từ 360 xuống 300 giây.
- Giảm `score.per_mote` từ 10 xuống 5. Bỏ thưởng thời gian bằng `score.per_second_left = 0`. Thưởng cuối đêm tính theo số đèn sáng, dầu còn lại và số Ngọn Lửa còn lại.
- Đèn sáng tiêu hao dầu và mất vùng an toàn khi dầu dưới 30. Tương tác với đèn sáng châm thêm dầu. Đèn từng sáng cần 5 đom đóm để thắp lại.
- Sức chứa bắt đầu ở 10, tăng thêm 2 sau mỗi lần thắp thành công và tối đa là 20.
- Snapshot thêm `lanterns[].fuel`, `lanterns[].ever_lit`, `lanterns[].relit_count` và `player.capacity`.
- Bóng Mực có thêm trạng thái `drain`. JSONL thêm các sự kiện `lantern_out`, `refuel` và `fuel_drain` với trường `name` và `data`. Sự kiện `lantern_lit` thêm cờ `relight`.
