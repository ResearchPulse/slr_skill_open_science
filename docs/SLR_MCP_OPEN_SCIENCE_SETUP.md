# SLR MCP với Open-Science

Tài liệu này hướng dẫn kết nối một project SLR với Open-Science thông qua MCP local. MCP server chỉ dùng token của một project và agent đã được cấp quyền.

## 1. Chuẩn bị trong SLR

1. Mở project SLR và vào **Settings → AI Agents**.
2. Chọn **ChatGPT — Open-Science**.
3. Bấm **Connect and generate project token**.
4. Giữ project token để nhập một lần vào trường Credential `SLR_AGENT_TOKEN` của Open-Science; không dán token vào chat hoặc file cấu hình. Open-Science Credential là nơi lưu token duy nhất.
5. Chọn paper và bấm **Assign to ChatGPT**.

Token này chỉ có scope trên agent/project đó. Không dán token vào chat, skill, source code, issue, screenshot hoặc log. Nếu token đã bị lộ, dùng **Rotate** trong SLR rồi cập nhật connector local.

## 2. Cài root package và kiểm tra

Release root package được gọi bằng GitHub reference cố định:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

## Quick setup behavior

Current connector model:

- `slr-agent-mcp` is the review connector and exposes the five Claude-compatible business tools, including bounded `connection_test`.
- `slr-config-mcp` is a separate local connector used only by `/slr config`.
- The config connector reads `SLR_AGENT_TOKEN` from an encrypted Open-Science Access token Credential. Only the explicit `/slr config token <TOKEN>` operation accepts a token argument; it validates and binds it immediately and never returns it.

The installer registers both connectors automatically. Before registration it stages a dependency-complete runtime under `~/.slr/runtimes/<fingerprint>` and uses a direct Node launcher. This avoids running `npx` for every long-lived connector process and prevents Windows `EBUSY` errors from npm renaming a locked `_npx` package. If registration or credential binding fails, setup exits non-zero and the connectors must be reconnected after the failure is fixed; there is no manual-import fallback.

```text
Command: <Node executable>
Arguments: <managed runtime>/bin/install.js --config-mcp
Credential binding: SLR_AGENT_TOKEN
```

The no-argument command is the fast path. It detects Node, installs the `/slr` skill, uses `https://slr-api.hyperdatalab.org/api` by default, asks only for the project token through hidden terminal input, binds the encrypted `SLR_AGENT_TOKEN` Credential, tests `GET /agent/v1/tasks?limit=1`, and creates or updates then enables both Open-Science connectors. If the CLI is installed but the daemon is stopped, setup starts it with `open-science start --no-open` and waits briefly for readiness; the desktop window does not need to be opened manually. On Windows, setup also checks common per-user install locations and `OPEN_SCIENCE_CLI` when the command is not on `PATH`. Human output is intentionally concise; use `--json` for the full report. Use `--api-base-url` only when targeting another server. The token is never printed, written to profile metadata, connector JSON, drafts, audit records, or chat.

Use `--json` for a non-interactive report. If automatic registration or credential binding is unavailable, setup reports the failure and exits non-zero. After both connectors and the skill are available, open a new Open-Science conversation and run `/slr setup`; that chat command performs the read-only check and does not collect credentials.

`setup` hỏi token bằng terminal input ẩn để tạo Credential host-managed, chỉ lưu profile metadata không chứa bí mật và test API. Token không ghi vào profile metadata, không in ra output và không đi vào connector JSON. Dùng `--json` để chạy non-interactive; chế độ này không hỏi token:

```powershell
npx github:ResearchPulse/slr_skill_open_science --json
```

`setup` đồng thời copy thư mục skill được quản lý vào `~/.agents/skills/slr`. Trong Open-Science, vào **Settings → Skills → Import installed skills**, import thư mục đã cài đặt này rồi bật skill `/slr`. Có thể dùng `--skill-dir PATH` nếu muốn đặt skill ở thư mục local khác. Nếu thư mục đích đã có skill không do package quản lý, lệnh sẽ dừng để tránh ghi đè.

