import os
from pathlib import Path
from dotenv import load_dotenv

# Base Directory: Parent of 'backend' folder (Project Root)
# Assumes config.py is inside backend/
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from project root
# override=True allows .env to override system environment variables if needed
load_dotenv(BASE_DIR / ".env", override=True)

class Config:
    """
    Centralized Configuration for RusPump Application.
    Reads from environment variables or defaults to standard structure.
    """
    
    # Project Root
    BASE_DIR = BASE_DIR
    
    # Server Settings
    API_HOST = os.getenv("API_HOST", "0.0.0.0")
    API_PORT = int(os.getenv("API_PORT", "8000"))
    
    # Database Configuration
    # DB_DIR defaults to 'backend' inside project root if not specified
    _db_dir_raw = os.getenv("DB_DIR", "backend")
    
    # Resolve DB_DIR: If absolute, use as is; else, relative to BASE_DIR
    if os.path.isabs(_db_dir_raw):
        DB_DIR = Path(_db_dir_raw)
    else:
        DB_DIR = BASE_DIR / _db_dir_raw
        
    # Ensure DB directory exists
    DB_DIR.mkdir(parents=True, exist_ok=True)
    
    # Full Paths to Databases
    DB_PUMPS = DB_DIR / os.getenv("DB_PUMPS", "pumps.db")
    DB_SENSITIVE = DB_DIR / os.getenv("DB_SENSITIVE", "sensitive.db")
    DB_DRAWINGS = DB_DIR / os.getenv("DB_DRAWINGS", "drawings.db")
    
    # Uploads Configuration
    _upload_dir_raw = os.getenv("UPLOAD_DIR", "backend/uploads")
    if os.path.isabs(_upload_dir_raw):
        UPLOAD_DIR = Path(_upload_dir_raw)
    else:
        UPLOAD_DIR = BASE_DIR / _upload_dir_raw
        
    # Ensure Upload directory exists
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def print_config(cls):
        print(f"--- Configuration ---")
        print(f"Project Root: {cls.BASE_DIR}")
        print(f"DB Directory: {cls.DB_DIR}")
        print(f"Active DBs: {cls.DB_PUMPS.name}, {cls.DB_SENSITIVE.name}")
        print(f"Uploads: {cls.UPLOAD_DIR}")
        print(f"Server: {cls.API_HOST}:{cls.API_PORT}")
        print(f"---------------------")

config = Config()

if __name__ == "__main__":
    Config.print_config()
