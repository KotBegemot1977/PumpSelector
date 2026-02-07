import sqlite3
import os

db_path = r"c:\Users\user\Desktop\Project AI\TEST 20260118 Telegram QH Chart  31_01_2026\backend\drawings.db"

def check_db():
    if not os.path.exists(db_path):
        print(f"ERROR: DB not found at {db_path}")
        return

    print(f"Checking DB: {db_path}")
    print(f"File size: {os.path.getsize(db_path)} bytes")

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='files';")
        if not cursor.fetchone():
            print("ERROR: Table 'files' not found!")
            return

        # Check record 92
        cursor.execute("SELECT id, filename, length(data) FROM files WHERE id=92")
        row = cursor.fetchone()
        if row:
            print(f"RECORD 92 FOUND: ID={row[0]}, Filename='{row[1]}', BlobSize={row[2]}")
            if row[2] is None:
                print("WARNING: Data blob is NULL")
        else:
            print("ERROR: Record 92 NOT FOUND in database")

        # Check last 5 records
        print("\nLast 5 records:")
        cursor.execute("SELECT id, filename, length(data) FROM files ORDER BY id DESC LIMIT 5")
        for r in cursor.fetchall():
            print(f"ID={r[0]}, Filename='{r[1]}', BlobSize={r[2]}")

        conn.close()
    except Exception as e:
        print(f"SQLITE ERROR: {e}")

if __name__ == "__main__":
    check_db()
