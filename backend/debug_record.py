
import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "pumps.db")

def check_record(id):
    if not os.path.exists(DB_PATH):
        print("DB not found")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        row = cursor.execute("SELECT id, save_source, q_text, drawing_path, drawing_filename FROM pumps WHERE id=?", (id,)).fetchone()
        if row:
            print(f"--- Record {id} ---")
            print(f"save_source: '{row['save_source']}'")
            print(f"q_text: '{row['q_text']}'") # q_text sometimes holds 'MODES' legacy flag
            print(f"drawing_path: '{row['drawing_path']}'")
            print(f"drawing_filename: '{row['drawing_filename']}'")
        else:
            print(f"Record {id} not found.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    check_record(98)
