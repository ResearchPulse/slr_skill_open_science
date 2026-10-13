# SLR configuration MCP

This is a separate local MCP server for `/slr config`. It manages the local
profile store and connector registration without adding configuration tools to
the five-tool SLR review MCP.

The installer can register this connector before a project token exists. It
does not need a Credential binding to handle `/slr config token <TOKEN>`. That
explicit operation validates the token, saves it to the host-managed encrypted
`SLR_AGENT_TOKEN` Credential, and updates/enables the project review connector.
For later profile changes, the server can read `SLR_AGENT_TOKEN` from its host
credential binding. The token is never printed or written to profile metadata
or connector JSON.
