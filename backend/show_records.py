import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUMPS_DB = os.path.join(BASE_DIR, "pumps.db")

def show_record_details(record_id):
    """Show detailed information about a specific record"""
    
    conn = sqlite3.connect(PUMPS_DB)
    conn.row_factory = sqlite3.Row
    
    record = conn.execute(
        "SELECT id, save_source, q_text, drawing_path, drawing_filename, name, oem_name FROM pumps WHERE id=?",
        (record_id,)
    ).fetchone()
    
    if not record:
        print(f"Record {record_id} not found")
        return
    
    print(f"{'='*60}")
    print(f"RECORD ID {record_id}")
    print(f"{'='*60}")
    print(f"Name:            {record['name']}")
    print(f"OEM:             {record['oem_name']}")
    print(f"Save Source:     '{record['save_source']}'")
    print(f"Q Text:          '{record['q_text'][:50] if record['q_text'] else 'None'}...'")
    print(f"Drawing Path:    '{record['drawing_path']}'")
    print(f"Drawing Filename: '{record['drawing_filename']}'")
    print(f"{'='*60}")
    
    # Determine which tab it should open in
    source = record['save_source'] or ('coeffs' if record['q_text'] == 'MODES' else 'points')
    tab = 'Коэффициенты' if source == 'coeffs' else 'Точки'
    print(f"Should open in tab: {tab}")
    print(f"Full URL would be: http://localhost:8000{record['drawing_path']}")
    
    conn.close()

if __name__ == "__main__":
    # Check a few records
    print("Checking records from Coefficients tab:\n")
    for rid in [98, 97, 93, 90, 89]:
        show_record_details(rid)
        print()
    
    print("\n\nChecking records from Points tab:\n")
    for rid in [96, 95, 94, 92, 91]:
        show_record_details(rid)
        print()
