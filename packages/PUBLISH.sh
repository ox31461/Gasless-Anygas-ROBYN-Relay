#!/bin/sh
# Publish the AnyGas npm packages. Run `npm login` first (interactive).
set -e
echo "npm user: $(npm whoami)"
cd /opt/robyn-public/packages/agent-kit && npm publish --access public
cd /opt/robyn-public/packages/mcp && npm publish --access public
echo "Published anygas-agent-kit 1.1.0 + anygas-mcp 1.1.0"
