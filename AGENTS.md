# AGENTS.md - Dự án Đảo Đèn Lồng (AI SDLC)

## Tech Stack & Cấu trúc
- Core Simulation: `src/sim/` (Node.js ES Modules thuần, không dependency ngoài, tất định 100%).
- Headless CLI: `src/cli.js` (chạy qua `node src/cli.js ...`).
- 3D Web Client: `index.html` + `src/client/` (Three.js, gọi trực tiếp `src/sim/`).
- Tests & Verification: `tests/` (chạy qua `node --test tests/*.test.js`).

## Quy tắc bắt buộc (Test Contract)
1. Tách biệt tuyệt đối Core Logic (`src/sim/`) khỏi Renderer (`src/client/`). Không dùng `window`/`document` trong `src/sim/`.
2. Mọi khoảng cách trong `tuning` đo trên mặt phẳng XZ (`Math.hypot(dx, dz) <= r`), không cộng bán kính nhân vật.
3. Input trigger (`jump`, `interact`, `pulse`): chỉ kích hoạt khi chuyển từ `false` sang `true`.
4. Dựng `scenario` ban đầu KHÔNG phát sự kiện và KHÔNG cộng điểm.
5. Mọi tọa độ xuất JSONL làm tròn 3 chữ số thập phân (`Math.round(v * 1000) / 1000`).
6. Trước khi kết thúc bất kỳ task nào, phải chạy `node --test tests/*.test.js` và đảm bảo pass 100%.