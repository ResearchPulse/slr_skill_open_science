# SLR MCP với Open-Science

Tài liệu này hướng dẫn kết nối một project SLR với Open-Science thông qua MCP local. MCP server chỉ dùng token của một project và agent đã được cấp quyền.

## 1. Chuẩn bị trong SLR

1. Mở project SLR và vào **Settings → AI Agents**.
2. Chọn **ChatGPT — Open-Science**.
3. Bấm **Connect and generate project token**.
4. Giữ project token để nhập một lần trong terminal quick setup; không dán token vào chat hoặc file cấu hình. Credential của Open-Science chỉ cần nếu muốn host quản lý token thay cho profile local.
5. Chọn paper và bấm **Assign to ChatGPT**.

Token này chỉ có scope trên agent/project đó. Không dán token vào chat, skill, source code, issue, screenshot hoặc log. Nếu token đã bị lộ, dùng **Rotate** trong SLR rồi cập nhật connector local.

## 2. Cài root package và kiểm tra

Release root package được gọi bằng GitHub reference cố định:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

## Quick setup behavior

The no-argument command is the fast path. It detects Node, installs the `/slr` skill, uses `https://slr-api.hyperdatalab.org/api` by default, asks only for the project token through hidden terminal input, saves the token in the selected local profile, tests `GET /agent/v1/tasks?limit=1`, and attempts to register the Open-Science connector. Use `--api-base-url` only when targeting another server. The token is never printed, written to profile metadata, generated connector JSON, drafts, audit records, or chat.

Use `--json` for a non-interactive report. If automatic registration is unavailable, import the generated connector configuration manually. The connector arguments include `--profile <name>`, so the root `--mcp` launcher can load the matching protected local token. After the connector and skill are available, run `/slr setup` in Open-Science; that chat command performs the read-only check and does not collect credentials.

`setup` có thể tạo/kiểm tra profile metadata, hỏi token bằng terminal input ẩn và test API. Token không ghi vào profile metadata, không in ra output và không đi vào connector JSON. Dùng `--json` để chạy non-interactive; chế độ này không hỏi token:

```powershell
npx github:ResearchPulse/slr_skill_open_science --json
```

`setup` đồng thời copy thư mục skill được quản lý vào `~/.agents/skills/slr`. Trong Open-Science, vào **Settings → Skills → Import installed skills**, import thư mục đã cài đặt này rồi bật skill `/slr`. Có thể dùng `--skill-dir PATH` nếu muốn đặt skill ở thư mục local khác. Nếu thư mục đích đã có skill không do package quản lý, lệnh sẽ dừng để tránh ghi đè.

Sau khi bật skill, dùng `/slr setup` như lệnh setup nhanh trong chat. Skill sẽ gọi yêu cầu chỉ đọc `list_assigned_tasks(limit: 1)` để kiểm tra connector. Nếu thành công, skill báo project và trạng thái task; nếu thất bại, skill chỉ hướng dẫn phần connector còn thiếu. Skill không tự thay đổi Settings của Open-Science và không yêu cầu dán token vào chat.

Không gửi `SLR_AGENT_TOKEN` vào chat. Với quick setup, token được nhập một lần trong terminal khi chạy `npx` và lưu ở profile local được bảo vệ. Connector có thể dùng Credential host-managed làm override nếu cần; không đặt raw token vào connector JSON. Nếu token đã lỡ xuất hiện trong chat, hãy rotate token trong SLR rồi cập nhật profile/credential mới.

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

Output `config` không chứa project token; nó gồm command/args với `--profile`, `SLR_API_BASE_URL` và profile/project metadata. Import JSON này vào Open-Science Connector, sau đó enable `/slr` skill. Launcher sẽ đọc token từ profile local; Credential cho `SLR_AGENT_TOKEN` chỉ là override tùy chọn.

Nếu `open-science` CLI đã được cài, có thể đăng ký connector tự động; credential ID chỉ là tùy chọn override:

```powershell
npx github:ResearchPulse/slr_skill_open_science setup `
  --profile afl-review `
  --register
```

Automatic registration only requires a compatible `open-science` CLI. A Credential ID is optional; it is used only when the host should override the token loaded from the local profile.

Nếu registration không khả dụng, dùng lệnh pinned sau để in JSON và import thủ công:

```powershell
npx github:ResearchPulse/slr_skill_open_science config --profile afl-review
```

Lệnh không bao giờ nhận project token qua argument.

## 3. Cấu hình MCP local

Khi cấu hình connector cho bản phát hành, dùng root package và flag `--mcp`:

```text
Command: npx
Arguments: --yes github:ResearchPulse/slr_skill_open_science --mcp --profile <profile-name>
```

Lệnh tương đương:

```powershell
npx github:ResearchPulse/slr_skill_open_science --mcp --profile <profile-name>
```

This uses the selected profile. The bare `--mcp` form is an active-profile fallback only when one is already configured.

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

The environment example above is for direct MCP development. The production root connector loads the API URL and token from the selected local profile and does not require `SLR_AGENT_TOKEN` in connector environment.

Chỉ dùng `http://` cho loopback local. Với backend thật, dùng HTTPS.

Trong Open-Science, tạo local MCP connector với command tương đương:

```text
npx
```

Arguments:

```text
--yes github:ResearchPulse/slr_skill_open_science --mcp --profile <profile-name>
```

Connector production nên truyền `--profile <name>` cùng root package. Launcher sẽ đọc API URL và token từ profile local; environment override vẫn được hỗ trợ nhưng raw token không nằm trong connector JSON hay nội dung hội thoại. MCP giao tiếp qua stdio; stdout dành cho JSON-RPC, log chẩn đoán đi qua stderr.

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
