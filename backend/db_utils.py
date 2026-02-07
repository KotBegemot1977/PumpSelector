import sqlite3
import os
from config import config

BASE_DIR = config.BASE_DIR
DB_PATH = str(config.DB_PUMPS)
SENSITIVE_DB_PATH = str(config.DB_SENSITIVE)
FILES_DB_PATH = str(config.DB_DRAWINGS)
UPLOAD_DIR = str(config.UPLOAD_DIR)

# Note: BASE_DIR in original file was backend/, now config.BASE_DIR is root. 
# But logic seems to not rely on BASE_DIR except for paths which are now from config.


from sqlmodel import create_engine, Session, SQLModel, select, text
from models import Pump, PrivateData, File

# Engines
# check_same_thread=False is needed for SQLite in multithreaded (FastAPI) env
engine_pumps = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
engine_sensitive = create_engine(f"sqlite:///{SENSITIVE_DB_PATH}", connect_args={"check_same_thread": False})
engine_files = create_engine(f"sqlite:///{FILES_DB_PATH}", connect_args={"check_same_thread": False})

def get_db_path():
    return DB_PATH

def get_sensitive_db_path():
    return SENSITIVE_DB_PATH

def get_files_db_path():
    return FILES_DB_PATH

# Legacy Raw Connections
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_sensitive_conn():
    conn = sqlite3.connect(SENSITIVE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
    
def get_files_conn():
    return sqlite3.connect(FILES_DB_PATH)

# New ORM Sessions
def get_session():
    with Session(engine_pumps) as session:
        yield session

def get_sensitive_session():
    with Session(engine_sensitive) as session:
        yield session

def get_files_session():
    with Session(engine_files) as session:
        yield session

def init_db():
    """Initializes the database tables and performs necessary migrations."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    # ensure tables exist via SQLModel
    SQLModel.metadata.create_all(engine_pumps)
    SQLModel.metadata.create_all(engine_sensitive)
    SQLModel.metadata.create_all(engine_files)
    
    # 1. Main Data DB (Public/Technical) - Legacy Migration Check
    conn = sqlite3.connect(DB_PATH)
    # Note: create_all handles creation, but we keep this for consistency if needed
    # ... migration logic follows ...
    conn.execute("""CREATE TABLE IF NOT EXISTS pumps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT, oem_name TEXT, company TEXT, executor TEXT,
        dn_suction TEXT, dn_discharge TEXT, rpm TEXT, p2_nom TEXT, impeller_actual TEXT,
        q_text TEXT, h_text TEXT, npsh_text TEXT, p2_text TEXT, eff_text TEXT,
        h_coeffs TEXT, eff_coeffs TEXT, p2_coeffs TEXT, npsh_coeffs TEXT,
        q_max REAL, q_min REAL, h_max REAL, h_min REAL, q_req REAL, h_req REAL,
        drawing_path TEXT, drawing_filename TEXT, created_at TEXT, price REAL, currency TEXT, comment TEXT, updated_at TEXT, save_source TEXT
    )""")
    
    # Simple Migration System for Columns
    columns_to_ensure = [
        ("h_max", "REAL"), ("h_min", "REAL"), ("q_req", "REAL"), ("h_req", "REAL"), 
        ("q_max", "REAL"), ("q_min", "REAL"), ("h_st", "REAL"),
        ("drawing_filename", "TEXT"),
        ("price", "REAL"), ("currency", "TEXT"), ("comment", "TEXT"), ("updated_at", "TEXT"), ("save_source", "TEXT"),
        ("org_id", "INTEGER")
    ]
    for col_name, col_type in columns_to_ensure:
        try: 
            conn.execute(f"ALTER TABLE pumps ADD COLUMN {col_name} {col_type}")
            conn.commit()
            print(f"Migration: Added column {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                pass # Already exists
            else:
                print(f"Migration Error on {col_name}: {e}")
            
    conn.commit()
    
    # 2. Sensitive DB (Private: Price, Original Name)
    # Check if we need to migrate data from pumps.db -> sensitive.db
    sensitive_exists = os.path.exists(SENSITIVE_DB_PATH)
    conn_sens = sqlite3.connect(SENSITIVE_DB_PATH)
    conn_sens.execute("""CREATE TABLE IF NOT EXISTS private_data (
        id INTEGER PRIMARY KEY,
        original_name TEXT,
        price REAL,
        currency TEXT
    )""")
    
    # MIGRATION: If pumps.db has data but sensitive.db was just created (or is empty), migrate.
    # We check if 'private_data' is empty.
    count = conn_sens.execute("SELECT count(*) FROM private_data").fetchone()[0]
    
    if count == 0:
        print("MIGRATION: Moving sensitive data to separate database...")
        # Select sensitive data from public DB
        rows = conn.execute("SELECT id, name, price, currency FROM pumps").fetchall()
        migrated_count = 0
        for row in rows:
            rid, rname, rprice, rcurr = row
            # If has sensitive data
            if rname or rprice or rcurr:
                conn_sens.execute("INSERT OR REPLACE INTO private_data (id, original_name, price, currency) VALUES (?, ?, ?, ?)", 
                                  (rid, rname, rprice, rcurr))
                migrated_count += 1
                
        if migrated_count > 0:
            conn_sens.commit()
            print(f"MIGRATION: Moved {migrated_count} records to sensitive.db")
            
            # OPTIONAL: Clear data from public DB immediately?
            # Better to do it safe: update public db to use oem_name as name (if empty) or blank, and zero price.
            # We will set 'name' = 'oem_name' (so list is not empty visually), and price=0.
            conn.execute("UPDATE pumps SET name = oem_name, price = 0, currency = ''")
            conn.commit()
            print("MIGRATION: Cleared sensitive data from public pumps.db")
            
    conn_sens.close()

    # MIGRATION: Synchronize drawing_filename with drawings.db
    try:
        rows = conn.execute("SELECT id, drawing_path, drawing_filename FROM pumps WHERE drawing_path LIKE '/api/drawings/%'").fetchall()
        if rows:
            print(f"MIGRATION: Synchronizing filenames for {len(rows)} records...")
            conn_f = sqlite3.connect(FILES_DB_PATH)
            for rid, dpath, dname in rows:
                try:
                    fid = int(str(dpath).split('/')[-1])
                    res = conn_f.execute("SELECT filename FROM files WHERE id=?", (fid,)).fetchone()
                    if res and res[0]:
                        actual_name = str(res[0])
                        # Update if missing, numeric (from previous fix), or different
                        is_numeric = dname and str(dname).isdigit()
                        if not dname or is_numeric or dname != actual_name:
                            conn.execute("UPDATE pumps SET drawing_filename=? WHERE id=?", (actual_name, rid))
                            print(f"  Synced record {rid}: {actual_name}")
                except: pass
            conn_f.close()
            conn.commit()
    except Exception as e:
        print(f"MIGRATION ERROR: {e}")

    conn.close()
    
    # 3. Files/Blob DB
    conn_files = sqlite3.connect(FILES_DB_PATH)
    conn_files.execute("CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, data BLOB, org_id INTEGER)")
    try:
        conn_files.execute("ALTER TABLE files ADD COLUMN org_id INTEGER")
        conn_files.commit()
    except sqlite3.OperationalError:
        pass # Already exists
    conn_files.close()

    conn_files.close()

    # MIGRATION: Auto-adopt orphaned records to the first organization if one exists
    # Using raw SQL to be 100% sure it executes during init_db correctly
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        
        # Check if an organization exists (take the LATEST one, as the user probably just created it)
        org_row = conn.execute("SELECT id FROM organizations ORDER BY id DESC LIMIT 1").fetchone()
        if org_row:
            org_id = org_row['id']
            # Adoption for pumps ONLY if they are NULL
            # We don't want to move records that already belong to someone
            res_p = conn.execute("UPDATE pumps SET org_id = ? WHERE org_id IS NULL", (org_id,))
            if res_p.rowcount > 0:
                print(f"MIGRATION: Successfully adopted {res_p.rowcount} orphaned pumps to Org ID {org_id}")
            
            # Adoption for files
            conn_f = sqlite3.connect(FILES_DB_PATH)
            res_f = conn_f.execute("UPDATE files SET org_id = ? WHERE org_id IS NULL", (org_id,))
            if res_f.rowcount > 0:
                print(f"MIGRATION: Successfully adopted {res_f.rowcount} orphaned files to Org ID {org_id}")
            conn_f.commit()
            conn_f.close()
            
            conn.commit()
        else:
            print("MIGRATION: No organizations found yet to adopt legacy data.")
        conn.close()
    except Exception as e:
        print(f"MIGRATION ERROR in auto-adoption: {e}")
