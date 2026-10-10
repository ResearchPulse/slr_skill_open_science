# SLR MCP với Open-Science

Tài liệu này hướng dẫn kết nối một project SLR với Open-Science thông qua MCP local. MCP server chỉ dùng token của một project và agent đã được cấp quyền.

## 1. Chuẩn bị trong SLR

1. Mở project SLR và vào **Settings → AI Agents**.
2. Chọn **ChatGPT — Open-Science**.
3. Bấm **Connect and generate project token**.
4. Copy token một lần vào phần cấu hình connector local của Open-Science.
5. Chọn paper và bấm **Assign to ChatGPT**.

Token này chỉ có scope trên agent/project đó. Không dán token vào chat, skill, source code, issue, screenshot hoặc log. Nếu token đã bị lộ, dùng **Rotate** trong SLR rồi cập nhật connector local.

## 2. Cài root package và kiểm tra

Release root package được gọi bằng GitHub reference cố định:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 setup
```

`setup` chỉ hiển thị safe preview, không tự thay đổi connector, profile hoặc file local. Preview cho biết package root, `open-science` CLI có được phát hiện hay không và các bước tiếp theo. Có thể dùng `--json` để lấy preview dạng JSON:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 setup --json
```

Dùng `doctor` để kiểm tra asset đã được đóng gói và khả năng có `open-science` CLI:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 doctor
```

`doctor` luôn in report dạng JSON. Lệnh trả về non-zero nếu thiếu asset của package; việc không tìm thấy `open-science` CLI chỉ được ghi nhận trong report, không tự nó làm package check thất bại. Cả `setup` và `doctor` đều không yêu cầu hoặc in project token.

## 3. Cấu hình MCP local

Khi cấu hình connector cho bản phát hành, dùng root package và flag `--mcp`:

```text
Command: npx
Arguments: --yes github:<org>/slr_skill_open_science#v0.1.0 --mcp
```

Lệnh tương đương:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 --mcp
```

Root entrypoint chuyển tiếp stdio tới MCP server đã compile mà không gọi shell. stdout dành cho JSON-RPC; log chẩn đoán đi qua stderr.

MCP package nằm ở `mcp/slr-agent-mcp`; có thể chạy trực tiếp bằng `npx slr-agent-mcp` khi phát triển local.

Environment cần có:

```text
SLR_API_BASE_URL=https://<backend-host>/api
SLR_AGENT_TOKEN=<project-scoped-token>
```

Ví dụ PowerShell khi chạy bản local:

```powershell
$env:SLR_API_BASE_URL = "http://localhost:<backend-port>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

Chỉ dùng `http://` cho loopback local. Với backend thật, dùng HTTPS.

Trong Open-Science, tạo local MCP connector với command tương đương:

```text
npx
```

Arguments:

```text
--yes github:<org>/slr_skill_open_science#v0.1.0 --mcp
```

Đặt hai environment variables ở phần connector configuration, không đặt trong nội dung hội thoại. MCP giao tiếp qua stdio; stdout dành cho JSON-RPC, log chẩn đoán đi qua stderr.

## 4. Quyền xác nhận

Chọn permission mode **Ask for approval** trong Open-Science.

`submit_review_result` là write tool. Luồng ghi có hai lớp:

1. Skill `/slr review` hiển thị decision, reasoning và data cuối cùng rồi hỏi `confirm` hoặc `cancel`.
2. MCP server yêu cầu confirmation qua MCP elicitation trước khi gửi POST đến backend.

Nếu host không hỗ trợ elicitation/approval, không được bypass. Hãy bật capability tương ứng hoặc dừng trước bước ghi.

## 5. Dùng skill `/slr`

```text
/slr
/slr status
/slr tasks
/slr task <taskId>
/slr fulltext <taskId>
/slr review next
/slr review <taskId>
```

Không có `/slr submit`; submit chỉ là bước cuối bên trong `/slr review` sau xác nhận rõ ràng.

## 6. Xử lý lỗi

- `401`: token thiếu, sai, đã rotate hoặc bị disable. Không gửi token vào chat.
- `404`: task/paper không còn trong scope; tải lại danh sách.
- `202`: full text đang xử lý; chờ `retryAfterSeconds`, không poll liên tục.
- `409`: full text không khả dụng hoặc task đã hoàn tất. Không retry submit.
- `500/502`: lỗi backend/tài sản paper. Read có thể retry hữu hạn; write không tự retry.
- timeout/unreachable: kiểm tra base URL và tiến trình MCP local.

## 7. Kiểm tra local package

Từ thư mục `mcp/slr-agent-mcp`:

```powershell
npm install
npm run typecheck
npm test
npm run compile
npm pack --dry-run
```

Package hiện expose đúng bốn tool:

- `list_assigned_tasks`
- `get_assigned_task`
- `get_task_fulltext`
- `submit_review_result`
