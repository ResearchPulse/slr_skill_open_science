# Open-Science MCP vs Claude SLR package

Reference compared: [ResearchPulse/slr_skill_claude_science](https://github.com/ResearchPulse/slr_skill_claude_science), commit `41c8aec7f4986af38525ed33a534d02c4072552f`.

| Area | `slr_skill_open_science` | Claude package |
| --- | --- | --- |
| Host | Open-Science | Claude Code, Claude Science, Claude Desktop |
| Repository shape | Separate TypeScript MCP package and `/slr` skill | One package containing skill, Python CLI, Python MCP server, installer, and references |
| Runtime | Node.js 20+, official TypeScript MCP SDK | Node installer plus Python 3.8+ stdlib runtime |
| MCP tools | Exactly 4 contract tools: `list_assigned_tasks`, `get_assigned_task`, `get_task_fulltext`, `submit_review_result` | 5 tools: `list_tasks`, `get_task`, `get_markdown`, `submit_result`, `connection_test` |
| Reads | MCP tools | Direct Python API client, with MCP fallback for sandbox/network limitations |
| Drafts/audit | Draft is held in the conversation/skill flow | Local `paper-review/` drafts, submitted records, and `audit.jsonl` |
| Token storage | Connector environment variables; never request the token in chat | Local `~/.config/slr` profiles; the skill permits token entry in chat and masks output |
| Confirmation | Skill confirmation plus digest-bound second MCP call immediately before the POST | Skill-level approval before calling `submit_result` |
| Installation | Configure the local MCP connector with `npx slr-agent-mcp` after publishing | `npx github:ResearchPulse/slr_skill_claude_science` runs an installer and edits Claude integrations |

## Decision

The Claude package is a broader host-integration product. Its installer and local workflow are useful references, but copying it would introduce Python, local profile storage, extra tools, and behavior outside the SLR API contract. The Open-Science implementation intentionally keeps the MCP server thin, uses the host connector for configuration, exposes only the four backend operations, and enforces the final write confirmation in the server.
