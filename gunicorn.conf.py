import os

# Gunicorn configuration
# Automatically binds to Render's $PORT (default 10000 on Render, 5050 locally)
port = os.environ.get("PORT", "5050")
bind = f"0.0.0.0:{port}"

workers = 2
threads = 4
timeout = 120
accesslog = "-"
errorlog = "-"
