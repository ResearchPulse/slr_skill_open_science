<div align="center">

# 📚 /slr — Systematic Literature Review Skill cho Open-Science

**Trợ lý sàng lọc tài liệu cho Open-Science (AIPOCH)**

Lấy task từ Agent Task API → đọc metadata & full text → chấm theo tiêu chí inclusion/exclusion →
soạn phiếu `INCLUDE` / `EXCLUDE` / `UNCERTAIN` có dẫn chứng → chỉ gửi khi nhà khoa học duyệt.

[![Node](https://img.shields.io/badge/node-%E2%89%A516.7-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-%E2%89%A53.8-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-6E56CF)](https://modelcontextprotocol.io)
[![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](#-cấu-trúc-repo)

```bash
npx github:ResearchPulse/slr_skill_open_science
```

*Một lệnh: cài skill + lưu URL/token + đăng ký & bật MCP connector `slr` trong Open-Science.*

</div>

---

## Project Leader consensus via MCP

When a project leader has a leader-scoped agent token, the `slr` connector can
compare the two submitted reviewer extractions against the active custom
template and the Cloudinary-backed full-text revision:

| MCP tool | Purpose |
| --- | --- |
| `list_consensus_tasks` | Discover leader tasks and show which R1/R2 submissions are still missing; task ids are handled internally. |
| `analyze_extraction_consensus` | Read R1/R2 submission readiness and render every field, value, evidence item, and check. |
| `save_extraction_consensus_draft` | Save the complete leader draft after both reviewers submit; conflicts remain visible and block official submission. |
| `submit_extraction_consensus` | Submit the conflict-free draft as the official project consensus. |

The workflow returns `WAITING_FOR_REVIEWERS` without writing when either
reviewer is missing. A substantive difference is returned as `CONFLICT` with
field-level reasons; the connector does not submit it. The challenge handshake
for both writes forwards the server-issued `payloadDigest` automatically.
Reviewer-scoped tokens cannot call these leader-only operations.

In Open-Science, use `/slr consensus` (the optional task id is only for an internally selected paper). The connector
automatically discovers the leader task after both reviewers submit. The response always renders
the full per-paper field/evidence/check tables; it does not hide the details
behind a follow-up request.

---

## 📑 Mục lục

- [Tính năng](#-tính-năng)
- [Yêu cầu](#-yêu-cầu)
- [Cài đặt](#-cài-đặt)
- [Trình cài đặt làm gì?](#️-trình-cài-đặt-làm-gì)
- [Kiến trúc](#-kiến-trúc)
- [Lệnh của trình cài đặt](#-lệnh-của-trình-cài-đặt)
- [Sử dụng trong Open-Science](#-sử-dụng-trong-open-science)
- [Xử lý sự cố](#-xử-lý-sự-cố)
- [Phát triển](#-phát-triển)
- [Cấu trúc repo](#-cấu-trúc-repo)

---

## ✨ Tính năng

- 🔎 **Sàng lọc** từng bài theo IC/EC trong `protocolSnapshot` của task, mỗi nhận định đều trích dẫn section của bài.
- ✍️ **Draft trước, gửi sau** — phiếu chỉ được gửi khi bạn đồng ý; có `audit.jsonl` làm nhật ký kiểm toán.
- 🔌 **Một MCP connector `slr`** — task (`connection_test`, `list_tasks`, `get_task`, `get_markdown`), draft (`save_draft`, `list_drafts`, `get_draft`), gửi (`submit_drafts`, `submit_result`), cấu hình (`config_show`, `config_set_url`, `config_set_token`, `config_use`). Agent không cần shell.
- 📊 **MCP dễ đọc** — phần text của kết quả MCP dùng Markdown table; `structuredContent` JSON vẫn giữ nguyên cho máy đọc.
- 💬 **Cấu hình ngay trong chat** — `/slr config token <TOKEN>` có hiệu lực tức thì, không cần reconnect connector.
- 🗂️ **Nhiều dự án** — mỗi dự án một profile, chuyển bằng `/slr config use`.
- 🪶 **Không phụ thuộc** — Python thư viện chuẩn, installer Node không cần `npm install`.

---

## 🧰 Yêu cầu

| Thành phần | Phiên bản | Ghi chú |
| --- | --- | --- |
| **Node.js** | ≥ 16.7 | chỉ để chạy lệnh cài đặt `npx` |
| **Python** | ≥ 3.8 | không cần `pip install` gì |
| **Open-Science** | bản có CLI `open-science` | bật trong app: **Settings → General → Command line tool → Install command** |
| **Agent token** | `slrp_…` | lấy trong **My AI review workspace** của đúng reviewer/project (agent "ChatGPT — Open-Science") |

> [!TIP]
> Sau khi cài CLI của Open-Science, mở **terminal mới** rồi kiểm tra `open-science --help`.
> Trên Windows, khi cài Python hãy tick **"Add python.exe to PATH"** (hoặc dùng `py` launcher có sẵn).

---

## 🚀 Cài đặt

### Cách 1 — `npx` (khuyên dùng)

```bash
npx github:ResearchPulse/slr_skill_open_science
```

Trình cài đặt hỏi 2 thông tin rồi tự làm phần còn lại:

1. **API base URL** — mặc định `https://slr-agent.hyperdatalab.org/api`
2. **Agent token** — nhập sẽ bị ẩn; Enter để bỏ qua và đặt sau bằng `/slr config token`

Sau đó, **trong Open-Science**:

1. **Settings → Skills → Add skill → Import installed skills** → chọn `slr` → **Import selected** (bật nếu đang tắt).
2. Mở **conversation mới** → gõ `/slr setup`.

### Cách 2 — Không tương tác (script / nhiều máy)

<details open>
<summary><b>Windows PowerShell</b></summary>

```powershell
npx github:ResearchPulse/slr_skill_open_science install --url https://slr-agent.hyperdatalab.org/api --token <AGENT_TOKEN> -y
```

</details>

<details>
<summary><b>macOS / Linux / Git Bash</b></summary>

```bash
npx github:ResearchPulse/slr_skill_open_science install \
  --url https://slr-agent.hyperdatalab.org/api \
  --token <AGENT_TOKEN> \
  -y
```

</details>

Cũng có thể dùng biến môi trường thay cho cờ: `SLR_API_URL`, `SLR_TOKEN`.

### 🔄 Cập nhật

Chạy lại lệnh cài đặt — skill và connector được cập nhật, **URL/token đã lưu được giữ nguyên**.
Sau đó import lại skill trong **Settings → Skills** để Open-Science dùng bản mới.

> [!NOTE]
> **Nâng cấp từ bản cũ (2 connector `slr-config` / `slr-default`)**: installer tự xoá các connector cũ
> và thay thư mục skill cũ. Credential `SLR_AGENT_TOKEN` cũ trong Settings → Credentials không còn
> được dùng — có thể xoá tay. Thư mục `~/.slr/` cũng không còn dùng.
> Token phải nhập lại một lần (`/slr config token`), vì bản cũ không lưu token ở dạng đọc được.

---

## ⚙️ Trình cài đặt làm gì?

| Bước | Chi tiết |
| --- | --- |
| **1. Python** | Tự tìm `py -3` / `python3` / `python` (≥ 3.8). Connector dùng **đường dẫn tuyệt đối** tới `python.exe` nên không phụ thuộc PATH của app. |
| **2. Skill** | Copy `SKILL.md` (tự chứa đủ lệnh + rubric) và `scripts/` (connector chạy từ đây) vào `~/.agents/skills/slr` — nơi Open-Science tìm khi bấm *Import installed skills*. |
| **3. Cấu hình** | `slr.py config set-url` + `config set-token --stdin` → lưu ở `~/.config/slr-open-science/` (token quyền 0600), rồi test kết nối. |
| **4. MCP** | Qua CLI `open-science`: tự khởi động daemon nếu chưa chạy (`start --no-open`), `connector add` (hoặc `update`) connector `slr` → `enable` → `test`. |

> [!NOTE]
> **Token không nằm trong cấu hình connector** — connector chỉ có `command` + `args`; mỗi lần gọi tool
> nó đọc profile đang active ở `~/.config/slr-open-science`. Thư mục này tách khỏi `~/.config/slr` của
> bộ Claude Science vì mỗi catalog agent có token riêng.

---

## 🧭 Kiến trúc

```text
Open-Science chat ── /slr skill (SKILL.md)
        │
        ├── MCP connector "slr" ── scripts/slr_mcp.py ── Agent Task API  /api/agent/v1/...
        │      (chạy trên host: luôn có mạng + profile thật)
        │      tasks · markdown · drafts · submit · config_*
        │
        └── ~/slr-paper-review/<profile>/  drafts · submitted · audit.jsonl   (do connector ghi)
```

**Khác với bộ Claude Science:** agent trong Open-Science **chỉ được nạp `SKILL.md`** — không được đọc file
khác hay chạy script trong thư mục skill. Vì vậy:

- `SKILL.md` **tự chứa** toàn bộ: lệnh, rubric sàng lọc, định dạng phiếu (không có `references/`).
- **Mọi thao tác đều là tool MCP**: API, cấu hình, và cả draft (`save_draft`, `list_drafts`, `get_draft`,
  `submit_drafts`). Connector chạy trên host nên luôn có mạng, profile thật và thư mục draft.
- `scripts/slr.py` vẫn dùng được từ terminal (`config`, `draft`, `drafts`, `diag`…) nhưng chat không cần đến.

Skill tuân theo [AI_AGENT_TASK_API_CONTRACT.md](AI_AGENT_TASK_API_CONTRACT.md): token gắn với agent +
project + reviewer workspace; danh sách task lấy qua cursor; mỗi task chấm theo `protocolSnapshot`.
Chỉ lấy Markdown khi task có `stage: FULL_TEXT` và có `markdownPath` (tool tự kiểm tra stage);
`202` tuân theo `Retry-After`; Markdown `PARTIAL` chưa dùng để review, cần đợi source revision `COMPLETED`. Round 1 dùng title, abstract và keywords nếu có; `keywords: null` không phải lý do loại bài. Kết quả agent
là **recommendation**, chỉ hoàn tất AI task — không tạo screening decision của reviewer.

---

## 🛠️ Lệnh của trình cài đặt

```text
npx github:ResearchPulse/slr_skill_open_science [lệnh] [tuỳ chọn]
```

| Lệnh | Mô tả |
| --- | --- |
| `install` *(mặc định)* | Cài / cập nhật skill, cấu hình URL + token, đăng ký connector |
| `mcp` | In command/arguments của connector (để thêm tay trong Settings → Connectors) |
| `doctor` | Kiểm tra Python, skill, CLI `open-science`, connector (`connector test`), bắt tay MCP, kết nối API |
| `uninstall` | Gỡ skill + connector (`--purge` xoá luôn URL/token đã lưu) |

| Tuỳ chọn | Ý nghĩa |
| --- | --- |
| `--url <url>` | API base URL (tự thêm `/api` nếu thiếu) |
| `--token <tok>` | Agent token của dự án |
| `--profile <p>` | Lưu vào profile riêng và đặt làm active — mỗi dự án một profile |
| `--target <dir>` | Thư mục skills (mặc định `~/.agents/skills`) |
| `--no-mcp` | Bỏ qua bước đăng ký connector |
| `--open-science <cmd>` | Đường dẫn CLI `open-science` (hoặc biến `OPEN_SCIENCE_CLI`) |
| `--python <cmd>` | Chỉ định trình thông dịch Python |
| `-y`, `--yes` | Không hỏi gì |

**Ví dụ**

```bash
# Thêm dự án thứ hai vào profile riêng
npx github:ResearchPulse/slr_skill_open_science --profile project-b --token <TOKEN> -y

# Gỡ hoàn toàn
npx github:ResearchPulse/slr_skill_open_science uninstall --purge
```

---

## 💬 Sử dụng trong Open-Science

| Lệnh | Tác dụng |
| --- | --- |
| `/slr setup` | Thiết lập có hướng dẫn (URL, token, test kết nối) |
| `/slr status` | Profile, dự án, số task được giao / đã xong, số draft |
| `/slr list` | Danh sách task |
| `/slr review [N \| id…]` | Soạn phiếu (chưa gửi) |
| `/slr drafts` | Bảng draft để duyệt |
| `/slr edit <id> <yêu cầu>` | Sửa một draft — vd. *"đổi sang UNCERTAIN, IC3 chưa rõ"* |
| `/slr submit [id…]` | Gửi phiếu đã duyệt qua MCP `submit_result` |
| `/slr auto [N]` | Soạn và gửi ngay (xác nhận một lần) |
| `/slr config …` | `show` · `url` · `token` · `use` · `test` |
| `/slr mcp` | Kiểm tra connector |
| `/slr diag` | Chẩn đoán (không lộ token) |
| `/slr help` | Bảng lệnh |

> [!WARNING]
> Phiếu đã gửi là **cuối cùng** — API từ chối gửi lại (409). Luôn xem `/slr drafts` trước khi `/slr submit`.
> Nên chọn permission mode **Ask for approval** để Open-Science hỏi trước mỗi lần gọi `submit_result`.

**Quy trình điển hình**

```text
/slr setup  →  /slr review 10  →  /slr drafts  →  /slr edit <id> …  →  /slr submit
```

Draft và nhật ký nằm trên máy trong `~/slr-paper-review/<profile>/` (hoặc `$REVIEW_WORKDIR`):
`drafts/` · `submitted/` · `audit.jsonl` — hãy giữ lại làm nhật ký kiểm toán.

---

## 🩺 Xử lý sự cố

Chạy trước tiên:

```bash
npx github:ResearchPulse/slr_skill_open_science doctor
```

| Triệu chứng | Cách xử lý |
| --- | --- |
| `open-science CLI not found` | Settings → General → Command line tool → Install command, mở terminal mới, chạy lại installer. Hoặc `--open-science <path>` / thêm tay bằng lệnh `mcp`. |
| `Open-Science is not running` | Installer tự chạy `open-science start --no-open`; nếu vẫn lỗi, mở app rồi chạy lại. |
| Chat không thấy tool `slr` | Mở **conversation mới**; kiểm tra Settings → Connectors → `slr` đang bật. |
| Không thấy lệnh `/slr` | Settings → Skills → Import installed skills → `slr` → Import selected, rồi bật. |
| `401` | Token sai/đã rotate, hoặc URL trỏ sai server (production: `https://slr-agent.hyperdatalab.org/api`) → `/slr config token <TOKEN>` |
| `NETWORK` | Backend chưa chạy hoặc sai URL/port (backend trong Docker → phải publish port) → `/slr config url …` |
| `Python 3.8+ not found` | Cài Python, mở terminal mới; hoặc `--python "C:\path\to\python.exe"` |

---

## 🧑‍💻 Phát triển

```bash
npm test          # = python -m unittest discover -s tests -v
```

`tests/test_slr.py` chạy `slr_mcp.py` thật qua stdio với một Agent Task API giả (cục bộ, không cần
mạng/token): phân trang cursor, chặn Markdown cho `TITLE_ABSTRACT`, `202` pending, gửi một lần rồi `409`,
validate body trước khi POST, bắt buộc `criteria`, phiếu định dạng Claude, draft qua MCP (lưu → bảng → gửi),
cấu hình trong chat không lộ token, chuyển profile tức thì, CLI draft.

Chạy connector trực tiếp:

```bash
python scripts/slr_mcp.py      # stdin/stdout JSON-RPC; log ra stderr
```

---

## 📁 Cấu trúc repo

```text
slr_skill_open_science/
├── SKILL.md                         # skill /slr — tự chứa: lệnh, rubric, định dạng phiếu
├── scripts/
│   ├── slr.py                       # CLI + API client + profile store (stdlib)
│   └── slr_mcp.py                   # MCP stdio server (connector "slr")
├── bin/
│   └── install.js                   # trình cài đặt (npx / npm bin), không dependency
├── tests/
│   └── test_slr.py                  # test end-to-end với API giả
├── AI_AGENT_TASK_API_CONTRACT.md    # contract của backend
├── package.json
└── README.md
```

<div align="center">
<sub>Made for <b>ResearchPulse</b> · Phát hiện lỗi? <a href="https://github.com/ResearchPulse/slr_skill_open_science/issues">Mở issue</a></sub>
</div>
