from flask import Flask, render_template, request, redirect, session, jsonify
from flask_socketio import SocketIO
import db_util as util
import sqlite3 as sql
from datetime import datetime
import uuid
import json

# Flask Setup
app = Flask(__name__)
app.secret_key = 'hospital_secret_key_123' 
socketio = SocketIO(app, cors_allowed_origins="*")

# Memory Caches
known_assets_cache = set()
known_users_cache = set()

# Loading all known assets and users into the app at boot
def load_known_devices():
    global known_assets_cache, known_users_cache
    try:
        # Updated to use the centralized connection helper
        db = util.get_db_connection()
        cursor = db.cursor()
        cursor.execute("SELECT tag_mac FROM asset_table")
        known_assets_cache = {row[0].lower() for row in cursor.fetchall() if row[0]}
        cursor.execute("SELECT mac_address FROM user_table")
        known_users_cache = {row[0].lower() for row in cursor.fetchall() if row[0]}
        db.close()
        print(f"[SYSTEM] Loaded {len(known_assets_cache)} assets and {len(known_users_cache)} users.")
    except Exception as e:
        print(f"[ERROR] Failed to load devices: {e}")

# ==========================================
# CISCO INFRASTRUCTURE WEBHOOK
# ==========================================
@app.route('/api/cisco-firehose', methods=['POST'])
def cisco_firehose():
    try:
        data = request.json
        
        # Extract pre-calculated data from Cisco's payload
        mac_address = data.get('mac', '').lower()
        map_x = data.get('x') 
        map_y = data.get('y')
        best_floor = data.get('floor', 1)

        # Ignore empty or malformed packets
        if not mac_address or map_x is None or map_y is None:
            return jsonify({"status": "ignored"}), 400

        # Checking Asset/User existence in system
        is_asset = mac_address in known_assets_cache
        is_user = mac_address in known_users_cache
        
        # If not a User/Asset, ignore that message
        if not is_asset and not is_user:
            return jsonify({"status": "ignored", "message": "Unknown MAC"}), 200

        print(f"[CISCO UPDATE] {mac_address} | Floor: {best_floor} | X: {map_x:.2f}, Y: {map_y:.2f}")

        # Map Scaler
        PIXELS_PER_METER_X = 25 
        PIXELS_PER_METER_Y = 25 
        
        screen_x = map_x * PIXELS_PER_METER_X
        screen_y = map_y * PIXELS_PER_METER_Y
        room_placeholder = "Live Tracked"
        
        # If the received ping is a User, update their User location
        if is_user:
            util.update_user_coords(mac_address, (screen_x, screen_y, best_floor), room_placeholder)
            socketio.emit('location_update', {
                'type': 'user', 'tag_id': mac_address, 'x': screen_x, 'y': screen_y, 
                'room': room_placeholder, 'floor': best_floor, 'name': 'Staff Member'
            })

         # If the recived ping is an Asset, update its Asset location
        elif is_asset:
            util.update_coords(mac_address, (screen_x, screen_y, best_floor), room_placeholder)
            socketio.emit('location_update', {
                'type': 'asset', 'tag_id': mac_address, 'x': screen_x, 'y': screen_y, 
                'room': room_placeholder, 'floor': best_floor 
            })

        return jsonify({"status": "success"}), 200

    except Exception as e:
        print(f"[ERROR] Cisco Webhook Crash: {e}")
        return jsonify({"status": "error"}), 500

# ==========================================
# STANDARD FLASK ROUTES
# ==========================================

# Loading the Assets from Database
@app.route('/api/assets')
def get_initial_assets():
    db = util.get_db_connection()
    db.row_factory = sql.Row
    cursor = db.cursor()
    cursor.execute("SELECT tag_mac, asset_name, x_coord, y_coord, current_room, floor, status, timestamp, asset_type, battery FROM asset_table")
    assets = [dict(row) for row in cursor.fetchall()]
    db.close()
    return {"assets": assets}

# Loading the Users from Database
@app.route('/api/users')
def get_initial_users():
    db = util.get_db_connection()
    db.row_factory = sql.Row
    cursor = db.cursor()
    cursor.execute("SELECT mac_address, name, role, x_coord, y_coord, current_room, floor, timestamp FROM user_table WHERE x_coord IS NOT NULL")
    users = [dict(row) for row in cursor.fetchall()]
    db.close()
    return {"users": users}

