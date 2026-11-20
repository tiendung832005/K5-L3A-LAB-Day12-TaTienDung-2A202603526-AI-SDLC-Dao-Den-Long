# Bằng chứng kiểm chứng Phase 4

Thực hiện ngày 20/11/2026 trên Windows x64 với Node.js v20.12.2 và Playwright 1.65.1.

## Kiểm thử tự động

`node --test` và `node --test tests/*.test.js` đều đạt **34/34**, với 0 lỗi và 0 test bị bỏ qua. Trên Windows, chạy lệnh dùng glob qua Git Bash để mở rộng tên tệp. Bộ kiểm thử gồm 30 test hồi quy trong [sim.test.js](../../tests/sim.test.js) và 4 test [Phase 4](../../tests/phase4.test.js) cho soak tất định, xuất top 10, ghi đồng thời qua API và cảnh benchmark. Đối chiếu với phiên bản trước xác nhận toàn bộ `tuning` giống v1.2.

## Soak headless

```sh
node src/soak.js --seed 7 --nights 10 --out soak.json
```

Báo cáo ghi **10 đêm, 0 crash**, thời gian 0,452 giây. RSS đầu 28,64 MiB và RSS cuối 39,09 MiB. Đầu vào ngẫu nhiên khiến cả 10 lượt kết thúc khi hết Ngọn Lửa.

| Seed | Đêm | Tick kết thúc | Lý do | Điểm |
| ---: | ---: | ---: | --- | ---: |
| 7 | 1 | 2719 | `no_flames` | 5 |
| 8 | 2 | 3958 | `no_flames` | 25 |
| 9 | 3 | 2512 | `no_flames` | 0 |
| 10 | 1 | 2036 | `no_flames` | 20 |
| 11 | 2 | 2904 | `no_flames` | 10 |
| 12 | 3 | 2564 | `no_flames` | 20 |
| 13 | 1 | 1704 | `no_flames` | 15 |
| 14 | 2 | 2045 | `no_flames` | 0 |
| 15 | 3 | 3696 | `no_flames` | 0 |
| 16 | 1 | 2528 | `no_flames` | 10 |

## Benchmark WebGL headful

```sh
node src/bench.js --seed 42 --duration 30 --out bench.json
```

Cửa sổ Chromium 1280×720 chạy với hai cờ tắt vsync. Dữ liệu bên dưới lấy từ lần đo đủ 30 giây sau 3 giây khởi động. Một lần đo trước đó bị đóng cửa sổ giữa chừng. Lần chạy lại hoàn tất và thoát mã 0.

```json
{
  "contract_version": "1.3",
  "avg_fps": 96.92293842876147,
  "p1_low_fps": 46.01932811780905,
  "frame_ms_p95": 13.899999999999636,
  "frames": 2907,
  "load_ms": 2573.786376953125,
  "peak_mem_mb": 128.40234375,
  "vsync_off": true,
  "renderer": "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "os": "win32 10.0.26200 x64"
}
```

## Kiểm tra giao diện trong Chrome

- Giao diện có đủ chín hành động đổi phím. Chrome xác nhận cảnh báo trùng phím, phím tạm dừng sau khi đổi, lưu sau tải lại và khôi phục mặc định.
- Ở 1280×720 đo được cỡ chữ cơ sở 18 px và 22,5 px ở chế độ Chữ lớn. Khi bật Giảm chuyển động, lớp flash ẩn trong lúc lướt.
- Kịch bản rút ngắn xác nhận chỉ báo và mũi tên cho Bóng Mực mới xuất hiện, gió mạnh sắp tới, 10 giây cuối và dầu thấp. Tín hiệu gió được đưa vào từ kịch bản kiểm tra UI, còn thời điểm gió trong simulation do bộ test hồi quy kiểm tra.
- Kịch bản Thua và Bình Minh gửi điểm qua launcher. Bảng xếp hạng trong menu hiển thị tên đã lưu và API lưu ISO 8601 UTC. Phép kiểm tra dùng tệp dữ liệu tạm.
