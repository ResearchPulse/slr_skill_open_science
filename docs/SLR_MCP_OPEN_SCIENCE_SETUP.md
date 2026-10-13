# SLR MCP với Open-Science

Tài liệu này hướng dẫn kết nối một project SLR với Open-Science thông qua MCP local. MCP server chỉ dùng token của một project và agent đã được cấp quyền.

## 1. Chuẩn bị trong SLR

1. Mở project SLR và vào **Settings → AI Agents**.
2. Chọn **ChatGPT — Open-Science**.
3. Bấm **Connect and generate project token**.
4. Dùng project token được cấp cho agent/project này. Đây là token duy nhất API dùng để nhận diện đúng agent và project, đồng thời xác định task được phép truy cập. Open-Science Credential `SLR_AGENT_TOKEN` chỉ là nơi lưu và cấp cùng token đó cho MCP.
5. Chọn paper và bấm **Assign to ChatGPT**.

Token này gắn với agent/project. Có thể cấu hình trực tiếp trong chat bằng `/slr config token <TOKEN>`. Không ghi token vào skill, source code, issue, screenshot hoặc log.

## 2. Cài root package và cấu hình project

Trên Windows, cài launcher CLI trong ứng dụng Open-Science trước: **Settings → General → Command line tool → Install command**. Mở PowerShell mới rồi xác nhận lệnh hoạt động:

```powershell
Get-Command open-science | Select-Object Name, Source
open-science --help
```

Nếu lệnh vẫn chưa được nhận diện, xem đường dẫn launcher hiển thị trong Settings và đặt `OPEN_SCIENCE_CLI` tới file `open-science.cmd` trước khi chạy installer.

Release root package được gọi bằng GitHub reference cố định:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

## Quick setup behavior

Current connector model:

- `slr-agent-mcp` is the review connector and exposes the five Claude-compatible business tools, including bounded `connection_test`.
- `slr-config-mcp` is a separate local connector used only by `/slr config`.
- Interactive installation optionally prompts for the project token with hidden input; Enter skips it. The same token identifies the agent/project to the SLR API. Open-Science's encrypted Credential is only the host storage/binding for that value, not another token.

The installer stages a dependency-complete runtime under `~/.slr/runtimes/<fingerprint>` and registers the config connector. In an interactive terminal, it asks for the project token if the selected profile has none; pressing Enter skips token setup. A supplied token is checked against the SLR API first, which returns the agent/project identity, then bound as the host-managed `SLR_AGENT_TOKEN` Credential and used to register/enable both connectors. The same configuration can be done later with `/slr config token <TOKEN>`. There is no manual-import fallback.

```text
Command: <Node executable>
Arguments: <managed runtime>/bin/install.js --config-mcp
Initial install without a token: config connector only. Supplying the project token or running `/slr config token` binds that same token and enables the review connector.
```

The no-argument command is the fast path. It detects Node, installs the `/slr` skill, uses `https://slr-api.hyperdatalab.org/api` by default, creates local profile metadata and registers the config connector. In an interactive terminal it asks for the project token if one is not already bound; Enter skips this so the token can be configured later. A supplied token is validated before it is stored by Open-Science and used to enable the review connector. If the CLI is installed but the daemon is stopped, setup starts it with `open-science start --no-open` and waits briefly for readiness; the desktop window does not need to be opened manually. On Windows, setup also checks common per-user install locations and `OPEN_SCIENCE_CLI` when the command is not on `PATH`. Human output is intentionally concise; use `--json` for the full report. Use `--api-base-url` only when targeting another server.

Use `--json` for a non-interactive report. If automatic config-connector registration is unavailable, setup reports the failure and exits non-zero. After the skill and config connector are available, open a new Open-Science conversation and run `/slr config token <TOKEN>` for the project you want to use. When it succeeds, open a new conversation and run `/slr setup` to perform the read-only connection check.

`setup` ở terminal tương tác sẽ hỏi project token nếu profile chưa có token; nhấn Enter để cấu hình sau bằng `/slr config token <TOKEN>`. Token được kiểm tra với API trước khi Open-Science lưu và cấp nó cho connector. Cùng một token nhận diện agent/project; Credential chỉ là nơi lưu trữ của Open-Science. Dùng `--json` để in báo cáo máy đọc được; chế độ này không hỏi token:

```powershell
npx github:ResearchPulse/slr_skill_open_science --json
```

`setup` đồng thời copy thư mục skill được quản lý vào `~/.agents/skills/slr`. Đây mới là bản local để Open-Science import. Trong ứng dụng, vào **Settings → Skills → Add skill → Import installed skills**, chọn `slr`, bấm **Import selected**, sau đó tìm skill đã import và bật nếu đang tắt. Open-Science dùng bản import; chỉ chép file vào `~/.agents/skills/slr` chưa làm skill khả dụng trong chat. Có thể dùng `--skill-dir PATH` nếu muốn đặt skill ở thư mục local khác. Nếu thư mục đích đã có skill không do package quản lý, lệnh sẽ dừng để tránh ghi đè.

