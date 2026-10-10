# SLR MCP với Open-Science

Tài liệu này hướng dẫn kết nối một project SLR với Open-Science thông qua MCP local. MCP server chỉ dùng token của một project và agent đã được cấp quyền.

## 1. Chuẩn bị trong SLR

1. Mở project SLR và vào **Settings → AI Agents**.
2. Chọn **ChatGPT — Open-Science**.
3. Bấm **Connect and generate project token**.
4. Tạo một Credential dạng token trong Open-Science và bind nó cho `SLR_AGENT_TOKEN` của connector; không dán token vào chat hoặc file cấu hình.
5. Chọn paper và bấm **Assign to ChatGPT**.

Token này chỉ có scope trên agent/project đó. Không dán token vào chat, skill, source code, issue, screenshot hoặc log. Nếu token đã bị lộ, dùng **Rotate** trong SLR rồi cập nhật connector local.

## 2. Cài root package và kiểm tra

Release root package được gọi bằng GitHub reference cố định:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

`setup` có thể tạo/kiểm tra profile metadata và in connector config không có secret. Token không bao giờ được nhập qua command argument hay ghi vào profile store. Có thể dùng `--json` để lấy output máy đọc:

```powershell
npx github:ResearchPulse/slr_skill_open_science --json
```

`setup` đồng thời copy thư mục skill được quản lý vào `~/.agents/skills/slr`. Trong Open-Science, vào **Settings → Skills → Import installed skills**, import thư mục đã cài đặt này rồi bật skill `/slr`. Có thể dùng `--skill-dir PATH` nếu muốn đặt skill ở thư mục local khác. Nếu thư mục đích đã có skill không do package quản lý, lệnh sẽ dừng để tránh ghi đè.

Sau khi bật skill, dùng `/slr setup` như lệnh setup nhanh trong chat. Skill sẽ gọi yêu cầu chỉ đọc `list_assigned_tasks(limit: 1)` để kiểm tra connector. Nếu thành công, skill báo project và trạng thái task; nếu thất bại, skill chỉ hướng dẫn phần connector còn thiếu. Skill không tự thay đổi Settings của Open-Science và không yêu cầu dán token vào chat.

Không gửi `SLR_AGENT_TOKEN` vào chat. Hãy dán token một lần vào **Settings → Connectors → SLR → Environment variables → SLR_AGENT_TOKEN → Access token Credential**. Nếu token đã lỡ xuất hiện trong chat, hãy rotate token trong SLR rồi cập nhật Credential mới.

Dùng `doctor` để kiểm tra asset đã được đóng gói và khả năng có `open-science` CLI:

```powershell
npx github:ResearchPulse/slr_skill_open_science doctor
```

`doctor` luôn in report dạng JSON. Lệnh trả về non-zero nếu thiếu asset của package; việc không tìm thấy `open-science` CLI chỉ được ghi nhận trong report, không tự nó làm package check thất bại. Cả `setup` và `doctor` đều không yêu cầu hoặc in project token.

Tạo profile metadata (không cần dán token vào terminal):

```powershell
npx github:ResearchPulse/slr_skill_open_science profile create `
  --name afl-review `
  --api-base-url https://<backend-host>/api `
  --project-id <project-id> `
  --project-name "AFL review" `
  --credential-id <open-science-credential-id>
```

Khởi tạo workspace và in connector config:

```powershell
npx github:ResearchPulse/slr_skill_open_science workspace init --profile afl-review
npx github:ResearchPulse/slr_skill_open_science config --profile afl-review
```

Output `config` không chứa project token; nó gồm command/args, `SLR_API_BASE_URL`, profile/project metadata và credential binding ID. Import JSON này vào Open-Science Connector, bind credential cho `SLR_AGENT_TOKEN`, sau đó enable `/slr` skill.

Nếu `open-science` CLI đã được cài và credential ID đã tồn tại, có thể đăng ký connector tự động:

```powershell
npx github:ResearchPulse/slr_skill_open_science setup `
  --profile afl-review `
  --register
```

Nếu registration không khả dụng, dùng lệnh pinned sau để in JSON và import thủ công:

```powershell
npx github:ResearchPulse/slr_skill_open_science config --profile afl-review
```

Lệnh không bao giờ nhận project token qua argument.

## 3. Cấu hình MCP local

Khi cấu hình connector cho bản phát hành, dùng root package và flag `--mcp`:

```text
Command: npx
Arguments: --yes github:ResearchPulse/slr_skill_open_science --mcp
```

Lệnh tương đương:

```powershell
npx github:ResearchPulse/slr_skill_open_science --mcp
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
--yes github:ResearchPulse/slr_skill_open_science --mcp
```

Đặt hai environment variables ở phần connector configuration, không đặt trong nội dung hội thoại. MCP giao tiếp qua stdio; stdout dành cho JSON-RPC, log chẩn đoán đi qua stderr.

## 4. Quyền xác nhận

Chọn permission mode **Ask for approval** trong Open-Science.

`submit_review_result` là write tool. Luồng ghi có đúng hai bước xác nhận độc lập:

1. Skill `/slr review` lưu draft, hiển thị decision, reasoning và data cuối cùng rồi hỏi `confirm` hoặc `cancel`. Chỉ câu trả lời `confirm` mới được gọi write tool.
2. Lần gọi write đầu tiên chỉ tạo yêu cầu xác nhận và trả payload digest; không gửi request ghi. Sau khi người dùng xác nhận digest, skill gọi lại chính `submit_review_result` với `confirmation: { confirm: true, digest }`. Chỉ sau đó server mới gửi đúng một POST đến backend.

Permission mode của host không thay thế hai bước trên. Nếu một bước bị từ chối hoặc digest không khớp thì không có request ghi nào được gửi. Cơ chế này không phụ thuộc vào MCP elicitation nên tương thích với Open-Science hiện tại.

Nếu người dùng không xác nhận lượt thứ hai, dừng ở draft; không retry và không gửi POST.

## 5. Dùng skill `/slr`

```text
/slr
/slr status
/slr tasks
/slr list
/slr task <taskId>
/slr fulltext <taskId>
/slr review next
/slr review <taskId>
/slr drafts
/slr config
/slr help
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

Package hiện expose đúng bốn tool, không có health/config/helper tool bổ sung:

- `list_assigned_tasks`
- `get_assigned_task`
- `get_task_fulltext`
- `submit_review_result`
