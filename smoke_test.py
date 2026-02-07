import requests
import json
import sys

def test_api_health():
    print("Checking backend health...")
    try:
        # Check /api/pumps (archive list)
        res = requests.get("http://localhost:8000/api/pumps")
        if res.status_code == 200:
            print("✓ /api/pumps is OK")
        else:
            print(f"✗ /api/pumps failed: {res.status_code}")
            
        # Check calculation
        calc_data = {
            "q_text": "0 10 20 30 40",
            "h_text": "50 48 44 38 30",
            "q_req": 25,
            "h_req": 40,
            "h_st": 0
        }
        res = requests.post("http://localhost:8000/api/calculate", data=calc_data)
        if res.status_code == 200:
            data = res.json()
            if "h_coeffs" in data:
                print(f"✓ /api/calculate is OK (Coeffs: {data['h_coeffs'][:2]}...)")
            else:
                print("✗ /api/calculate response missing 'h_coeffs'")
        else:
            print(f"✗ /api/calculate failed: {res.status_code}")
            
        # Check Selection
        sel_data = {
            "q_req": 30,
            "h_req": 40,
            "tolerance_percent": 10
        }
        res = requests.post("http://localhost:8000/api/selection/search", json=sel_data)
        if res.status_code == 200:
            print(f"✓ /api/selection/search is OK (Found {len(res.json())} pumps)")
        else:
            print(f"✗ /api/selection/search failed: {res.status_code}")

    except Exception as e:
        print(f"✗ Connection error: {e}")

def test_frontend_serving():
    print("\nChecking frontend assets...")
    try:
        # Check index.html
        res = requests.get("http://localhost:8081")
        if res.status_code == 200:
            print("✓ index.html is OK")
        else:
            print(f"✗ index.html failed: {res.status_code}")
            
        # Check main.js (Vite dev)
        res = requests.get("http://localhost:8081/src/main.js")
        if res.status_code == 200:
            print("✓ /src/main.js is OK")
        else:
            # Maybe it's bundled?
            print(f"! /src/main.js not found (Expected in dev mode): {res.status_code}")

    except Exception as e:
        print(f"✗ Connection error: {e}")

if __name__ == "__main__":
    test_api_health()
    test_frontend_serving()
