# AGENTS.md - Dự án Đảo Đèn Lồng (AI SDLC)

## Tech Stack & Cấu trúc
- Core Simulation: `src/sim/` (Node.js ES Modules thuần, không dependency ngoài, tất định 100%).
- Headless CLI: `src/cli.js` (chạy qua `node src/cli.js ...`).
- 3D Web Client: `index.html` + `src/client/` (Three.js, gọi trực tiếp `src/sim/`).
- Tests & Verification: `tests/` (chạy qua `node --test tests/*.test.js`).

## Quy tắc bắt buộc (Test Contract v1.2)

`game.contract.json` khai báo `contract_version: "1.2"`.

1. Tách biệt tuyệt đối Core Logic (`src/sim/`) khỏi Renderer (`src/client/`). Không dùng `window`/`document` trong `src/sim/`.
2. Đo khoảng cách XZ bằng `Math.hypot(dx, dz) <= r`, không cộng bán kính nhân vật. Pulse đo 3D từ chân Mây + 0.8m. Nhặt đom đóm và va chạm Bóng Mực còn yêu cầu `|dY| <= 1.5m`.
3. `pause`, `jump`, `dash`, `interact`, `pulse` chỉ kích hoạt ở cạnh lên `false -> true`. Tick đầu ra vẫn tăng khi tạm dừng, còn `sim_tick`, timer và thế giới đứng yên.
4. Dựng `scenario` ban đầu KHÔNG phát sự kiện và KHÔNG cộng điểm.
5. Mọi tọa độ xuất JSONL làm tròn 3 chữ số thập phân (`Math.round(v * 1000) / 1000`).
6. Trước khi kết thúc bất kỳ task nào, phải chạy `node --test tests/*.test.js` và đảm bảo pass 100%.
7. Thứ tự mỗi tick ở 60Hz: input/pause, timers, di chuyển Mây, nhặt đồ, nạp đèn, vùng an toàn, Pulse, di chuyển địch, Gió Lạc cướp rồi Bóng Mực va chạm theo ID, sinh định kỳ, thắng/thua, snapshot.
8. Dùng `fuel_ticks` nguyên ở bước timer, với 60 tick dầu cho mỗi đơn vị dầu. Vùng an toàn hoạt động khi đèn sáng và dầu từ 30 trở lên. Xét đủ 60% đèn sáng tại bình minh và ưu tiên thua ngay khi hết ngọn lửa.