# Loading the Hubs from Database
@app.route('/api/hubs')
def get_initial_hubs():
    db = util.get_db_connection()
    db.row_factory = sql.Row
    cursor = db.cursor()
    cursor.execute("SELECT room_name, x_coord, y_coord, floor FROM hub_table")
    hubs = [dict(row) for row in cursor.fetchall()]
    db.close()
    return {"hubs": hubs}

# Routing incoming logins
@app.route('/api/manage-asset', methods=['POST', 'PUT', 'DELETE'])
def manage_asset():
    if session.get('role') not in ['admin', 'tech']:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
        
    try:
        data = request.json
        mac = data.get('tag_mac')
        
        # Safely route traffic to db_util
        if request.method == 'POST':
            message = util.add_new_asset(data)
            known_assets_cache.add(mac.lower())

        elif request.method == 'PUT':
            message = util.update_existing_asset(data)

        elif request.method == 'DELETE':
            message = util.delete_asset_record(mac)
            known_assets_cache.discard(mac.lower())
            
        return jsonify({"status": "success", "message": message}), 200

    except Exception as e:
        print(f"\n[CRITICAL DB ERROR] {e}\n")
        return jsonify({"status": "error", "message": str(e)}), 500

# Routing incoming Support Tickets
@app.route('/api/tickets', methods=['GET'])
def get_tickets():
    if session.get('role') not in ['admin', 'tech']:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
    
    try:
        db = util.get_db_connection()
        db.row_factory = sql.Row
        cursor = db.cursor()
        
        # Only fetch open tickets, order by newest first
        cursor.execute("SELECT * FROM ticket_table WHERE status = 'open' ORDER BY timestamp DESC")
        rows = cursor.fetchall()
        
        tickets = []
        for row in rows:
            ticket = dict(row)
            # Parse into a Python list for the frontend
            ticket['issues'] = json.loads(ticket['issues']) if ticket['issues'] else []
            tickets.append(ticket)
            
        db.close()
        return jsonify({"tickets": tickets})
        
    # Error Catching
    except Exception as e:
        print(f"[DB ERROR] get_tickets: {e}")
        return jsonify({"status": "error"}), 500

