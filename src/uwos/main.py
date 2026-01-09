import logging
import sys
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

# Add the generated code directory to sys.path to allow imports like 'import auth.v1...'
# This is required because buf generates code that assumes the output directory is the root
gen_path = Path(__file__).parent / "gen"
sys.path.append(str(gen_path))

from uwos.factory import create_app

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


def main() -> None:
    """Run the UWOS application."""
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
