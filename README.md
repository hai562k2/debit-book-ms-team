# Quản Lý Nợ Tiền Cơm Trưa (Teams + Node.js + React)

Ứng dụng quản lý công nợ cơm trưa cho nhóm Teams theo hướng đơn giản:
- Tạo khoản thu theo từng ngày (có thể tạo bù ngày cũ).
- Theo dõi ai đã trả/chưa trả.
- Tính tổng nợ theo account.
- Cân đối cuối cùng ai nợ ai sau nhiều ngày.
- Nhắc nợ tự động 2 mốc giờ/ngày.

## Luồng hiện tại

1. Backend -> Teams (1 chiều)
- Backend gửi thông báo lên Teams qua `TEAMS_OUTGOING_WEBHOOK_URL`.

2. Trả tiền
- Thực hiện trên web bằng nút `Đánh dấu đã trả`.

Lưu ý:
- Đã bỏ luồng `react tim = trả tiền`.
- Không còn endpoint workflow action để nhận callback react/reply.

## 1) Cài đặt và chạy

```bash
npm install
npm run start:be
npm run start:fe
```

Mặc định:
- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`

## 2) Cấu hình `.env`

Copy `.env.example` thành `.env`, điền tối thiểu:

```env
BE_PORT=4000
FE_PORT=5173
FE_API_BASE_URL=http://localhost:4000
FRONTEND_ORIGIN=http://localhost:5173

APP_TIMEZONE=Asia/Ho_Chi_Minh
DAILY_REMINDER_TIMES=14:55,17:30
STORAGE_FILE=./data/campaigns.json
ACCOUNT_EMAIL_DOMAIN=rikkeisoft.com

WEBHOOK_TOKEN=replace_with_your_internal_token
TEAMS_OUTGOING_WEBHOOK_URL=<url-workflow-post-message>
```

## 3) Tạo Workflow gửi tin vào Teams (Flow 1)

Mục tiêu: để backend gửi thông báo vào chat/channel Teams.

Các bước:
1. Tạo flow mới với trigger: `When a Teams webhook request is received`.
2. Thêm action: `Post message in a chat or channel`.
3. Ở trường Message, chọn dynamic content `text` từ trigger.
4. Save flow, copy `HTTP POST URL`.
5. Dán URL đó vào `TEAMS_OUTGOING_WEBHOOK_URL` trong `.env`.

## 4) Cách dùng web

Mở `http://localhost:5173`:
1. Nhập tiêu đề bữa.
2. Chọn ngày bữa trưa (mặc định hôm nay; có thể chọn ngày cũ nếu quên tạo).
3. Nhập số tiền mỗi người.
4. Nhập `payerCode` (người ứng tiền).
5. Nhập danh sách account (mỗi dòng 1 người).
6. Bấm `Tạo khoản thu`.

Sau đó:
- Theo dõi danh sách đang nợ.
- Khi ai trả tiền, nhập account và bấm `Đánh dấu đã trả`.

## 5) Quy tắc tính tiền

1. Mỗi campaign = 1 bữa ăn + 1 ngày (`dateKey`).
2. Người ứng tiền (`payerCode`) không nằm trong nhóm cần trả.
3. Mỗi account chỉ được ghi nhận trả 1 lần cho 1 campaign.
4. Tổng nợ theo người lấy từ `GET /debts/by-name`.
5. Cân đối bù trừ giữa các cặp lấy từ `GET /debts/settlements`.
6. Nhắc nợ tự động theo `DAILY_REMINDER_TIMES`, mỗi mốc gửi 2 tin:
- Tin tổng nợ.
- Tin nợ theo ngày.
7. Nếu tổng không còn nợ: hiển thị `Không ai nợ ai.`
8. Khi đủ người trả: campaign đóng và bị xóa khỏi danh sách mở.

## 6) API chính

- `GET /health`
- `GET /campaigns/open`
- `GET /debts/by-name`
- `GET /debts/settlements`
- `POST /campaigns/manual`
- `POST /campaigns/:id/paid`
- `POST /webhook/teams` (optional, nếu bạn muốn tạo campaign từ tin nhắn theo mẫu)

## 7) Dữ liệu lưu ở đâu?

Mặc định lưu ở `./data/campaigns.json` (hoặc theo `STORAGE_FILE`).

## 8) Test

```bash
npm test
```
