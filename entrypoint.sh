#!/bin/bash
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

echo "Setting up user with PUID=$PUID, PGID=$PGID"

# Create group if GID doesn't already exist
if ! getent group "$PGID" > /dev/null 2>&1; then
    groupadd -g "$PGID" terminaldeck
fi
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

# Create user if UID doesn't already exist
if ! getent passwd "$PUID" > /dev/null 2>&1; then
    useradd -u "$PUID" -g "$PGID" -m -s /bin/bash -d /home/terminaldeck terminaldeck
elif [ "$(getent passwd "$PUID" | cut -d: -f6)" != "/home/terminaldeck" ]; then
    # User exists but with different home - update it
    usermod -d /home/terminaldeck -m "$(getent passwd "$PUID" | cut -d: -f1)" 2>/dev/null || true
fi
USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)
USER_HOME="/home/terminaldeck"

# Ensure home directory exists
mkdir -p "$USER_HOME"

# Copy config files to user's home (don't overwrite existing - preserves customization on restart)
[ ! -f "$USER_HOME/.bashrc" ] && cp /app/config/.bashrc "$USER_HOME/.bashrc"
[ ! -f "$USER_HOME/.tmux.conf" ] && cp /app/config/tmux.conf "$USER_HOME/.tmux.conf"

# Install Claude CLI if not already present
if [ ! -f "$USER_HOME/.local/bin/claude" ]; then
    echo "Installing Claude CLI..."
    if su -s /bin/bash "$USER_NAME" -c 'curl -fsSL https://claude.ai/install.sh | bash' 2>/dev/null; then
        echo "Claude CLI installed successfully"
    else
        echo "WARNING: Claude CLI installation failed (non-fatal, continuing)"
    fi
fi

# Fix ownership - top-level only (no recursive on /app to avoid slow node_modules chown)
chown "$PUID:$PGID" /app
chown -R "$PUID:$PGID" /app/config
chown -R "$PUID:$PGID" /workspace
chown -R "$PUID:$PGID" "$USER_HOME"

# Set environment for runtime user
export HOME="$USER_HOME"
export USER="$USER_NAME"
export PATH="$USER_HOME/.local/bin:$PATH"
export DISABLE_AUTOUPDATER=1

# Drop privileges and exec CMD
exec gosu "$USER_NAME" "$@"
