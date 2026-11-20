# Bằng chứng kiểm chứng Phase 3

## Kết quả bộ test

Chạy trên Node.js v20.12.2 ngày 20/11/2026. Cả `node --test` và `node --test tests/*.test.js` đều thoát với mã 0. Lệnh dùng glob chạy qua Git Bash để mở rộng tên tệp trên Windows.

Phần tổng kết TAP từ `node --test`:

```text
1..30
# tests 30
# suites 0
# pass 30
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3676.6249
```

### Test Phase 1–2 cập nhật theo Ticket-03

| Test trong [tests/sim.test.js](../../tests/sim.test.js) | Lý do cập nhật |
| --- | --- |
| `v1.2 declares exact configuration and night map coordinates` | Kiểm tra phiên bản 1.2, thời lượng 240/270/300 giây, 5 điểm mỗi đom đóm và thưởng thời gian bằng 0. |
| `pickup at both distance boundaries and a full deposit score without ending the night` | Giữ kiểm tra ranh giới nhặt đồ và nạp đèn. Thay kỳ vọng thắng sớm bằng việc đêm vẫn tiếp diễn và đạt 165 điểm sau ba lần nhặt và một lần thắp. |
| `no flames takes priority over a pre-lit map and dawn stops the correct night` | Giữ ưu tiên thua khi hết Ngọn Lửa. Đổi mốc bình minh Đêm 1 từ 18.000 xuống 14.400 tick. |
| `full 18,000-tick Night 3 CLI with regular JSONL snapshots takes under 2 seconds` | Đổi cận Đêm 3 từ 21.600 xuống 18.000 tick theo thời lượng mới. Giữ kiểm tra giới hạn 2 giây. |
| `CLI rejects invalid JSON, timestamps, enum values, timers and vectors` | Thêm dữ liệu sai cho dầu vượt 100, số đom đóm vượt sức chứa theo lần thắp và ID đèn mục tiêu không phải chuỗi. |

## Kịch bản CLI · Hút dầu và sống sót tới bình minh

Trong Đêm 1, S1 hút dầu của L4. Cuối đêm Mây dùng 15 đom đóm để thắp lại L1–L3. CLI ghi được bốn sự kiện `fuel_drain` cách nhau 60 tick, L4 tắt ở tick 290 và Mây thắng ở tick 14.400 với 3/5 đèn sáng, 3 Ngọn Lửa và 776 điểm.

Chạy từ thư mục gốc bằng PowerShell:

```powershell
$scenarioFile = New-TemporaryFile
$inputFile = New-TemporaryFile
try {
@'
{
  "random_motes": false,
  "random_shades": false,
  "random_drifters": false,
  "player": {
    "carried": 15,
    "successful_lights": 3
  },
  "lanterns": [
    {
      "x": 0,
      "ever_lit": true
    },
    {
      "x": 4,
      "ever_lit": true
    },
    {
      "x": 8,
      "ever_lit": true
    },
    {
      "x": -25,
      "lit": true,
      "fuel": 29
    },
    {
      "x": 22
    }
  ],
  "shades": [
    {
      "id": "S1",
      "x": -25,
      "z": 1,
      "state": "drain",
      "target_lantern_id": "L4"
    }
  ]
}
'@ | Set-Content -LiteralPath $scenarioFile.FullName -Encoding ascii

@'
[
  {
    "tick": 14000,
    "interact": true
  },
  {
    "tick": 14001,
    "interact": false,
    "x": 1
  },
  {
    "tick": 14040,
    "interact": true
  },
  {
    "tick": 14041,
    "interact": false
  },
  {
    "tick": 14080,
    "interact": true,
    "x": 0
  },
  {
    "tick": 14081,
    "interact": false
  }
]
'@ | Set-Content -LiteralPath $inputFile.FullName -Encoding ascii

    node src/cli.js --night 1 --seed 3 --ticks 14400 --snapshot-every 14400 --scenario $scenarioFile.FullName --inputs $inputFile.FullName
} finally {
    Remove-Item -LiteralPath $scenarioFile.FullName, $inputFile.FullName
}
```

Toàn bộ JSONL từ lần chạy trên. Tùy chọn `--snapshot-every 14400` ghi snapshot đầu đêm và cuối đêm, cùng tất cả sự kiện.

