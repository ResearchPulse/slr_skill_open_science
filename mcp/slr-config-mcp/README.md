# SLR configuration MCP

This is a separate local MCP server for `/slr config`. It manages the local
profile store and connector registration without adding configuration tools to
the four-tool SLR review MCP.

The server reads `SLR_AGENT_TOKEN` from the host connector credential binding.
It never accepts or prints a token in ordinary tool output. The token is staged
only inside the existing protected local configuration flow while it is being
validated and committed.