Sau khi bật skill, mở conversation mới và cấu hình project bằng `/slr config token <TOKEN>`. Lệnh này dùng connector `slr-config` đã được cài tự động; không cần cấu hình token ở bước cài package. Sau khi connector báo cần kết nối lại, mở conversation mới rồi chạy `/slr setup` để kiểm tra read-only. Skill không tự thay đổi Settings của Open-Science.

Token có thể được nhập ẩn ở bước cài đặt tương tác hoặc cấu hình sau bằng `/slr config token <TOKEN>`. Cả hai đường đều kiểm tra project token với API trước khi thay đổi profile, rồi lưu/cấp chính token đó qua Open-Science Credential `SLR_AGENT_TOKEN`. Mỗi profile/project có token và Credential riêng; Credential là cách Open-Science lưu token, không phải token thứ hai. Token thô không được ghi vào profile metadata hoặc connector JSON.

Dùng `doctor` để kiểm tra asset đã được đóng gói và khả năng có `open-science` CLI:

```powershell
npx github:ResearchPulse/slr_skill_open_science doctor
```

`doctor` luôn in report dạng JSON. Lệnh trả về non-zero nếu thiếu asset của package; việc không tìm thấy `open-science` CLI chỉ được ghi nhận trong report, không tự nó làm package check thất bại. `doctor` không yêu cầu hoặc in project token; `setup --json` cũng không hỏi token.

Tạo profile metadata (không cần dán token vào terminal):

```powershell
npx github:ResearchPulse/slr_skill_open_science profile create `
  --name afl-review `
  --api-base-url https://slr-api.hyperdatalab.org/api `
  --project-id <project-id> `
  --project-name "AFL review"
```

Khởi tạo workspace cho profile metadata:

```powershell
npx github:ResearchPulse/slr_skill_open_science workspace init --profile afl-review
```

Profile metadata không chứa project token. Không có JSON connector để import thủ công. Lệnh setup đăng ký connector cấu hình; khi token được nhập lúc cài hoặc cấu hình sau trong chat, installer/config MCP xác thực và bind cùng project token vào `SLR_AGENT_TOKEN`, rồi đăng ký cả hai connector.

Có thể tạo profile metadata riêng trước khi kết nối project:

```powershell
npx github:ResearchPulse/slr_skill_open_science setup `
  --profile afl-review
```

Automatic registration requires a compatible `open-science` CLI; setup starts its daemon when necessary. Với terminal tương tác, nhập project token khi được hỏi hoặc nhấn Enter để bỏ qua. Có thể cấu hình token sau bằng `/slr config token <TOKEN>`; hai cách đều dùng một project token và tự bật review connector.

Nếu đăng ký `slr-config` không khả dụng, setup dừng với mã lỗi. Hãy sửa/reconnect Open-Science rồi chạy lại; không có đường dẫn import thủ công hoặc terminal fallback.

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

- `401`: API từ chối project token. Production dùng `https://slr-api.hyperdatalab.org/api`; lấy token `slrp_...` hiện tại từ đúng reviewer/project workspace. Rotate token, disable kết nối hoặc đổi agent sẽ làm token cũ mất hiệu lực. Nếu đúng endpoint và token hiện tại vẫn lỗi, nhờ SLR admin kiểm tra agent connection.
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

The in-chat flow uses the separate `slr-config` connector. Plain `/slr config` calls `slr_config_profiles`, asks the user to choose/create a profile, then uses the credential-bound `slr_config_validate` and `slr_config_commit` flow. The quick path `/slr config token <TOKEN>` accepts the token in chat, calls `slr_config_token`, validates before mutation, binds the Open-Science `SLR_AGENT_TOKEN` credential, and updates/enables both connectors automatically. The token is not unnecessarily repeated in the response. When validation returns `ok: false`, show the safe HTTP status, error code, and API message from its `connection` object. When connector registration fails, show its registration code and reason. If the config connector is unavailable, the operation stops and must not claim that local configuration changed.

Use `/slr config` when the local project profile needs to change, or paste the token with `/slr config token <TOKEN>` for the quick path. An exact token match switches, a matching project ID updates, and otherwise the token is saved to the selected profile. The token is passed to the config tool for validation and is not written to profile metadata or connector JSON.

After the single save/switch/update confirmation, the config connector updates the secret-free connector configuration and enables both local connectors. Reconnect the connectors and run `/slr status`. If either connector cannot be enabled, the commit rolls back and `/slr config` reports failure; it never falls back to a terminal package command or claims success without the connector commit.