```jsonl
{"type":"snapshot","tick":0,"sim_tick":0,"night":1,"state":"playing","score":0,"result":"in_progress","reason":null,"time_left_s":240,"wind":{"active":false,"dir_deg":0},"player":{"x":0,"y":0,"z":0,"carried":15,"capacity":16,"flames":3,"vel":[0,0,0],"grounded":true,"invuln":false,"dash_cd_s":0,"pulse_cd_s":0,"charm_s":0},"lanterns":[{"id":"L1","x":0,"y":0,"z":0,"lit":false,"deposited":0,"ever_lit":true,"relit_count":0,"fuel":0},{"id":"L2","x":4,"y":0,"z":0,"lit":false,"deposited":0,"ever_lit":true,"relit_count":0,"fuel":0},{"id":"L3","x":8,"y":0,"z":0,"lit":false,"deposited":0,"ever_lit":true,"relit_count":0,"fuel":0},{"id":"L4","x":-25,"y":0,"z":0,"lit":true,"deposited":10,"ever_lit":true,"relit_count":0,"fuel":29},{"id":"L5","x":22,"y":0,"z":0,"lit":false,"deposited":0,"ever_lit":false,"relit_count":0,"fuel":0}],"motes":[],"shades":[{"id":"S1","x":-25,"y":0,"z":1,"state":"drain","state_ticks_left":0,"target_lantern_id":"L4","stunned":false}],"drifters":[],"charms":[]}
{"type":"event","tick":1,"event":"night_start","night":1,"score":0}
{"type":"event","tick":60,"name":"fuel_drain","data":{"lantern_id":"L4","shade_id":"S1","fuel":23}}
{"type":"event","tick":120,"name":"fuel_drain","data":{"lantern_id":"L4","shade_id":"S1","fuel":17}}
{"type":"event","tick":180,"name":"fuel_drain","data":{"lantern_id":"L4","shade_id":"S1","fuel":11}}
{"type":"event","tick":240,"name":"fuel_drain","data":{"lantern_id":"L4","shade_id":"S1","fuel":5}}
{"type":"event","tick":290,"name":"lantern_out","data":{"lantern_id":"L4"}}
{"type":"event","tick":14001,"event":"deposit","lantern_id":"L1","amount":5,"deposited":5,"carried":10,"score":25}
{"type":"event","tick":14001,"event":"lantern_lit","lantern_id":"L1","relight":true,"score":65}
{"type":"event","tick":14041,"event":"deposit","lantern_id":"L2","amount":5,"deposited":5,"carried":5,"score":90}
{"type":"event","tick":14041,"event":"lantern_lit","lantern_id":"L2","relight":true,"score":130}
{"type":"event","tick":14081,"event":"deposit","lantern_id":"L3","amount":5,"deposited":5,"carried":0,"score":155}
{"type":"event","tick":14081,"event":"lantern_lit","lantern_id":"L3","relight":true,"score":195}
{"type":"event","tick":14400,"event":"game_over","result":"won","reason":"dawn_survived","score":776}
{"type":"snapshot","tick":14400,"sim_tick":14400,"night":1,"state":"won","score":776,"result":"won","reason":"dawn_survived","time_left_s":0,"wind":{"active":false,"dir_deg":0},"player":{"x":7.9,"y":0,"z":0,"carried":0,"capacity":20,"flames":3,"vel":[0,0,0],"grounded":true,"invuln":false,"dash_cd_s":0,"pulse_cd_s":0,"charm_s":0},"lanterns":[{"id":"L1","x":0,"y":0,"z":0,"lit":true,"deposited":5,"ever_lit":true,"relit_count":1,"fuel":93.4},{"id":"L2","x":4,"y":0,"z":0,"lit":true,"deposited":5,"ever_lit":true,"relit_count":1,"fuel":94},{"id":"L3","x":8,"y":0,"z":0,"lit":true,"deposited":5,"ever_lit":true,"relit_count":1,"fuel":94.7},{"id":"L4","x":-25,"y":0,"z":0,"lit":false,"deposited":0,"ever_lit":true,"relit_count":0,"fuel":0},{"id":"L5","x":22,"y":0,"z":0,"lit":false,"deposited":0,"ever_lit":false,"relit_count":0,"fuel":0}],"motes":[],"shades":[{"id":"S1","x":-25,"y":0,"z":0,"state":"wander","state_ticks_left":0,"target_lantern_id":"L4","stunned":false}],"drifters":[],"charms":[]}
{"type":"end","tick":14400,"sim_tick":14400,"state":"won","result":"won","reason":"dawn_survived","score":776}
```
