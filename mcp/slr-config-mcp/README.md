# SLR configuration MCP

This is a separate local MCP server for `/slr config`. It manages the local
profile store and connector registration without adding configuration tools to
the SLR screening/extraction MCP.

The installer can register this connector before a project token exists.
`/slr config url <URL>` saves an approved API URL to the active profile without
accessing connector credentials. `/slr config token <TOKEN>` accepts the token
in chat, validates it, then automatically saves it to the host-managed encrypted
`SLR_AGENT_TOKEN` Credential and updates/enables the project review connector.
The token is never printed or written to profile metadata or connector JSON.
