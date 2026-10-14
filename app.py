"""Entry point: `python app.py` serves the portal on http://127.0.0.1:5050."""
import os

from portal import create_app

app = create_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5050)), debug=True)
