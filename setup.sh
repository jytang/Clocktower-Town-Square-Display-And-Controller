#!/bin/bash

echo "=== Blood on the Clocktower Storyteller Setup ==="

# Function to gracefully shutdown servers
shutdown_servers() {
    echo ""
    echo "Shutting down servers..."
    if [ ! -z "$SERVER_PID" ]; then
        echo "Stopping WebSocket server (PID $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null
        wait $SERVER_PID 2>/dev/null
    fi
    if [ ! -z "$HTTP_PID" ]; then
        echo "Stopping HTTP server (PID $HTTP_PID)..."
        kill $HTTP_PID 2>/dev/null
        wait $HTTP_PID 2>/dev/null
    fi
    echo "All servers stopped."
    exit 0
}

# Function to kill processes using specific ports
kill_port_processes() {
    local port=$1
    local port_name=$2
    
    echo "Checking for processes using $port_name port $port..."
    
    # Find and kill processes using the port
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
        echo "Found processes using $port_name port: $pids"
        echo "Killing existing processes..."
        echo "$pids" | xargs kill -9 2>/dev/null
        sleep 2
    else
        echo "No processes found using $port_name port $port"
    fi
}

# Set up trap for graceful shutdown
trap shutdown_servers SIGINT SIGTERM

# 1. Check for Node.js
if ! command -v node &> /dev/null
then
    echo "Node.js could not be found. Please install Node.js first: https://nodejs.org/"
    exit
fi

# 2. Initialize npm if needed
if [ ! -f package.json ]; then
    echo "Initializing npm..."
    npm init -y
fi

# 3. Install WebSocket library
echo "Installing ws library..."
npm install ws

# 4. Determine local IP
if [ -z "$1" ]; then
    echo "No IP parameter provided, trying to auto-detect..."
    IP=$(ipconfig getifaddr en0)
    if [ -z "$IP" ]; then
        IP=$(ipconfig getifaddr en1)
    fi
    if [ -z "$IP" ]; then
        echo "Could not auto-detect IP. Please provide it manually:"
        echo "./setup.sh <your_local_IP>"
        exit 1
    fi
else
    IP=$1
    echo "Using provided IP: $IP"
fi

echo "Detected IP: $IP"
echo "This IP will be injected into display.html and controller.html"
echo ""
echo "⚠️  SECURITY WARNING: This will replace YOUR_IP placeholder with your actual IP"
echo "   Do NOT commit these files to version control with real IP addresses!"
echo "   Use YOUR_IP placeholder for public repositories"
echo ""

# 5. Create IP-specific copies and update .gitignore
echo "Creating IP-specific working copies..."

# Update .gitignore to exclude IP-specific files
if [ -f .gitignore ]; then
    if ! grep -q "display_.*.html" .gitignore; then
        echo "# Auto-generated IP-specific files" >> .gitignore
        echo "display_*.html" >> .gitignore
        echo "controller_*.html" >> .gitignore
        echo "lobby_*.html" >> .gitignore
        echo "Added IP-specific files to .gitignore"
    fi
else
    echo "# Auto-generated IP-specific files" > .gitignore
    echo "display_*.html" >> .gitignore
    echo "controller_*.html" >> .gitignore
    echo "lobby_*.html" >> .gitignore
    echo "Created .gitignore with IP-specific files"
fi

for FILE in display.html controller.html lobby.html; do
    if [ -f "$FILE" ]; then
        # Check if file contains YOUR_IP placeholder
        if grep -q "YOUR_IP" "$FILE"; then
            echo "✅ $FILE uses YOUR_IP placeholder - creating IP-specific copy"
            
            # Create IP-specific copy
            IP_FILE="${FILE%.html}_${IP//./_}.html"
            cp "$FILE" "$IP_FILE"
            
            # Replace YOUR_IP with actual IP in the copy
            sed -i '' "s|const ws = new WebSocket('ws://YOUR_IP:8080');|const ws = new WebSocket('ws://$IP:8080');|" "$IP_FILE"
            echo "✅ Created $IP_FILE with IP: $IP"
        else
            echo "❌ ERROR: $FILE contains hardcoded IP address!"
            echo "   Please replace with YOUR_IP placeholder before running setup"
            echo "   Skipping $FILE..."
        fi
    else
        echo "Warning: $FILE not found, skipping..."
    fi
done


# 6. Clean up any existing processes on our ports
echo "Cleaning up existing processes..."
kill_port_processes 8080 "WebSocket"
kill_port_processes 8000 "HTTP"

# 7. Start WebSocket server in background
echo "Starting WebSocket server..."
node server.js &
SERVER_PID=$!
echo "Server running with PID $SERVER_PID"

# 8. Start HTTP server for hosting HTML files (only IP-specific files)
echo "Starting HTTP server for IP-specific files at http://$IP:8000"
node http-server.js $IP &
HTTP_PID=$!
echo "HTTP server running with PID $HTTP_PID"

echo ""
echo "Setup complete!"
echo "TV Display URL: http://$IP:8000/display_${IP//./_}.html"
echo "Controller URL: http://$IP:8000/controller_${IP//./_}.html"
echo "Player Lobby URL (share with phones): http://$IP:8000/lobby_${IP//./_}.html"
echo "Keep this terminal open while playing."
echo "Press Ctrl+C to gracefully stop both servers."

# Wait for servers to finish (keeps script running)
wait