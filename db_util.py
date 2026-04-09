import sqlite3 as sql
from datetime import datetime
from pathlib import Path

script_dir = Path(__file__).parent
LOCATION = script_dir / 'database' / 'hospital_tracking.db'

# ==========================================
# CENTRALIZED CONNECTION HELPER
# ==========================================
def get_db_connection():
    # timeout = 10 tells Python to wait up to 10 seconds for a lock to clear instead of crashing instantly
    db = sql.connect(LOCATION, timeout=10.0) 
    # WAL used to improve concurrent write/read performance
    db.execute('PRAGMA journal_mode=WAL;')
    db.execute('PRAGMA synchronous=NORMAL;')
    return db


# ==========================================
# ASSET MANAGEMENT (CRUD OPERATIONS)
# ==========================================

# Inserts a new asset into the database safely
def add_new_asset(data):
    db = get_db_connection()
    try:
        cursor = db.cursor()
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        cursor.execute("""
            INSERT INTO asset_table 
            (tag_mac, asset_name, asset_type, status, floor, battery, x_coord, y_coord, current_room, timestamp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data['tag_mac'], data['asset_name'], data['asset_type'], data['status'], 
            data.get('floor', 1), data.get('battery', 100),
            0.0, 0.0, "Pending Registration", current_time
        ))
        db.commit()
        return "Asset successfully added."
    except Exception as e:
        raise Exception(f"Database Insert Error: {e}") 
    finally:
        db.close()

# Updates an existing asset
def update_existing_asset(data):
    db = get_db_connection()
    try:
        cursor = db.cursor()
        cursor.execute("""
            UPDATE asset_table 
            SET asset_name=?, asset_type=?, status=?, floor=?, battery=? 
            WHERE tag_mac=?
        """, (
            data['asset_name'], data['asset_type'], data['status'], 
            data.get('floor', 1), data.get('battery', 100), data['tag_mac']
        ))
        db.commit()
        return "Asset successfully updated."
    except Exception as e:
        raise Exception(f"Database Update Error: {e}")
    finally:
        db.close()

# Deletes an asset from the database.
def delete_asset_record(tag_mac):
    db = get_db_connection()
    try:
        cursor = db.cursor()
        cursor.execute("DELETE FROM asset_table WHERE tag_mac=?", (tag_mac,))
        db.commit()
        return "Asset deleted."
    except Exception as e:
        raise Exception(f"Database Delete Error: {e}")
    finally:
        db.close()


# ==========================================
# LIVE TRACKING & COORDINATE UPDATES
# ==========================================

# Updates coords of an asset
def update_coords(tag_mac, hub_loc, room_name):
    db = get_db_connection()
    try:
        x, y, floor_num = hub_loc[0], hub_loc[1], hub_loc[2]
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        cursor = db.cursor()
        cursor.execute("""
            UPDATE asset_table 
            SET x_coord=?, y_coord=?, current_room=?, floor=?, timestamp=? 
            WHERE tag_mac=?
        """, (x, y, room_name, floor_num, current_time, tag_mac))
        db.commit()
    except Exception as e:
        print(f"[ERROR] db_util.update_coords: {e}")
    finally:
        db.close()

# Updates user coords
def update_user_coords(mac_address, hub_loc, room_name):
    db = get_db_connection()
    try:
        x, y, floor_num = hub_loc[0], hub_loc[1], hub_loc[2]
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        cursor = db.cursor()
        cursor.execute("""
            UPDATE user_table 
            SET x_coord=?, y_coord=?, current_room=?, floor=?, timestamp=? 
            WHERE mac_address=?
        """, (x, y, room_name, floor_num, current_time, mac_address))
        db.commit()
    except Exception as e:
        print(f"[ERROR] db_util.update_user_coords: {e}")
    finally:
        db.close()

# Gets the location of hubs
def get_hub_coords(room_name):
    db = get_db_connection()
    try:
        cursor = db.cursor()
        cursor.execute("SELECT x_coord, y_coord, floor FROM hub_table WHERE room_name = ?", (room_name,))
        row = cursor.fetchone()
        
        if row:
            return (row[0], row[1], row[2]) 
        return None
    except Exception as e:
        print(f"[ERROR] db_util.get_hub_coords: {e}")
        return None
    finally:
        db.close()