Sau khi bật skill, dùng `/slr setup` như lệnh setup nhanh trong chat. Skill sẽ gọi yêu cầu chỉ đọc `list_assigned_tasks(limit: 1)` để kiểm tra connector. Nếu thành công, skill báo project và trạng thái task; nếu thất bại, skill chỉ hướng dẫn phần connector còn thiếu. Skill không tự thay đổi Settings của Open-Science và không yêu cầu dán token vào chat.

Không gửi `SLR_AGENT_TOKEN` vào chat. Quick setup nhập token một lần vào Credential host-managed, không lưu token trong profile local và không đặt raw token vào connector JSON. Nếu token đã lỡ xuất hiện trong chat, hãy rotate token trong SLR rồi cập nhật Credential mới.

Dùng `doctor` để kiểm tra asset đã được đóng gói và khả năng có `open-science` CLI:

```powershell
npx github:ResearchPulse/slr_skill_open_science doctor
```

`doctor` luôn in report dạng JSON. Lệnh trả về non-zero nếu thiếu asset của package; việc không tìm thấy `open-science` CLI chỉ được ghi nhận trong report, không tự nó làm package check thất bại. Cả `setup` và `doctor` đều không yêu cầu hoặc in project token.

Tạo profile metadata (không cần dán token vào terminal):

```powershell
npx github:ResearchPulse/slr_skill_open_science profile create `
  --name afl-review `
  --api-base-url https://slr-api.hyperdatalab.org/api `
  --project-id <project-id> `
  --project-name "AFL review" `
  --credential-id <open-science-credential-id>
```

Khởi tạo workspace cho profile metadata:

```powershell
npx github:ResearchPulse/slr_skill_open_science workspace init --profile afl-review
```

Profile metadata không chứa project token. Không có JSON connector để import thủ công; `SLR_AGENT_TOKEN` được bind tự động cho cả hai connector bởi setup.

Setup luôn cố gắng đăng ký và enable cả hai connector; Credential `SLR_AGENT_TOKEN` là bắt buộc:

```powershell
npx github:ResearchPulse/slr_skill_open_science setup `
  --profile afl-review
```

Automatic registration and enabling require a compatible `open-science` CLI; setup starts its daemon when necessary. The `SLR_AGENT_TOKEN` Credential is mandatory. If the CLI or daemon is missing, setup fails closed and asks the user to repair/reconnect Open-Science before retrying.

Nếu registration hoặc credential binding không khả dụng, setup dừng với mã lỗi. Hãy sửa/reconnect Open-Science, mở conversation mới rồi chạy lại; không có đường dẫn import thủ công hoặc terminal fallback.

## 3. Cấu hình MCP local

Khi cấu hình connector cho bản phát hành, dùng root package và flag `--mcp`:

```text
Command: <Node executable>
Arguments: <managed runtime>/bin/install.js --mcp --profile <profile-name>
```

Lệnh tương đương:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

The `npx` command is the one-time installer/update entrypoint. The production connector uses the managed runtime path generated by setup, with an explicit `--profile <name>` and the host-managed `SLR_AGENT_TOKEN` credential.

Root entrypoint chuyển tiếp stdio tới MCP server đã compile mà không gọi shell. stdout dành cho JSON-RPC; log chẩn đoán đi qua stderr.

MCP package nằm ở `mcp/slr-agent-mcp`; có thể chạy trực tiếp bằng `npx slr-agent-mcp` khi phát triển local.

Environment cần có:

```text
SLR_API_BASE_URL=https://slr-api.hyperdatalab.org/api
SLR_AGENT_TOKEN=<project-scoped-token>
```

Ví dụ PowerShell khi chạy bản local:

```powershell
$env:SLR_API_BASE_URL = "http://localhost:<backend-port>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The environment example above is for direct MCP development. The production root connector loads the API URL from the selected secret-free profile and requires `SLR_AGENT_TOKEN` in the connector environment from the host credential binding.

Chỉ dùng `http://` cho loopback local. Với backend thật, dùng HTTPS.

Trong Open-Science, tạo local MCP connector với command tương đương:

```text
npx
```

Arguments:

```text
--yes github:ResearchPulse/slr_skill_open_science --mcp --profile <profile-name>
```

Connector production nên truyền `--profile <name>` cùng root package. Launcher đọc API URL từ profile metadata và nhận token qua host Credential `SLR_AGENT_TOKEN`; raw token không nằm trong connector JSON hay nội dung hội thoại. MCP giao tiếp qua stdio; stdout dành cho JSON-RPC, log chẩn đoán đi qua stderr.

## 4. Quyền xác nhận

Chọn permission mode **Ask for approval** trong Open-Science.

`submit_review_result` là write tool. Luồng ghi có một lần xác nhận người dùng và hai call MCP nội bộ:

1. Skill `/slr review` lưu draft, hiển thị decision, reasoning, data và hỏi người dùng `confirm` hoặc `cancel` đúng một lần.
2. Nếu `confirm`, skill gọi `submit_review_result` với payload chính xác. Nếu call đầu trả về `CONFIRMATION_REQUIRED` và digest, skill tự gọi lại chính tool với payload không đổi và `confirmation: { confirm: true, digest }`. Chỉ sau đó server mới gửi đúng một POST đến backend.

Permission mode của host không thay thế digest safety. Nếu người dùng hủy, call đầu bị từ chối hoặc digest không khớp thì không có request ghi nào được gửi. Skill tự xử lý call digest sau một lần xác nhận, nên Open-Science không hiển thị thêm prompt xác nhận thứ hai.

Nếu người dùng trả lời `cancel`, dừng ở draft; không retry và không gửi POST.

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

Skill bắt buộc hiển thị block `Suggested next actions` sau mọi lệnh thành công, đặc biệt sau `/slr tasks`, `/slr task`, `/slr review` và sau submit/cancel. Gợi ý sẽ phù hợp với trạng thái task: có task thì gợi ý xem task/review, không có task thì gợi ý assign paper, full text đang xử lý thì chờ retry, còn full text không có thì upload PDF trên web app. Khi draft đã sẵn sàng, chỉ còn một lần hỏi `confirm` hoặc `cancel`; digest call được xử lý tự động.

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

Package hiện expose năm tool review tương thích Claude, trong đó `connection_test` chỉ thực hiện một read-only check có giới hạn:

- `list_assigned_tasks`
- `connection_test`
- `get_assigned_task`
- `get_task_fulltext`
- `submit_review_result`

## In-chat profile configuration

The in-chat flow uses the separate `slr-config` connector. Plain `/slr config` calls `slr_config_profiles`, asks the user to choose/create a profile, then uses the credential-bound `slr_config_validate` and `slr_config_commit` flow. The quick path `/slr config token <TOKEN>` calls `slr_config_token`, validates before mutation, binds the encrypted `SLR_AGENT_TOKEN` credential, and updates/enables both connectors automatically. The token is never echoed or returned. If the config connector is unavailable, the operation stops and must not claim that local configuration changed.

Use `/slr config` when the local project profile needs to change, or use `/slr config token <TOKEN>` for the quick token path. An exact token match switches, a matching project ID updates, and otherwise the token is saved to the selected profile. The raw token is never displayed, returned by MCP, or written to connector JSON.

After the single save/switch/update confirmation, the config connector updates the secret-free connector configuration and enables both local connectors. Reconnect the connectors and run `/slr status`. If either connector cannot be enabled, the commit rolls back and `/slr config` reports failure; it never falls back to a terminal package command or claims success without the connector commit.
