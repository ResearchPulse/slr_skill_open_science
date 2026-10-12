# SLR configuration MCP

This is a separate local MCP server for `/slr config`. It manages the local
profile store and connector registration without adding configuration tools to
the five-tool SLR review MCP.

The server reads `SLR_AGENT_TOKEN` from the host connector credential binding
for the profile-first flow. The explicit `slr_config_token` operation also
accepts a token only for `/slr config token <TOKEN>`; it validates and binds the
secret immediately, and never prints it or writes it to profile metadata or
connector JSON.