# Submitting Support Ticket Routing
@app.route('/api/submit-ticket', methods=['POST'])
def submit_ticket():
    try:
        data = request.json
        ticket_id = str(uuid.uuid4())[:8]
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Convert the list of checkbox issues into a JSON string so SQLite can store it
        issues_json = json.dumps(data.get('issues', []))
        
        db = util.get_db_connection()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO ticket_table (ticket_id, mac, issues, description, timestamp, status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            ticket_id, 
            data.get('mac', 'General System Issue'), 
            issues_json, 
            data.get('description', ''), 
            timestamp, 
            "open"
        ))
        
        db.commit()
        db.close()
        return jsonify({"status": "success", "ticket_id": ticket_id}), 200
        
    except Exception as e:
        print(f"[DB ERROR] submit_ticket: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/resolve-ticket', methods=['POST'])
def resolve_ticket():
    if session.get('role') not in ['admin', 'tech']:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
        
    try:
        ticket_id = request.json.get('ticket_id')
        
        db = util.get_db_connection()
        cursor = db.cursor()
        
        cursor.execute("UPDATE ticket_table SET status = 'closed' WHERE ticket_id = ?", (ticket_id,))
        
        if cursor.rowcount == 0:
            db.close()
            return jsonify({"status": "error", "message": "Ticket not found"}), 404
            
        db.commit()
        db.close()
        return jsonify({"status": "success"}), 200
        
    except Exception as e:
        print(f"[DB ERROR] resolve_ticket: {e}")
        return jsonify({"status": "error"}), 500
    
# Admin Stats Info Routing
@app.route('/api/admin/stats')
def admin_stats():
    if session.get('role') != 'admin':
        return jsonify({"status": "error"}), 403
        
    try:
        db = util.get_db_connection()
        cursor = db.cursor()
        
        # Asset Status Breakdown
        cursor.execute("SELECT status, COUNT(*) FROM asset_table GROUP BY status")
        status_counts = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Asset Type Breakdown
        cursor.execute("SELECT asset_type, COUNT(*) FROM asset_table GROUP BY asset_type")
        type_counts = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Floor Distribution
        cursor.execute("SELECT floor, COUNT(*) FROM asset_table GROUP BY floor")
        floor_counts = {f"Floor {row[0]}": row[1] for row in cursor.fetchall()}
        
        # Battery Health Categories
        cursor.execute("""
            SELECT 
                SUM(CASE WHEN battery > 50 THEN 1 ELSE 0 END) as healthy,
                SUM(CASE WHEN battery <= 50 AND battery > 20 THEN 1 ELSE 0 END) as warning,
                SUM(CASE WHEN battery <= 20 THEN 1 ELSE 0 END) as critical
            FROM asset_table
        """)
        bat_row = cursor.fetchone()
        battery_counts = {
            "Healthy (>50%)": bat_row[0] or 0,
            "Warning (20-50%)": bat_row[1] or 0,
            "Critical (<20%)": bat_row[2] or 0
        }
        
        # Quick Totals
        cursor.execute("SELECT COUNT(*) FROM user_table")
        total_users = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM ticket_table WHERE status='open'")
        open_tickets = cursor.fetchone()[0]
        
        db.close()
        
        return jsonify({
            "status_counts": status_counts,
            "type_counts": type_counts,
            "floor_counts": floor_counts,
            "battery_counts": battery_counts,
            "total_users": total_users,
            "open_tickets": open_tickets,
            "critical_batteries": battery_counts["Critical (<20%)"]
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Managing Users Database for Admin users
@app.route('/api/manage-user', methods=['POST', 'DELETE'])
def manage_user():
    if session.get('role') != 'admin':
        return jsonify({"status": "error"}), 403
        
    try:
        db = util.get_db_connection()
        cursor = db.cursor()
        data = request.json
        
        if request.method == 'POST':
            # Add new staff member
            cursor.execute("""
                INSERT INTO user_table (mac_address, name, role, x_coord, y_coord, current_room, floor, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (data['mac'], data['name'], data['role'], 0.0, 0.0, 'Unassigned', 1, 'Never'))
            known_users_cache.add(data['mac'].lower())
            
        elif request.method == 'DELETE':
            # Revoke staff access
            cursor.execute("DELETE FROM user_table WHERE mac_address=?", (data['mac'],))
            known_users_cache.discard(data['mac'].lower())
            
        db.commit()
        db.close()
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"[DB ERROR] {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
    
# General Routing for all Users
@app.route('/')
def home():
    if not session.get('logged_in'):
        return redirect('/login')
    
    # Redirect users if they navigate to '/' but shouldn't be there
    #Redirect to Admin Page
    if session.get('role') == 'admin':
        return redirect('/admin')
    # Redirect to Teck Page
    elif session.get('role') == 'tech':
        return redirect('/tech')
    # Medical staff defaults here
    return render_template('index.html')

# Loging Page Routing
@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'my_mac' in request.args:
        session['my_mac'] = request.args.get('my_mac')

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')

        # Redirects to admin route
        if email == 'admin@hospital.com' and password == 'admin123':
            session['logged_in'] = True
            session['role'] = 'admin'
            return redirect('/admin')  
         # Redirects to tech route
        elif email == 'tech@hospital.com' and password == 'tech123':
            session['logged_in'] = True
            session['role'] = 'tech'
            return redirect('/tech') 
         # Redirects to medical (index) route
        elif email == 'nurse@hospital.com' and password == 'nurse123':
            session['logged_in'] = True
            session['role'] = 'medical'
            return redirect('/')
            
        else:
            return render_template('login.html', error="Invalid credentials!")

    return render_template('login.html')

# Route Admin Type Users
@app.route('/admin')
def admin_dashboard():
    # Security check: Kick them out if they aren't logged in OR aren't an admin
    if not session.get('logged_in') or session.get('role') != 'admin':
        return redirect('/login')
        
    return render_template('admin.html')

# Route Tech Type Users
@app.route('/tech')
def tech_dashboard():
    # Security check: Kick them out if they aren't logged in OR aren't a tech
    if not session.get('logged_in') or session.get('role') != 'tech':
        return redirect('/login')
        
    return render_template('tech.html')

# Route for Logout Button
@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

if __name__ == '__main__':
    # Start the system
    load_known_devices()
    print("[SYSTEM] Starting Cisco RTLS Webhook on port 5000...")
    socketio.run(app, host='0.0.0.0', debug=True, use_reloader=False, port=5000)