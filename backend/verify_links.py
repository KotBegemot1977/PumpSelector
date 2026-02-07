import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUMPS_DB = os.path.join(BASE_DIR, "pumps.db")
FILES_DB = os.path.join(BASE_DIR, "drawings.db")

def verify_all_links():
    """Verify that drawing_path and drawing_filename match actual files in drawings.db"""
    
    conn_pumps = sqlite3.connect(PUMPS_DB)
    conn_pumps.row_factory = sqlite3.Row
    
    conn_files = sqlite3.connect(FILES_DB)
    conn_files.row_factory = sqlite3.Row
    
    # Get all records with drawing paths
    pumps = conn_pumps.execute(
        "SELECT id, save_source, drawing_path, drawing_filename FROM pumps WHERE drawing_path IS NOT NULL AND drawing_path != ''"
    ).fetchall()
    
    print(f"Checking {len(pumps)} records with drawings...\n")
    
    mismatches = []
    
    for pump in pumps:
        pump_id = pump['id']
        path = pump['drawing_path']
        stored_filename = pump['drawing_filename']
        source = pump['save_source'] or 'unknown'
        
        # Extract file ID from path
        if path.startswith('/api/drawings/'):
            file_id = path.split('/')[-1]
            try:
                file_id = int(file_id)
            except:
                print(f"❌ ID {pump_id}: Invalid path format '{path}'")
                continue
            
            # Get actual filename from drawings.db
            file_row = conn_files.execute("SELECT filename FROM files WHERE id=?", (file_id,)).fetchone()
            
            if not file_row:
                print(f"❌ ID {pump_id} ({source}): File ID {file_id} not found in drawings.db!")
                mismatches.append((pump_id, source, path, stored_filename, None))
            else:
                actual_filename = file_row['filename']
                if stored_filename != actual_filename:
                    print(f"❌ ID {pump_id} ({source}): MISMATCH!")
                    print(f"   Path: {path}")
                    print(f"   Stored filename: '{stored_filename}'")
                    print(f"   Actual filename:  '{actual_filename}'")
                    mismatches.append((pump_id, source, path, stored_filename, actual_filename))
                else:
                    print(f"✓ ID {pump_id} ({source}): OK - '{stored_filename}'")
        else:
            print(f"⚠ ID {pump_id}: Unknown path format '{path}'")
    
    conn_pumps.close()
    conn_files.close()
    
    print(f"\n{'='*60}")
    print(f"Total records checked: {len(pumps)}")
    print(f"Mismatches found: {len(mismatches)}")
    
    if mismatches:
        print("\n⚠️ CRITICAL: Found mismatches! These need to be fixed.")
        print("Records with issues:")
        for pump_id, source, path, stored, actual in mismatches:
            print(f"  - ID {pump_id} ({source}): '{stored}' -> '{actual or 'FILE NOT FOUND'}'")

if __name__ == "__main__":
    verify_all_links()
